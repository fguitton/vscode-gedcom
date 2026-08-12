/**
 * Cross-reference index.
 *
 * This is what makes Ctrl+Click possible: a map from identifier to the record
 * that defines it, and the reverse list of every place each identifier is used.
 *
 * A payload is a pointer only when it is *exactly* `@identifier@`. Text that
 * merely contains an at-sign is text — 5.5.1 notes are full of email addresses,
 * and treating those as pointers is the single most common way to get this wrong.
 */

import type { Diagnostic, Document, Span, Structure } from './cst.ts';
import { span } from './cst.ts';

/** The null pointer. Valid, and deliberately resolves to nothing. */
export const VOID_POINTER = 'VOID';

export interface Reference {
  /** Identifier without at-signs. */
  readonly xref: string;
  /** The structure whose payload holds the pointer. */
  readonly structure: Structure;
  /** Span of the identifier, at-signs excluded. */
  readonly span: Span;
}

export interface XrefIndex {
  /** Identifier to the record defining it. First definition wins on duplicates. */
  readonly definitions: ReadonlyMap<string, Structure>;
  /** Every pointer use, in document order. */
  readonly references: readonly Reference[];
  /** Identifier to the structures that point at it. */
  readonly referencesTo: ReadonlyMap<string, readonly Reference[]>;
  readonly diagnostics: readonly Diagnostic[];
}

/** Matches a payload that is nothing but a pointer. */
const POINTER = /^@([^@]+)@$/;

/** Reads a structure's payload as a pointer, or null if it is not one. */
export function asPointer(structure: Structure): string | null {
  if (structure.payload === null) return null;
  // A folded continuation means the payload spans lines, so it is text.
  if (structure.continuationLines.length > 0) return null;
  return POINTER.exec(structure.payload)?.[1] ?? null;
}

export function indexXrefs(document: Document): XrefIndex {
  const definitions = new Map<string, Structure>();
  const references: Reference[] = [];
  const referencesTo = new Map<string, Reference[]>();
  const diagnostics: Diagnostic[] = [];

  for (const structure of document.structures) {
    if (structure.xref !== null) {
      const existing = definitions.get(structure.xref);
      if (existing) {
        diagnostics.push({
          code: 'duplicate-xref',
          message:
            `\`@${structure.xref}@\` is already defined on line ${existing.span.line + 1}. ` +
            'Cross-reference identifiers must be unique within a document.',
          severity: 'error',
          span: structure.xrefSpan ?? structure.span,
        });
      } else {
        definitions.set(structure.xref, structure);
      }
    }

    const pointer = asPointer(structure);
    if (pointer === null || pointer === VOID_POINTER) continue;

    const payloadSpan = structure.payloadSpan;
    const reference: Reference = {
      xref: pointer,
      structure,
      // Narrow the span to the identifier, excluding the at-signs, so that
      // go-to-definition highlights the name rather than the syntax.
      span: payloadSpan
        ? span(payloadSpan.line, payloadSpan.start + 1, payloadSpan.end - 1)
        : structure.span,
    };

    references.push(reference);
    const bucket = referencesTo.get(pointer);
    if (bucket) bucket.push(reference);
    else referencesTo.set(pointer, [reference]);
  }

  // Dangling pointers can only be judged once every definition has been seen,
  // because a record may be referenced before it is defined.
  for (const reference of references) {
    if (definitions.has(reference.xref)) continue;
    diagnostics.push({
      code: 'dangling-pointer',
      message:
        `\`@${reference.xref}@\` does not match any record in this document. ` +
        'Use `@VOID@` for a pointer that intentionally leads nowhere.',
      severity: 'error',
      span: reference.span,
    });
  }

  return { definitions, references, referencesTo, diagnostics };
}

/** The record a position points at, for go-to-definition. */
export function definitionAt(
  index: XrefIndex,
  line: number,
  character: number,
): Structure | undefined {
  const reference = index.references.find(
    (r) => r.span.line === line && character >= r.span.start && character <= r.span.end,
  );
  return reference ? index.definitions.get(reference.xref) : undefined;
}

/** Every use of the identifier defined or referenced at a position. */
export function referencesAt(
  index: XrefIndex,
  line: number,
  character: number,
): readonly Reference[] {
  const reference = index.references.find(
    (r) => r.span.line === line && character >= r.span.start && character <= r.span.end,
  );
  if (reference) return index.referencesTo.get(reference.xref) ?? [];

  for (const [xref, definition] of index.definitions) {
    const definitionSpan = definition.xrefSpan;
    if (
      definitionSpan?.line === line &&
      character >= definitionSpan.start &&
      character <= definitionSpan.end
    ) {
      return index.referencesTo.get(xref) ?? [];
    }
  }
  return [];
}
