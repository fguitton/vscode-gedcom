/**
 * GEDCOM parser.
 *
 * Zero runtime dependencies and no Node builtins, so the same code runs in the
 * VS Code extension host, in a browser worker on vscode.dev, and in plain tests.
 * That constraint is what makes dual-host support possible without a second
 * implementation.
 *
 * The entry point takes bytes rather than a string because version and encoding
 * detection is defined over bytes — see detect.ts.
 */

export { detect, decode, detectEncoding } from './detect.ts';
export type { Detection, Encoding, GedcomVersion, ByteOrder } from './detect.ts';

export { inferVersion } from './infer.ts';

export {
  scanDate,
  isUncertain,
  parseExactDate,
  describeDate,
  yearOf,
  dayNumber,
  ageAt,
  relativeTime,
} from './date.ts';
export type { ExactDate, AgeAt } from './date.ts';
export { relationsOf, eventYear, lifespan } from './relations.ts';
export type { Relations } from './relations.ts';

export { parseAge, describeAge, ageInDays } from './age.ts';
export type { Age } from './age.ts';

export { enumSetFor, describeEnumValue, meaningOf } from './enums.ts';
export type { EnumMeaning } from './enums.ts';

export {
  placeParts,
  describePlace,
  placeFormOf,
  parseCoordinate,
  formatCoordinate,
  signedDegrees,
  coordinatesOf,
} from './place.ts';
export type { PlaceLevel, Coordinate } from './place.ts';

export { describeLanguage, resolveMediaType, describeMediaType } from './lang.ts';

export { parsePersonalName } from './name.ts';
export type { PersonalName } from './name.ts';

export { statistics } from './stats.ts';
export type { Statistics } from './stats.ts';

export { describePayloadType } from './payload.ts';
export type { PayloadDescription } from './payload.ts';

export { neighbourhood, recordAt } from './graph.ts';
export type { Graph, GraphNode, GraphEdge, PositionedNode, NeighbourhoodOptions } from './graph.ts';
export type { DateKeyword, DateQualifier } from './date.ts';

export { lex, splitLines } from './lexer.ts';
export type { LexedLine, LexResult } from './lexer.ts';

export { parse, structureAt, fullSpan } from './parser.ts';
export { walk, span } from './cst.ts';
export type {
  Document,
  Structure,
  Span,
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from './cst.ts';

export { indexXrefs, asPointer, definitionAt, referencesAt, VOID_POINTER } from './xref.ts';
export type { XrefIndex, Reference } from './xref.ts';

export {
  completionsFor,
  enumValuesOf,
  isExtensionTag,
  isKnownTag,
  isRemovedInVersion,
  removalNote,
  labelOf,
  modelFor,
  modelledVersion,
  payloadOf,
  recordsOf,
  resolveSubstructure,
  parseCardinality,
} from './spec/index.ts';
export type { SpecModel, PayloadSpec, Cardinality, ModelledVersion } from './spec/index.ts';

export { validate } from './validate.ts';
export type { ValidateOptions, ValidationResult, Resolution, Strictness } from './validate.ts';

import { decode, detect, type GedcomVersion } from './detect.ts';
import type { Diagnostic, Document } from './cst.ts';
import { inferVersion } from './infer.ts';
import { parse } from './parser.ts';
import { indexXrefs, type XrefIndex } from './xref.ts';
import { validate, type Strictness, type ValidationResult } from './validate.ts';

export interface Analysis {
  readonly version: GedcomVersion | null;
  readonly text: string;
  readonly document: Document;
  readonly xrefs: XrefIndex;
  readonly validation: ValidationResult;
  /** Every diagnostic from lexing, parsing, cross-referencing and validation. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzeOptions {
  readonly strictness?: Strictness;
  /** Overrides detection. Useful when the header lies or is absent. */
  readonly version?: GedcomVersion | null;
}

/** Full analysis of a GEDCOM stream, from raw bytes to diagnostics. */
export function analyze(bytes: Uint8Array, options: AnalyzeOptions = {}): Analysis {
  const detection = detect(bytes);
  const version = options.version !== undefined ? options.version : detection.version;
  const text = decode(bytes, detection.encoding);
  return analyzeText(text, { ...options, version });
}

/**
 * Analysis of already-decoded text, for editor buffers where VS Code has done
 * the decoding. Version detection still runs, over the text's own bytes.
 */
export function analyzeText(text: string, options: AnalyzeOptions = {}): Analysis {
  const detected =
    options.version !== undefined
      ? options.version
      : detect(new TextEncoder().encode(text)).version;

  const document = parse(text);

  // Files without a GEDC structure cannot be detected but are common enough to
  // matter; fall back to inferring a generation from the vocabulary in use.
  const version = detected ?? inferVersion(document);
  const xrefs = indexXrefs(document);
  const validation = validate(document, {
    version,
    ...(options.strictness ? { strictness: options.strictness } : {}),
    xrefs,
  });

  return {
    version,
    text,
    document,
    xrefs,
    validation,
    diagnostics: [...document.diagnostics, ...xrefs.diagnostics, ...validation.diagnostics],
  };
}
