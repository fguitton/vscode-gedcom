/**
 * Accessors over the generated specification model.
 *
 * Resolving a structure means walking the tree from the root: a tag alone is
 * ambiguous, because `DATE` under `BIRT` and `DATE` under `CHAN` are different
 * structures with different payloads and different substructures. Every lookup
 * here is therefore keyed by the enclosing structure's slug.
 */

import type { GedcomVersion } from '../detect.ts';
import { MODELS } from './model.generated.ts';
import { parseCardinality, type Cardinality, type PayloadSpec, type SpecModel } from './types.ts';

export type { Cardinality, PayloadSpec, SpecModel } from './types.ts';
export { parseCardinality } from './types.ts';
export { glossOf } from './glossary.ts';

/** Versions the model covers. Others fall back to the nearest modelled one. */
export type ModelledVersion = '7.0' | '5.5.1';

/**
 * Maps a detected version onto the closest modelled vocabulary.
 * 5.5.5 added no tags over 5.5.1, so it shares that model; the differences
 * between them are all in serialization rules, not vocabulary.
 */
export function modelledVersion(version: GedcomVersion | null): ModelledVersion {
  switch (version) {
    case '7.0':
      return '7.0';
    case '5.5.5':
    case '5.5.1':
    case '5.5 EL':
    case '5.5':
    case '5.6':
    case '5.4':
    case '5.3':
    case '5.0':
    case '4.0':
    case '3.0':
    case 'PAF':
      return '5.5.1';
    default:
      // An unidentifiable file falls back to the older, leniently-checked
      // vocabulary. Guessing 7.0 and validating strictly would flood a file we
      // could not even identify with errors — see inferVersion for why such
      // files are common enough to matter.
      return '5.5.1';
  }
}

export function modelFor(version: GedcomVersion | null): SpecModel {
  return MODELS[modelledVersion(version)]!;
}

/** The records permitted at level 0, keyed by tag. */
export function recordsOf(model: SpecModel): Record<string, { s: string; c: string }> {
  return model.subs[''] ?? {};
}

/** Resolves a tag within an enclosing structure, or null if not permitted there. */
export function resolveSubstructure(
  model: SpecModel,
  parentSlug: string | null,
  tag: string,
): { slug: string; cardinality: Cardinality } | null {
  const context = model.subs[parentSlug ?? ''];
  const entry = context?.[tag];
  if (!entry) return null;
  return { slug: entry.s, cardinality: parseCardinality(entry.c) };
}

/** True when the tag appears anywhere in the vocabulary, in any context. */
export function isKnownTag(model: SpecModel, tag: string): boolean {
  return Object.values(model.tags).includes(tag);
}

export function payloadOf(model: SpecModel, slug: string): PayloadSpec | undefined {
  return model.payloads[slug];
}

export function enumValuesOf(model: SpecModel, slug: string): readonly string[] | undefined {
  return model.enums[slug];
}

/**
 * Human-readable name for a structure.
 *
 * Only the 7.x registry carries labels, so a 5.5.1 structure falls back to the
 * 7.x label for a structure of the same slug where one exists — the vocabularies
 * overlap heavily and a shared slug means a shared meaning.
 */
export function labelOf(model: SpecModel, slug: string): string | undefined {
  return model.labels[slug] ?? MODELS['7.0']?.labels[slug];
}

/**
 * Names for the twelve tags the registry labels nowhere.
 *
 * All of them are 5.5.1-era structures that GEDCOM 7 dropped, so no 7.x label
 * exists to fall back to. Without these, anything showing a tag by name — a
 * hover title, a graph edge — has to print the tag itself, which is the thing
 * the reader wanted translated.
 */
const UNLABELLED: Record<string, string> = {
  ANCE: 'Ancestors',
  CHAR: 'Character set',
  DESC: 'Descendants',
  EVEN: 'Event',
  FACT: 'Fact',
  FAMF: 'Family file',
  FONE: 'Phonetic variation',
  ORDI: 'Ordinance process flag',
  RELA: 'Relationship to the individual',
  ROMN: 'Romanised variation',
  STAT: 'Status',
  SUBN: 'Submission',
};

/**
 * Vendor tags common enough in real files to be worth naming.
 *
 * No specification defines these and the registry does not know them, so each
 * one is a claim about what a particular program meant by it. The list is
 * deliberately short: only tags whose meaning is unambiguous and attested across
 * many files, because a confidently wrong label is worse than a bare tag.
 *
 * `COMM` is PAF's comment field, and Linguist's own `Royal92.ged` uses it to
 * carry the note explaining where the file came from.
 */
export const VENDOR_TAGS: Record<string, string> = {
  COMM: 'Comment',
  _AKA: 'Also known as',
  _AKAN: 'Also known as',
  _EMAIL: 'Email',
  _FREL: 'Relationship to father',
  _MREL: 'Relationship to mother',
  _MARNM: 'Married name',
  _BIRN: 'Birth name',
  _ADPN: 'Adopted name',
  _PRIM: 'Primary',
  _UID: 'Unique identifier',
};

/**
 * What a record is called when you are counting them.
 *
 * `3,010 INDI · 1,422 FAM` is the file talking to itself. A reader wants
 * "3,010 individuals · 1,422 families", and the registry's own labels do not
 * give that: they are singular, title-cased, and sometimes name the record
 * rather than the thing ("Family record").
 */
const RECORD_NOUNS: Record<string, readonly [string, string]> = {
  INDI: ['individual', 'individuals'],
  FAM: ['family', 'families'],
  SUBM: ['submitter', 'submitters'],
  SOUR: ['source', 'sources'],
  REPO: ['repository', 'repositories'],
  OBJE: ['media object', 'media objects'],
  NOTE: ['note', 'notes'],
  SNOTE: ['note', 'notes'],
  SUBN: ['submission', 'submissions'],
};

import { translateRecordNoun, translateTag } from '../i18n/index.ts';

/**
 * The plain English word for a kind of record, in the right number.
 *
 * A file may hold records nobody anticipated — a vendor's `_LOC`, say — so the
 * label is used where there is one and the tag itself where there is not. A tag
 * is a poor word but an honest one; an invented plural of an unknown noun is
 * neither.
 */
export function recordNoun(tag: string, count: number, label?: string, locale?: string): string {
  const english = (() => {
    const known = RECORD_NOUNS[tag];
    if (known) return count === 1 ? known[0] : known[1];

    if (label && label !== tag) {
      const lower = label.toLowerCase();
      return count === 1 ? lower : `${lower}s`;
    }

    return tag;
  })();

  return translateRecordNoun(tag, count, english, locale);
}

/**
 * The human-readable name of a tag, in the plainest form available.
 *
 * Tries the resolved slug first, since that is context-qualified and therefore
 * the most precise; then the tag read as a slug, which covers most structures;
 * then the two tables. Falls back to the tag itself, which is never wrong, only
 * unhelpful.
 */
export function tagLabel(
  model: SpecModel,
  tag: string,
  slug?: string | null,
  locale?: string,
): string {
  const english =
    (slug ? labelOf(model, slug) : undefined) ??
    labelOf(model, tag) ??
    // Records are slugged `record-INDI`, never bare, so a caller that has only
    // the tag — a diagnostic naming an enclosing structure, say — would
    // otherwise never find a label for the commonest structures in the format.
    labelOf(model, `record-${tag}`) ??
    UNLABELLED[tag] ??
    VENDOR_TAGS[tag] ??
    tag;

  return translateTag(tag, english, locale);
}

/** Tags allowed directly inside a structure, for completion. */
export function completionsFor(model: SpecModel, parentSlug: string | null): string[] {
  return Object.keys(model.subs[parentSlug ?? ''] ?? {}).sort();
}

export function isExtensionTag(tag: string): boolean {
  return tag.startsWith('_');
}

/**
 * True for a tag a known program wrote without an underscore.
 *
 * Underscoring extensions was a convention before it was a rule, and the files
 * that predate it are exactly the files still in circulation — `COMM` is PAF's,
 * and Linguist's own sample uses it. Reporting one as an unknown tag is
 * technically true and unhelpful: nothing is wrong with the file, and there is
 * nothing for the reader to fix.
 */
export function isVendorTag(tag: string): boolean {
  return tag in VENDOR_TAGS && !isExtensionTag(tag);
}

/** Every tag a model knows, in any context. */
function vocabularyOf(model: SpecModel): Set<string> {
  return new Set(Object.values(model.tags));
}

const VOCABULARIES: Record<ModelledVersion, Set<string>> = {
  '7.0': vocabularyOf(MODELS['7.0']!),
  '5.5.1': vocabularyOf(MODELS['5.5.1']!),
};

/**
 * True when a tag belongs to the *other* GEDCOM generation and was removed from
 * this one — `SUBN` or `ROMN` inside a 7.0 file, say.
 *
 * This is the migration signal. Such a tag is not merely unknown: it had a
 * meaning that the target version deliberately dropped, usually in favour of a
 * replacement, and saying so is far more useful than reporting it as unknown.
 */
export function isRemovedInVersion(version: GedcomVersion | null, tag: string): boolean {
  const current = modelledVersion(version);
  const other: ModelledVersion = current === '7.0' ? '5.5.1' : '7.0';
  return !VOCABULARIES[current].has(tag) && VOCABULARIES[other].has(tag);
}

/**
 * What GEDCOM 7 put in place of a structure it removed.
 *
 * Taken from the official migration guide. Knowing a tag was dropped is useful;
 * knowing what to write instead is what someone converting a file actually needs.
 * Tags removed without a replacement map to null and are reported as such.
 */
const REPLACED_BY_V7: Record<string, string | null> = {
  AFN: 'EXID',
  RFN: 'EXID',
  RIN: 'EXID',
  FONE: 'TRAN',
  ROMN: 'TRAN',
  RELA: 'ROLE',
  SUBN: null,
  ANCE: null,
  DESC: null,
  FAMF: null,
  ORDI: null,
  CHAR: null,
};

/**
 * A sentence explaining a removed tag, or undefined when the tag is not one.
 * Only the 5.5.1 to 7.0 direction has a documented mapping; a 7.0 tag found in an
 * older file is simply newer than that file claims to be.
 */
export function removalNote(version: GedcomVersion | null, tag: string): string | undefined {
  if (!isRemovedInVersion(version, tag)) return undefined;

  if (modelledVersion(version) !== '7.0') {
    return `\`${tag}\` was introduced after this version of GEDCOM.`;
  }

  if (!(tag in REPLACED_BY_V7)) return `\`${tag}\` was removed in GEDCOM 7.`;

  const replacement = REPLACED_BY_V7[tag];
  return replacement === null
    ? `\`${tag}\` was removed in GEDCOM 7 with no replacement.`
    : `\`${tag}\` was removed in GEDCOM 7; use \`${replacement}\` instead.`;
}
