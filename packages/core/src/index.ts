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
  attributeToExporter,
  exporterName,
  exporterProfile,
  exporterProfiles,
} from './exporter.ts';
export type { ExporterProfile, ExporterQuirk } from './exporter.ts';

export {
  scanDate,
  isUncertain,
  parseExactDate,
  describeDate,
  dateProblems,
  expandMonths,
  readableDate,
  yearOf,
  dayNumber,
  ageAt,
  relativeTime,
} from './date.ts';
export type { ExactDate, AgeAt } from './date.ts';
export { relationsOf, eventYear, lifespan } from './relations.ts';
export type { Relations } from './relations.ts';

export { calculateKinship, getFormatter } from './kinship.ts';
export type { Kinship, KinshipOptions, KinshipFormatter } from './kinship.ts';

export { individualTimeline } from './timeline.ts';
export type { TimelineEvent } from './timeline.ts';

export { buildFanChart } from './fanchart.ts';
export type { FanChartData, FanChartNode } from './fanchart.ts';

export { parseAge, describeAge, ageInDays } from './age.ts';
export type { Age } from './age.ts';

export { enumSetFor, describeEnumValue, meaningOf, standalone, valuesOfSet } from './enums.ts';
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

export { describeLanguage, resolveMediaType, describeMediaType, mediaTypeOfPath } from './lang.ts';

export { displayName, parsePersonalName } from './name.ts';
export type { PersonalName } from './name.ts';

export { statistics } from './stats.ts';
export type { Statistics } from './stats.ts';

export { describePayloadType } from './payload.ts';
export type { PayloadDescription } from './payload.ts';

export { recordDetails, documentDetails, webUrl } from './details.ts';
export type { Details, DetailSection, DetailField } from './details.ts';

export { neighbourhood, recordAt } from './graph.ts';
export type {
  Direction,
  Graph,
  GraphNode,
  GraphEdge,
  PositionedNode,
  NeighbourhoodOptions,
  RelationKind,
} from './graph.ts';
export type { DateKeyword, DateQualifier } from './date.ts';

export { lex, splitLines } from './lexer.ts';
export { detectIndentation } from './indentation.ts';
export type { Indentation, IndentStyle } from './indentation.ts';
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
  glossOf,
  removalNote,
  labelOf,
  recordNoun,
  tagLabel,
  modelFor,
  modelledVersion,
  payloadOf,
  recordsOf,
  resolveSubstructure,
  parseCardinality,
} from './spec/index.ts';
export type { SpecModel, PayloadSpec, Cardinality, ModelledVersion } from './spec/index.ts';

export { validate } from './validate.ts';
export type {
  ValidateOptions,
  ValidationResult,
  Resolution,
  Strictness,
  VersionSource,
} from './validate.ts';

import { decode, detect, type GedcomVersion } from './detect.ts';
import type { Diagnostic, Document } from './cst.ts';
import { attributeToExporter, exporterProfile } from './exporter.ts';
import { inferVersion } from './infer.ts';
import { parse } from './parser.ts';
import { indexXrefs, type XrefIndex } from './xref.ts';
import { checkPlausibility } from './plausibility.ts';
export { checkPlausibility } from './plausibility.ts';
export { upgradeToGedcom7 } from './modernize.ts';
export type { ModernizeResult } from './modernize.ts';

import {
  validate,
  type Strictness,
  type ValidationResult,
  type VersionSource,
} from './validate.ts';

export type FileFormat = 'gedcom' | 'gedcomx-json' | 'gedcomx-xml';

export interface Analysis {
  readonly version: GedcomVersion | null;
  /** How that version was arrived at, so a diagnostic can say. */
  readonly versionSource: VersionSource;
  readonly text: string;
  readonly document: Document;
  readonly xrefs: XrefIndex;
  readonly validation: ValidationResult;
  /** Every diagnostic from lexing, parsing, cross-referencing and validation. */
  readonly diagnostics: readonly Diagnostic[];
  /** File format: standard line-based GEDCOM, GEDCOM X JSON, or GEDCOM X XML. */
  readonly format?: FileFormat;
}

export interface AnalyzeOptions {
  readonly strictness?: Strictness;
  /** Overrides detection. Useful when the header lies or is absent. */
  readonly version?: GedcomVersion | null;
}

import { isGedcomX, detectGedcomXFormat, gedcomXToGedcom7 } from './gedcomx/index.ts';
export * from './gedcomx/index.ts';

/** Full analysis of a GEDCOM stream, from raw bytes to diagnostics. */
export function analyze(bytes: Uint8Array, options: AnalyzeOptions = {}): Analysis {
  if (isGedcomX(bytes)) {
    const text = new TextDecoder('utf-8').decode(bytes);
    return analyzeText(text, options);
  }
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
  const gxFormat = isGedcomX(text) ? detectGedcomXFormat(text) : null;
  const actualText = gxFormat ? gedcomXToGedcom7(text) : text;
  const detected =
    options.version !== undefined
      ? options.version
      : detect(new TextEncoder().encode(actualText)).version;

  // Parsed twice where the exporter is one that writes broken continuations:
  // the first pass is only to read `HEAD.SOUR`, which is what says who wrote the
  // file. Cheap — the header is the first few lines — and it keeps the repair
  // policy a property of the document rather than a setting the caller must know
  // to pass.
  const first = parse(actualText);
  const profile = exporterProfile(first);
  const document = profile?.repairsContinuations
    ? parse(actualText, { joinOrphanLines: true, exporter: profile.name })
    : first;

  // Files without a GEDC structure cannot be detected but are common enough to
  // matter; fall back to inferring a generation from the vocabulary in use.
  const inferred = detected ?? inferVersion(document);
  const versionSource: VersionSource =
    detected !== null ? 'declared' : inferred !== null ? 'inferred' : 'unknown';

  const version = inferred;
  const xrefs = indexXrefs(document);
  const validation = validate(document, {
    version,
    versionSource,
    ...(options.strictness ? { strictness: options.strictness } : {}),
    xrefs,
  });

  // A deviation the exporter is known for is re-rated as its doing rather than
  // the reader's. Still reported — nothing is hidden — but as a warning naming
  // the program, so a screen of red over somebody else's bug becomes a screen of
  // amber with an explanation.
  const plausibilityDiags = checkPlausibility(document, xrefs);
  const byLine = new Map(document.structures.map((s) => [s.span.line, s.tag]));
  const diagnostics = attributeToExporter(
    [
      ...document.diagnostics,
      ...xrefs.diagnostics,
      ...validation.diagnostics,
      ...plausibilityDiags,
    ],
    profile,
    (diagnostic) => byLine.get(diagnostic.span.line),
  );

  const format: FileFormat =
    gxFormat === 'json' ? 'gedcomx-json' : gxFormat === 'xml' ? 'gedcomx-xml' : 'gedcom';

  return {
    version,
    versionSource,
    text: actualText,
    document,
    xrefs,
    validation,
    diagnostics,
    format,
  };
}

export * from './i18n/index.ts';
