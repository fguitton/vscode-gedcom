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

export function lex(text: string): LexResult {
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
