/**
 * Line lexer.
 *
 * GEDCOM's entire grammar is one line long, so lexing is a per-line regex and
 * nothing more. Deliberately permissive: it accepts padding between components
 * and reports it, rather than rejecting lines that every real exporter produces.
 * Deciding what to do about tolerated deviations is the validator's job.
 */

import { type Diagnostic, type Span, span } from './cst.ts';

export interface LexedLine {
  readonly index: number;
  readonly text: string;
  readonly level: number;
  readonly tag: string;
  readonly xref: string | null;
  readonly payload: string | null;
  readonly span: Span;
  readonly tagSpan: Span;
  readonly xrefSpan: Span | null;
  readonly payloadSpan: Span | null;
}

export interface LexResult {
  readonly lines: LexedLine[];
  readonly diagnostics: Diagnostic[];
}

/**
 * `Line = Level D [Xref D] Tag [D LineVal] EOL`
 *
 * The delimiters accept one-or-more spaces even though the spec mandates exactly
 * one, except before the payload: there, only the first space is the delimiter
 * and everything after it is data. CONT lines depend on that distinction to
 * encode leading whitespace.
 */
const LINE = new RegExp(
  '^(?<indent>[ \\t]*)' +
    '(?<level>\\d+)' +
    '(?<d1>[ ]+)' +
    '(?:(?<xref>@[^@]*@)(?<d2>[ ]+))?' +
    '(?<tag>[A-Za-z_][A-Za-z0-9_]*)' +
    '(?:[ ](?<payload>.*))?$',
);

/** Splits on any GEDCOM line terminator: CRLF, CR or LF. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export interface LexOptions {
  /**
   * Read a line that cannot be a GEDCOM line as more of the payload above it.
   *
   * Some exporters — MyHeritage most of all — write literal line breaks inside a
   * payload, which the format has no way to carry: they emit `CONC` and never
   * `CONT`, so the rest of the value arrives as bare text.
   *
   * Deliberately limited to lines that could not be structure. A continuation
   * whose text happens to *look* like a GEDCOM line is ambiguous — `1 NAME This
   * is not a NAME line` is a perfectly good line and perfectly good prose — and
   * nothing in the file can settle which was meant. Those are left as lines,
   * because inventing a reading of somebody's data is worse than declining to.
   */
  readonly joinOrphanLines?: boolean;
}

export function lex(text: string, options: LexOptions = {}): LexResult {
  const lines: LexedLine[] = [];
  const diagnostics: Diagnostic[] = [];

  splitLines(text).forEach((raw, index) => {
    if (raw.length === 0) return;

    if (raw.trim().length === 0) {
      diagnostics.push({
        code: 'blank-line',
        message: 'Blank lines are not permitted between GEDCOM lines.',
        severity: 'hint',
        span: span(index, 0, raw.length),
      });
      return;
    }

    const match = LINE.exec(raw);
    if (!match?.groups) {
      // Not structure. Where the exporter is known to write payloads containing
      // line breaks, and there is a line above to attach this to, it is the rest
      // of that payload — said out loud rather than done quietly.
      const previous = lines.at(-1);
      if (options.joinOrphanLines && previous) {
        // Emitted as the `CONT` the exporter should have written, so the parser
        // folds it into the payload by the path every other continuation takes.
        // Nothing downstream learns that this file was repaired.
        lines.push({
          index,
          text: raw,
          level: previous.level + 1,
          tag: 'CONT',
          xref: null,
          payload: raw,
          span: span(index, 0, raw.length),
          tagSpan: span(index, 0, 0),
          xrefSpan: null,
          payloadSpan: span(index, 0, raw.length),
        });

        diagnostics.push({
          code: 'exporter-repair',
          message:
            'Read as more of the payload above, which is where the exporter meant it ' +
            'to go. It writes line breaks inside a payload, which GEDCOM carries with ' +
            '`CONT`; this line has no level number of its own.',
          severity: 'information',
          span: span(index, 0, raw.length),
        });
        return;
      }

      diagnostics.push({
        code: 'malformed-line',
        message:
          'Not a GEDCOM line. Expected a level number, an optional cross-reference identifier, a tag, and an optional payload.',
        severity: 'error',
        span: span(index, 0, raw.length),
      });
      return;
    }

    const g = match.groups;
    const indent = g['indent'] ?? '';
    const levelText = g['level']!;
    const d1 = g['d1']!;
    const xrefText = g['xref'] ?? null;
    const d2 = g['d2'] ?? '';
    const tag = g['tag']!;
    const payload = g['payload'] ?? null;

    if (indent.length > 0) {
      diagnostics.push({
        code: 'leading-whitespace',
        message: 'A GEDCOM line must begin with its level number.',
        severity: 'warning',
        span: span(index, 0, indent.length),
      });
    }

    if (d1.length > 1 || d2.length > 1) {
      diagnostics.push({
        code: 'multiple-delimiters',
        message: 'Line components must be separated by exactly one space.',
        severity: 'warning',
        span: span(
          index,
          indent.length + levelText.length,
          indent.length + levelText.length + d1.length,
        ),
      });
    }

    // Columns are accumulated rather than taken from match.index so that the
    // optional xref group does not shift everything after it.
    let column = indent.length;
    column += levelText.length + d1.length;

    let xrefSpan: Span | null = null;
    if (xrefText !== null) {
      xrefSpan = span(index, column, column + xrefText.length);
      column += xrefText.length + d2.length;
    }

    const tagSpan = span(index, column, column + tag.length);
    column += tag.length;

    const payloadSpan =
      payload === null ? null : span(index, column + 1, column + 1 + payload.length);

    lines.push({
      index,
      text: raw,
      level: Number(levelText),
      tag,
      // Strip the at-signs; every consumer wants the identifier, not the syntax.
      xref: xrefText === null ? null : xrefText.slice(1, -1),
      payload,
      span: span(index, 0, raw.length),
      tagSpan,
      xrefSpan,
      payloadSpan,
    });
  });

  return { lines, diagnostics };
}
