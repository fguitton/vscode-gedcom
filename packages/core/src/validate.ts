/**
 * Registry-driven validation.
 *
 * Structural validity is a question about the tree, which is why none of this
 * could live in the TextMate grammar. Each structure is resolved against its
 * enclosing context, then checked for vocabulary, cardinality, enumerated values
 * and pointer target types.
 *
 * Strictness is deliberate policy, not an oversight. GEDCOM 7 is checked in full;
 * 5.5.1 is checked only for things that are unambiguously wrong under any
 * reading. Two decades of exporters produced 5.5.1 files that technically violate
 * the specification in ways every consumer tolerates, and an editor that paints
 * those files red is an editor people turn off.
 */

import type { Diagnostic, Document, Structure } from './cst.ts';
import type { GedcomVersion } from './detect.ts';
import {
  enumValuesOf,
  isExtensionTag,
  isKnownTag,
  isVendorTag,
  labelOf,
  modelFor,
  modelledVersion,
  payloadOf,
  removalNote,
  resolveSubstructure,
  tagLabel,
  type ModelledVersion,
  type SpecModel,
} from './spec/index.ts';
import { dateProblems } from './date.ts';
import { enumSetFor, valuesOfSet } from './enums.ts';
import { asPointer, VOID_POINTER, type XrefIndex } from './xref.ts';

export type Strictness = 'strict' | 'lenient';

/**
 * How the version being validated against was arrived at.
 *
 * This belongs in the diagnostic. "Not a tag in this version of GEDCOM" asks the
 * reader to take on trust both which version that is and how we decided — and
 * when the answer is "we guessed from the tags in use", they deserve to know,
 * because the right fix may be to correct the header rather than the line.
 */
export type VersionSource =
  /** Read from `HEAD.GEDC.VERS`, per the official detection algorithm. */
  | 'declared'
  /** Guessed from the vocabulary, because the file declares no version. */
  | 'inferred'
  /** Neither worked; the default vocabulary is in use. */
  | 'unknown';

export interface ValidateOptions {
  readonly version: GedcomVersion | null;
  readonly versionSource?: VersionSource;
  /** Defaults to strict for 7.x and lenient for everything older. */
  readonly strictness?: Strictness;
  readonly xrefs?: XrefIndex;
}

/** Where a reader can check the vocabulary for themselves. */
const SPEC_URLS: Record<ModelledVersion, string> = {
  '7.0': 'https://gedcom.io/specifications/FamilySearchGEDCOMv7.html',
  '5.5.1': 'https://gedcom.io/specifications/ged551.pdf',
};

/**
 * A clause naming the version, where it came from, and where to read the rules.
 *
 * "Not a tag in this version of GEDCOM" asks the reader to take on trust both
 * which version that is and how we decided. When the answer is "we guessed from
 * the tags in use", they especially deserve to know, because the right fix may
 * be to correct the header rather than the line.
 */
function provenance(version: GedcomVersion | null, source: VersionSource): string {
  const modelled = modelledVersion(version);
  const spec = `[the ${modelled} specification](${SPEC_URLS[modelled]})`;

  const how = (): string => {
    switch (source) {
      case 'declared':
        return version && version !== modelled
          ? `this file declares ${version} in \`HEAD.GEDC.VERS\`, and ${modelled} is the closest vocabulary we model`
          : `this file declares it in \`HEAD.GEDC.VERS\``;
      case 'inferred':
        return (
          'inferred from the tags in use, because this file declares no version in ' +
          '`HEAD.GEDC.VERS` — adding one will make this check exact'
        );
      default:
        return (
          'the default, because this file declares no version in `HEAD.GEDC.VERS` and its ' +
          'vocabulary was not conclusive either'
        );
    }
  };

  return `Checked against GEDCOM ${modelled} (${how()}). See ${spec}.`;
}

/** A structure resolved against the specification. */
export interface Resolution {
  readonly structure: Structure;
  /** Registry slug, or null when the structure is not in the vocabulary. */
  readonly slug: string | null;
  readonly label?: string;
}

export interface ValidationResult {
  readonly diagnostics: Diagnostic[];
  /** Every structure with the slug it resolved to, for hovers and completion. */
  readonly resolutions: Map<Structure, Resolution>;
}

export function validate(document: Document, options: ValidateOptions): ValidationResult {
  const model = modelFor(options.version);
  const strictness =
    options.strictness ?? (modelledVersion(options.version) === '7.0' ? 'strict' : 'lenient');

  const diagnostics: Diagnostic[] = [];
  const resolutions = new Map<Structure, Resolution>();
  const documented = collectSchemaTags(document);

  const source = options.versionSource ?? 'unknown';

  for (const record of document.records) {
    visit(
      record,
      null,
      true,
      model,
      options.version,
      source,
      strictness,
      documented,
      diagnostics,
      resolutions,
      options.xrefs,
    );
  }

  return { diagnostics, resolutions };
}

/**
 * Extension tags declared in `HEAD.SCHMA`, which map an underscore tag to a URI.
 * A declared extension is documented and must not be reported as unknown.
 */
function collectSchemaTags(document: Document): Set<string> {
  const tags = new Set<string>();
  const head = document.records.find((record) => record.tag === 'HEAD');
  const schema = head?.children.find((child) => child.tag === 'SCHMA');
  for (const definition of schema?.children ?? []) {
    if (definition.tag !== 'TAG' || definition.payload === null) continue;
    const tag = definition.payload.split(' ')[0];
    if (tag) tags.add(tag);
  }
  return tags;
}

function visit(
  structure: Structure,
  parentSlug: string | null,
  /**
   * Whether the enclosing context is one the specification describes.
   *
   * `parentSlug` being null is ambiguous on its own: at level 0 it means the
   * document root, but inside an unresolved structure it means we have no idea
   * what is permitted. Conflating the two checks the children of an extension
   * record against the list of valid *records* — which is how a file declaring
   * `0 @2@ _ALL_LANGUAGES` earned one error per substructure.
   *
   * An extension may carry any substructures unless it documents otherwise, so
   * once the context is unknown, its whole subtree goes unchecked.
   */
  contextKnown: boolean,
  model: SpecModel,
  version: GedcomVersion | null,
  source: VersionSource,
  strictness: Strictness,
  documented: Set<string>,
  diagnostics: Diagnostic[],
  resolutions: Map<Structure, Resolution>,
  xrefs: XrefIndex | undefined,
): void {
  const resolved = contextKnown ? resolveSubstructure(model, parentSlug, structure.tag) : null;
  const slug = resolved?.slug ?? null;

  resolutions.set(structure, {
    structure,
    slug,
    ...(slug ? { label: labelOf(model, slug) } : {}),
  });

  if (contextKnown && resolved === null) {
    reportUnresolved(structure, model, version, source, strictness, documented, diagnostics);
  }

  if (slug !== null) {
    checkPayload(structure, slug, model, strictness, diagnostics, xrefs);
    if (strictness === 'strict') checkCardinality(structure, slug, model, diagnostics);
  }

  for (const child of structure.children) {
    visit(
      child,
      slug,
      slug !== null,
      model,
      version,
      source,
      strictness,
      documented,
      diagnostics,
      resolutions,
      xrefs,
    );
  }
}

function reportUnresolved(
  structure: Structure,
  model: SpecModel,
  version: GedcomVersion | null,
  source: VersionSource,
  strictness: Strictness,
  documented: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (isExtensionTag(structure.tag)) {
    // Extensions are legitimate; an undeclared one is only a portability concern.
    if (!documented.has(structure.tag)) {
      diagnostics.push({
        code: 'undocumented-extension',
        message:
          `\`${structure.tag}\` is an extension tag with no \`HEAD.SCHMA.TAG\` declaration. ` +
          'Other applications cannot know what it means.',
        severity: 'hint',
        span: structure.tagSpan,
      });
    }
    return;
  }

  // A tag a known program wrote without an underscore is not a mistake, it is
  // history: the convention postdates the files still in circulation. Saying so
  // is worth doing, but as a note rather than as a fault.
  if (isVendorTag(structure.tag)) {
    diagnostics.push({
      code: 'undocumented-extension',
      message:
        `\`${structure.tag}\` is not in any GEDCOM specification. It is a vendor extension — ` +
        `commonly ${tagLabel(model, structure.tag).toLowerCase()} — written before the ` +
        'convention of prefixing extensions with an underscore. Nothing needs fixing.',
      severity: 'hint',
      span: structure.tagSpan,
    });
    return;
  }

  // Outside strict mode, only a tag unknown to the entire vocabulary is worth
  // reporting; one that is merely in the wrong place is not.
  if (!isKnownTag(model, structure.tag)) {
    // A tag the other generation defines is not unknown, it is *removed* — and
    // saying which structure replaced it is what someone converting a file needs.
    const removed = removalNote(version, structure.tag);
    // Naming the versions rather than saying "any version we model": a reader
    // told their tag is unknown needs to know unknown *to what* before they can
    // decide whether the tag or the checker is at fault.
    // "Not a tag in 7.0 or 5.5.1" reads as though those were the only versions
    // there have ever been. Six others shipped between 1987 and 1999, no machine
    // readable vocabulary exists for any of them, and files written to them are
    // still in circulation — so an unrecognised tag in an old file may be
    // perfectly correct and merely older than anything we can check against.
    const note =
      removed ??
      `\`${structure.tag}\` is in neither vocabulary we can check: GEDCOM 7.0 or 5.5.1. It may ` +
        'belong to an earlier version, for which no machine-readable vocabulary was ever ' +
        'published, or be an extension — if it is your own, prefix it with an underscore and ' +
        'declare it in `HEAD.SCHMA`.';

    diagnostics.push({
      code: removed ? 'removed-in-version' : 'unknown-tag',
      message: `${note} ${provenance(version, source)}`,
      severity: strictness === 'strict' ? 'error' : 'warning',
      span: structure.tagSpan,
    });
    return;
  }

  if (strictness === 'strict') {
    // Naming the enclosing structure in English as well as by tag: the reader is
    // being told a placement is wrong, and `\`FAMC\` is not permitted inside
    // \`SOUR\`` reads as two more codes to look up.
    const parent = structure.parent;
    const context = parent
      ? `\`${parent.tag}\` (${tagLabel(model, parent.tag)})`
      : 'the document root';

    diagnostics.push({
      code: 'tag-not-allowed-here',
      message:
        `\`${structure.tag}\` (${tagLabel(model, structure.tag)}) is not permitted inside ` +
        `${context}. ${provenance(version, source)}`,
      severity: 'error',
      span: structure.tagSpan,
    });
  }
}

/**
 * Structures GEDCOM 5.5.1 lets you write either way.
 *
 * Each has a record form and an inline form: `NOTE_STRUCTURE`, `SOURCE_CITATION`,
 * `MULTIMEDIA_LINK` and `SOURCE_REPOSITORY_CITATION` are all defined twice in the
 * grammar, once pointing at a record and once carrying the content in place. The
 * registry we generate from records only the pointer form, so a file using the
 * other — which is most files — would otherwise be reported as broken.
 */
const INLINE_OR_POINTER = new Set(['NOTE', 'SOUR', 'OBJE', 'REPO']);

function checkPayload(
  structure: Structure,
  slug: string,
  model: SpecModel,
  strictness: Strictness,
  diagnostics: Diagnostic[],
  xrefs: XrefIndex | undefined,
): void {
  const spec = payloadOf(model, slug);
  if (!spec) return;

  // The registry gives enumerations for GEDCOM 7 only, so a 5.5.1 file — which
  // is most files — had nothing to check its coded values against and `2 QUAY 4`
  // went unreported. The sets written out in `enums.ts` cover both generations,
  // and are the fallback where the registry is silent.
  const values =
    enumValuesOf(model, slug) ??
    valuesOfSet(enumSetFor(slug, structure.tag, structure.parent?.tag) ?? '');

  if (values && structure.payload !== null) {
    // Some payloads are a comma-separated list of enumerated values rather than
    // a single one — `SOUR.DATA.EVEN` is typed `List#Enum` and legitimately
    // reads `BIRT, CHR`. Checking the whole payload against the value set would
    // reject every list of more than one element.
    const items = spec.type.includes('List')
      ? structure.payload.split(',').map((item) => item.trim())
      : [structure.payload];

    for (const item of items) {
      if (values.includes(item)) continue;
      // An extension value may be an underscore tag or a URI.
      if (isExtensionTag(item) || item.includes(':')) continue;

      diagnostics.push({
        code: 'enum-value-unknown',
        message:
          `\`${item}\` is not a valid value for \`${structure.tag}\`. ` +
          `Expected one of: ${values.join(', ')}.`,
        severity: strictness === 'strict' ? 'error' : 'warning',
        span: structure.payloadSpan ?? structure.tagSpan,
      });
    }
  }

  // A month that is not a month, or a day the month cannot have. Narrow on
  // purpose — see `dateProblems` — because a date payload has a dozen legal
  // shapes and a validator that guesses would condemn correct files.
  if (/date/i.test(spec.type) && structure.payload !== null) {
    for (const problem of dateProblems(structure.payload)) {
      diagnostics.push({
        code: 'date-invalid',
        message: problem,
        severity: 'error',
        span: structure.payloadSpan ?? structure.tagSpan,
      });
    }
  }

  if (spec.type !== 'pointer') return;

  const pointer = asPointer(structure);

  // A pointer payload must be *exactly* `@xref@`. Anything else — trailing text,
  // a second token, a bare word — is not a pointer that happens to be untidy; it
  // is a payload the specification does not admit, and nothing downstream will
  // resolve it. This is reported at every strictness because it is unambiguous
  // under any reading of any version.
  if (pointer === null) {
    // GEDCOM 5.5.1 lets several structures be written either as a pointer to a
    // record or inline, with the record's own substructures *in place of* the
    // payload — `1 OBJE` followed by `2 FORM` and `2 FILE` is the commonest, and
    // it appears in a great many real files. The registry models only the
    // pointer form, so demanding one would report a correct file as broken.
    //
    // Only the payload-less form is the inline one. A payload that is present
    // but is not a pointer is still wrong, substructures or not: `1 ASSO @I1@ df`
    // does not become acceptable by having a `ROLE` beneath it.
    if (structure.payload === null && structure.children.length > 0) return;

    // Except for the four structures 5.5.1 defines as *either* a pointer or the
    // thing itself written out. `1 NOTE @N1@` and `1 NOTE He was an accountant`
    // are both correct, and the second is what most exporters actually write —
    // MyHeritage, Ancestry and PAF files are full of inline notes. GEDCOM 7 split
    // the two apart (`SNOTE` points, `NOTE` holds text), so this only ever
    // applies to 5.5.x, which is the only generation whose registry models these
    // as pointers at all.
    if (INLINE_OR_POINTER.has(structure.tag)) return;

    diagnostics.push({
      code: 'malformed-pointer',
      message:
        structure.payload === null
          ? `\`${structure.tag}\` requires a pointer payload, such as \`@I1@\`.`
          : `\`${structure.tag}\` takes a pointer and nothing else, but its payload is ` +
            `\`${structure.payload.split('\n')[0]}\`. A pointer payload must be exactly ` +
            '`@xref@`, with no text before or after it.',
      severity: 'error',
      span: structure.payloadSpan ?? structure.tagSpan,
    });
    return;
  }

  if (pointer === VOID_POINTER || spec.to === undefined || !xrefs) return;

  const target = xrefs.definitions.get(pointer);
  if (!target) return; // Dangling pointers are reported by the xref index.

  const expectedTag = model.tags[spec.to];
  if (expectedTag && target.tag !== expectedTag) {
    diagnostics.push({
      code: 'pointer-target-mismatch',
      message:
        `\`${structure.tag}\` must point at a \`${expectedTag}\` record, ` +
        `but \`@${pointer}@\` is a \`${target.tag}\` record.`,
      severity: 'error',
      span: structure.payloadSpan ?? structure.tagSpan,
    });
  }
}

/**
 * Cardinality is checked once per parent, on the first child bearing each tag,
 * so a violation is reported once rather than on every offending sibling.
 */
function checkCardinality(
  structure: Structure,
  slug: string,
  model: SpecModel,
  diagnostics: Diagnostic[],
): void {
  const counts = new Map<string, Structure[]>();
  for (const child of structure.children) {
    const bucket = counts.get(child.tag);
    if (bucket) bucket.push(child);
    else counts.set(child.tag, [child]);
  }

  const allowed = model.subs[slug] ?? {};
  for (const [tag, entry] of Object.entries(allowed)) {
    const present = counts.get(tag) ?? [];
    const { min, max } = parseCardinalityText(entry.c);

    if (present.length < min) {
      diagnostics.push({
        code: 'cardinality-violation',
        message: `\`${structure.tag}\` requires ${min} \`${tag}\` substructure${min === 1 ? '' : 's'}, found ${present.length}.`,
        severity: 'error',
        span: structure.tagSpan,
      });
    }

    if (present.length > max) {
      const isSameSexSpouseTolerance =
        structure.tag === 'FAM' &&
        (tag === 'HUSB' || tag === 'WIFE') &&
        present.length === 2 &&
        max === 1 &&
        (counts.get(tag === 'HUSB' ? 'WIFE' : 'HUSB')?.length ?? 0) === 0;

      if (isSameSexSpouseTolerance) {
        diagnostics.push({
          code: 'cardinality-violation',
          message: `\`FAM\` permits at most 1 \`${tag}\` under the specification, but 2 are tolerated for same-sex unions.`,
          severity: 'information',
          span: present[max]!.tagSpan,
        });
      } else {
        diagnostics.push({
          code: 'cardinality-violation',
          message: `\`${structure.tag}\` permits at most ${max} \`${tag}\` substructure${max === 1 ? '' : 's'}, found ${present.length}.`,
          severity: 'error',
          span: present[max]!.tagSpan,
        });
      }
    }
  }
}

function parseCardinalityText(text: string): { min: number; max: number } {
  const match = /^\{(\d+):(\d+|M)\}$/.exec(text);
  if (!match) return { min: 0, max: Infinity };
  return { min: Number(match[1]), max: match[2] === 'M' ? Infinity : Number(match[2]) };
}
