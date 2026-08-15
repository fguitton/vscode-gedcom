/**
 * Concrete syntax tree types.
 *
 * Every node carries the source span it came from, because everything downstream
 * — go-to-definition, diagnostics, semantic tokens, folding — is a question about
 * positions. Spans are line-and-column rather than absolute offsets so they map
 * onto LSP `Position` without conversion.
 */

/** A range within a single line. GEDCOM has no construct that spans lines. */
export interface Span {
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based inclusive start column. */
  readonly start: number;
  /** Zero-based exclusive end column. */
  readonly end: number;
}

export interface Structure {
  readonly tag: string;
  /** Cross-reference identifier this structure defines, without the at-signs. */
  readonly xref: string | null;
  /**
   * The payload, with any CONT/CONC continuations already folded in: CONT
   * contributes a line break, CONC concatenates directly.
   */
  readonly payload: string | null;
  readonly level: number;
  readonly children: Structure[];
  parent: Structure | null;

  /** Span of the whole originating line. */
  readonly span: Span;
  readonly tagSpan: Span;
  readonly xrefSpan: Span | null;
  /** Span of the payload on the originating line, before continuations. */
  readonly payloadSpan: Span | null;
  /** Line numbers of continuation lines folded into this structure's payload. */
  readonly continuationLines: number[];
}

export interface Document {
  /** Top-level structures — records, plus HEAD and TRLR. */
  readonly records: Structure[];
  /** Every structure in document order, records included. */
  readonly structures: Structure[];
  readonly diagnostics: Diagnostic[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: Span;
}

export type DiagnosticCode =
  // Lexical
  | 'malformed-line'
  | 'leading-whitespace'
  | 'multiple-delimiters'
  | 'blank-line'
  // Structural
  | 'level-skipped'
  | 'level-negative'
  | 'continuation-without-target'
  | 'xref-on-substructure'
  | 'missing-header'
  | 'missing-trailer'
  // Cross-references
  | 'duplicate-xref'
  | 'dangling-pointer'
  // Vocabulary
  | 'unknown-tag'
  | 'removed-in-version'
  | 'undocumented-extension'
  | 'tag-not-allowed-here'
  | 'cardinality-violation'
  | 'enum-value-unknown'
  | 'malformed-pointer'
  | 'nesting-too-deep'
  | 'date-invalid'
  | 'exporter-repair'
  | 'pointer-target-mismatch';

export function span(line: number, start: number, end: number): Span {
  return { line, start, end };
}

/** Walks a structure and all its descendants in document order. */
export function* walk(structure: Structure): Generator<Structure> {
  yield structure;
  for (const child of structure.children) yield* walk(child);
}
