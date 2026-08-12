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
  labelOf,
  modelFor,
  modelledVersion,
  payloadOf,
  removalNote,
  resolveSubstructure,
  type SpecModel,
} from './spec/index.ts';
import { asPointer, VOID_POINTER, type XrefIndex } from './xref.ts';

export type Strictness = 'strict' | 'lenient';

export interface ValidateOptions {
  readonly version: GedcomVersion | null;
  /** Defaults to strict for 7.x and lenient for everything older. */
  readonly strictness?: Strictness;
  readonly xrefs?: XrefIndex;
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

  for (const record of document.records) {
    visit(
      record,
      null,
      true,
      model,
      options.version,
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
    reportUnresolved(structure, model, version, strictness, documented, diagnostics);
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

  // Outside strict mode, only a tag unknown to the entire vocabulary is worth
  // reporting; one that is merely in the wrong place is not.
  if (!isKnownTag(model, structure.tag)) {
    // A tag the other generation defines is not unknown, it is *removed* — and
    // saying which structure replaced it is what someone converting a file needs.
    const removed = removalNote(version, structure.tag);
    diagnostics.push({
      code: removed ? 'removed-in-version' : 'unknown-tag',
      message: removed ?? `\`${structure.tag}\` is not a tag in this version of GEDCOM.`,
      severity: strictness === 'strict' ? 'error' : 'warning',
      span: structure.tagSpan,
    });
    return;
  }

  if (strictness === 'strict') {
    const context = structure.parent ? `\`${structure.parent.tag}\`` : 'the document root';
    diagnostics.push({
      code: 'tag-not-allowed-here',
      message: `\`${structure.tag}\` is not permitted inside ${context}.`,
      severity: 'error',
      span: structure.tagSpan,
    });
  }
}

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

  const values = enumValuesOf(model, slug);
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

  if (spec.type !== 'pointer' || spec.to === undefined || !xrefs) return;

  const pointer = asPointer(structure);
  if (pointer === null || pointer === VOID_POINTER) return;

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
      diagnostics.push({
        code: 'cardinality-violation',
        message: `\`${structure.tag}\` permits at most ${max} \`${tag}\` substructure${max === 1 ? '' : 's'}, found ${present.length}.`,
        severity: 'error',
        span: present[max]!.tagSpan,
      });
    }
  }
}

function parseCardinalityText(text: string): { min: number; max: number } {
  const match = /^\{(\d+):(\d+|M)\}$/.exec(text);
  if (!match) return { min: 0, max: Infinity };
  return { min: Number(match[1]), max: match[2] === 'M' ? Infinity : Number(match[2]) };
}
