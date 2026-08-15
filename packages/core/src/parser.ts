/**
 * Builds the concrete syntax tree from lexed lines using a level stack.
 *
 * The parser never throws and never gives up on a document. Real GEDCOM files are
 * produced by decades of software of varying quality, and an editor that shows
 * nothing for a file with one bad line is useless. Every deviation becomes a
 * diagnostic and the tree is built regardless.
 */

import { type Diagnostic, type Document, type Structure, type Span, span } from './cst.ts';
import { lex, type LexOptions, type LexedLine } from './lexer.ts';

/** Continuation pseudo-structures. Not structures — they extend a payload. */
const CONTINUATIONS = new Set(['CONT', 'CONC']);

interface MutableStructure extends Omit<Structure, 'payload' | 'children' | 'continuationLines'> {
  payload: string | null;
  children: MutableStructure[];
  continuationLines: number[];
}

function create(line: LexedLine): MutableStructure {
  return {
    tag: line.tag,
    xref: line.xref,
    payload: line.payload,
    level: line.level,
    children: [],
    parent: null,
    span: line.span,
    tagSpan: line.tagSpan,
    xrefSpan: line.xrefSpan,
    payloadSpan: line.payloadSpan,
    continuationLines: [],
  };
}

export function parse(text: string, options: LexOptions = {}): Document {
  const { lines, diagnostics } = lex(text, options);
  const records: MutableStructure[] = [];
  const structures: MutableStructure[] = [];

  /** stack[n] is the structure currently open at level n. */
  const stack: MutableStructure[] = [];
  /** The structure a CONT/CONC would extend. */
  let lastStructure: MutableStructure | null = null;

  for (const line of lines) {
    if (CONTINUATIONS.has(line.tag)) {
      applyContinuation(line, lastStructure, diagnostics);
      continue;
    }

    const level = resolveLevel(line, stack, diagnostics);
    const structure = create(line);

    if (level === 0) {
      records.push(structure);
    } else {
      const parent = stack[level - 1]!;
      parent.children.push(structure);
      structure.parent = parent;

      if (structure.xref !== null) {
        diagnostics.push({
          code: 'xref-on-substructure',
          message: `Only records may define a cross-reference identifier; \`${line.tag}\` is a substructure.`,
          severity: 'error',
          span: structure.xrefSpan ?? structure.span,
        });
      }
    }

    stack.length = level;
    stack.push(structure);
    structures.push(structure);
    lastStructure = structure;
  }

  checkEnvelope(records, diagnostics);

  return {
    records: records as Structure[],
    structures: structures as Structure[],
    diagnostics,
  };
}

/**
 * Clamps a line's level to one the stack can actually hold.
 *
 * A level more than one deeper than the enclosing structure has no parent to
 * attach to. Rather than dropping the line, it is reattached at the deepest
 * available depth so its content still appears in the tree.
 */
function resolveLevel(
  line: LexedLine,
  stack: readonly MutableStructure[],
  diagnostics: Diagnostic[],
): number {
  const maximum = stack.length;
  if (line.level <= maximum) return line.level;

  diagnostics.push({
    code: 'level-skipped',
    message:
      `Level ${line.level} has no structure at level ${line.level - 1} to attach to; ` +
      `reading it as level ${maximum}.`,
    severity: 'error',
    span: span(line.index, 0, String(line.level).length),
  });
  return maximum;
}

/**
 * Folds a CONT/CONC line into the preceding structure's payload.
 * CONT contributes a line break; CONC concatenates directly.
 */
function applyContinuation(
  line: LexedLine,
  target: MutableStructure | null,
  diagnostics: Diagnostic[],
): void {
  if (target === null) {
    diagnostics.push({
      code: 'continuation-without-target',
      message: `\`${line.tag}\` must follow the line whose payload it continues.`,
      severity: 'error',
      span: line.tagSpan,
    });
    return;
  }

  const addition = line.payload ?? '';
  const separator = line.tag === 'CONT' ? '\n' : '';
  target.payload = (target.payload ?? '') + separator + addition;
  target.continuationLines.push(line.index);
}

/** GEDCOM datasets open with HEAD and close with TRLR. */
function checkEnvelope(records: readonly MutableStructure[], diagnostics: Diagnostic[]): void {
  if (records.length === 0) return;

  const first = records[0]!;
  if (first.tag !== 'HEAD') {
    diagnostics.push({
      code: 'missing-header',
      message: 'A GEDCOM dataset must begin with a HEAD record.',
      severity: 'error',
      span: first.tagSpan,
    });
  }

  const last = records[records.length - 1]!;
  if (last.tag !== 'TRLR') {
    diagnostics.push({
      code: 'missing-trailer',
      message: 'A GEDCOM dataset must end with a TRLR record.',
      severity: 'error',
      span: last.tagSpan,
    });
  }
}

/** Finds the innermost structure whose line contains the given position. */
export function structureAt(
  document: Document,
  line: number,
  character: number,
): Structure | undefined {
  let found: Structure | undefined;
  for (const structure of document.structures) {
    const onTagLine = structure.span.line === line;
    const onContinuation = structure.continuationLines.includes(line);
    if (!onTagLine && !onContinuation) continue;
    if (onTagLine && (character < structure.span.start || character > structure.span.end)) continue;
    // Later structures are deeper in document order at the same line.
    found = structure;
  }
  return found;
}

/** Spans a structure and everything it contains, for folding ranges. */
export function fullSpan(structure: Structure): { start: Span; end: Span } {
  let last = structure.span;
  const visit = (node: Structure): void => {
    for (const continuation of node.continuationLines) {
      if (continuation > last.line) last = span(continuation, 0, 0);
    }
    if (node.span.line > last.line) last = node.span;
    for (const child of node.children) visit(child);
  };
  visit(structure);
  return { start: structure.span, end: last };
}
