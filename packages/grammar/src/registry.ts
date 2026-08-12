/**
 * Reads the pinned snapshot of the FamilySearch GEDCOM registries and exposes the
 * vocabulary the grammar needs.
 *
 * Source: https://github.com/familysearch/GEDCOM-registries
 * The snapshot lives in vendor/registries/ so grammar generation is reproducible
 * and offline. Refresh it with `node packages/grammar/src/refresh.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');
const registryDir = join(repoRoot, 'vendor', 'registries');

function readTsv(name: string): string[][] {
  const text = readFileSync(join(registryDir, name), 'utf8');
  return text
    .split(/\r?\n/)
    .slice(1) // header
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

/**
 * substructures.tsv columns: superstructure URI, tag, structure URI.
 * The tag column is authoritative — deriving tags from URI slugs is wrong for
 * context-qualified structures such as `ADOP-FAMC` (tag: FAMC) and `DATE-exact`.
 */
function tagsForVersion(version: string): Set<string> {
  const marker = `/terms/${version}/`;
  const tags = new Set<string>();
  for (const row of readTsv('substructures.tsv')) {
    const tag = row[1];
    const structure = row[2];
    if (tag && structure?.includes(marker)) tags.add(tag);
  }
  return tags;
}

/** Tags defined by FamilySearch GEDCOM 7.x. */
export const v7Tags: ReadonlySet<string> = tagsForVersion('v7');

/** Tags defined by GEDCOM 5.5.1. Also covers 5.5.5, which did not add tags. */
export const v551Tags: ReadonlySet<string> = tagsForVersion('v5.5.1');

/**
 * CONC and CONT are line-continuation pseudo-structures, not structures, so they
 * are absent from the substructure graph for 5.5.1. They still need to tokenize.
 */
export const continuationTags = ['CONC', 'CONT'] as const;

/**
 * Every tag the grammar treats as "known". The grammar is deliberately
 * version-agnostic: all three GEDCOM generations share one line syntax, and a
 * lexer cannot know which version a file claims until it has read HEAD.GEDC.VERS.
 * Deciding whether a tag is legal *here* is the language server's job.
 */
export const knownTags: readonly string[] = [
  ...new Set([...v7Tags, ...v551Tags, ...continuationTags]),
].sort();

/** Record tags — structures that may carry a cross-reference identifier. */
export const recordTags: readonly string[] = [
  ...new Set(
    readTsv('substructures.tsv')
      .filter((row) => row[0] === '' && row[1] !== undefined)
      .map((row) => row[1] as string),
  ),
].sort();

/**
 * Calendars. GEDCOM 5.5.1 writes these inside a date escape (`@#DJULIAN@`);
 * GEDCOM 7 writes them as a bare leading keyword (`JULIAN 1401`).
 */
export const calendars = ['GREGORIAN', 'JULIAN', 'HEBREW', 'FRENCH_R', 'ROMAN', 'UNKNOWN'] as const;

/** Month abbreviations across every calendar the spec defines. */
export const months = [
  // Gregorian and Julian
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
  // Hebrew
  'TSH',
  'CSH',
  'KSL',
  'TVT',
  'SHV',
  'ADR',
  'ADS',
  'NSN',
  'IYR',
  'SVN',
  'TMZ',
  'AAV',
  'ELL',
  // French Republican
  'VEND',
  'BRUM',
  'FRIM',
  'NIVO',
  'PLUV',
  'VENT',
  'GERM',
  'FLOR',
  'PRAI',
  'MESS',
  'THER',
  'FRUC',
  'COMP',
] as const;

/** Date range, period and approximation keywords, plus epoch markers. */
export const dateKeywords = [
  'FROM',
  'TO',
  'BEF',
  'AFT',
  'BET',
  'AND',
  'ABT',
  'CAL',
  'EST',
  'INT',
] as const;

export const epochs = ['BCE', 'BC', 'B.C.'] as const;

// --- semantic tag classes ---------------------------------------------------

/**
 * GEDCOM tags fall into classes that mean different things to a reader, and the
 * grammar colours them differently so a file is scannable without reading tag
 * names. The classes are *derived* from the registry rather than hand-listed, so
 * they cannot drift from the specification.
 *
 * Scope roots are chosen for what themes actually distinguish. That matters more
 * than usual here: GitHub renders this grammar through PrettyLights, an older
 * TextMate engine whose Primer theme separates fewer roots than a VS Code theme.
 */
export type TagClass =
  | 'envelope'
  | 'record'
  | 'event'
  | 'attribute'
  | 'linkage'
  | 'evidence'
  | 'administrative'
  | 'other';

/** Reads the structure graph out of the g7 validation model. */
function validationModel(): {
  tagInContext: { enum?: Record<string, Record<string, string>> };
  payload: Record<string, { type: string; to?: string }>;
} {
  return JSON.parse(readFileSync(join(registryDir, 'g7validation.json'), 'utf8')) as ReturnType<
    typeof validationModel
  >;
}

const V7 = 'https://gedcom.io/terms/v7/';

/**
 * Events versus attributes, derived from two enumeration sets.
 *
 * `DATA-EVEN` enumerates events *and* attributes together; `NO` enumerates only
 * things that can be asserted not to have happened, which is exactly the events.
 * The difference is therefore the attribute list, with no hand-maintenance.
 */
function eventsAndAttributes(): { events: Set<string>; attributes: Set<string> } {
  const model = validationModel();
  const values = (slug: string): Set<string> =>
    new Set(Object.values(model.tagInContext.enum?.[`${V7}${slug}`] ?? {}));

  const both = values('DATA-EVEN');
  const events = values('NO');
  const attributes = new Set([...both].filter((tag) => !events.has(tag)));
  return { events, attributes };
}

/** Tags whose payload is a pointer — the edges of the genealogical graph. */
function linkageTags(): Set<string> {
  const model = validationModel();
  const tags = new Set<string>();
  for (const [uri, payload] of Object.entries(model.payload)) {
    if (payload.type !== 'pointer' || !uri.startsWith(V7)) continue;
    const slug = uri.slice(V7.length);
    const tag = slug.split('-').pop();
    if (tag) tags.add(tag);
  }
  return tags;
}

/** Structures that may appear at level 0, plus the envelope that frames them. */
function recordTagsFromRegistry(): Set<string> {
  const tags = new Set<string>();
  for (const row of readTsv('substructures.tsv')) {
    if (row[0] === '' && row[1] && row[2]?.includes('/terms/v7/')) tags.add(row[1]);
  }
  return tags;
}

/**
 * Machinery rather than genealogy: the dataset envelope.
 *
 * Deliberately an explicit list. Deriving it by reachability from HEAD looks
 * elegant and is wrong: structures are shared, so ADDR is reachable from the
 * header through CORP, and everything beneath it — ADR1, CITY, POST — then looks
 * header-exclusive while ADDR itself does not. The envelope is nine tags that
 * have not changed in twenty-five years; naming them is clearer than a heuristic
 * that has to be re-derived to be trusted.
 */
const ENVELOPE_TAGS = new Set([
  'HEAD',
  'TRLR',
  'GEDC',
  'VERS',
  'SCHMA',
  'TAG',
  'DEST',
  'CHAR',
  'FORM',
]);

/** Citation and provenance: what a claim rests on rather than the claim itself. */
const EVIDENCE_TAGS = new Set([
  'PAGE',
  'QUAY',
  'DATA',
  'CALN',
  'MEDI',
  'AUTH',
  'PUBL',
  'ABBR',
  'TEXT',
  'NOTE',
  'SNOTE',
  'REPO',
]);

/**
 * Enduring facts that the enumeration sets do not cover.
 *
 * `DATA-EVEN` minus `NO` yields the classic attribute list, but the two most
 * important attributes of all are structural rather than enumerable: a person's
 * name and sex are never event-type values, so they must be named here.
 */
const CORE_ATTRIBUTE_TAGS = new Set(['NAME', 'SEX']);

/** Bookkeeping that describes the file rather than the family. */
const ADMINISTRATIVE_TAGS = new Set(['CHAN', 'CREA', 'RIN', 'UID', 'EXID', 'REFN', 'RESN']);

/**
 * Classifies every known tag. Order matters where a tag belongs to more than one
 * class: a record anchor is a record first, and an envelope tag is machinery even
 * when it shares a name with something meaningful elsewhere.
 */
export function classifyTags(): Map<string, TagClass> {
  const { events, attributes } = eventsAndAttributes();
  const records = recordTagsFromRegistry();
  const linkage = linkageTags();

  const classes = new Map<string, TagClass>();
  for (const tag of knownTags) {
    if (continuationTags.includes(tag as (typeof continuationTags)[number])) continue;

    // Envelope wins over record: HEAD and TRLR sit at level 0 but frame the
    // dataset rather than describing anyone in it.
    if (ENVELOPE_TAGS.has(tag)) classes.set(tag, 'envelope');
    else if (records.has(tag)) classes.set(tag, 'record');
    else if (linkage.has(tag)) classes.set(tag, 'linkage');
    else if (events.has(tag)) classes.set(tag, 'event');
    else if (ADMINISTRATIVE_TAGS.has(tag)) classes.set(tag, 'administrative');
    else if (EVIDENCE_TAGS.has(tag)) classes.set(tag, 'evidence');
    else if (attributes.has(tag) || CORE_ATTRIBUTE_TAGS.has(tag)) classes.set(tag, 'attribute');
    else classes.set(tag, 'other');
  }

  return classes;
}

/** Tags in each class, ready for a grammar alternation. */
export function tagsByClass(): Record<TagClass, string[]> {
  const grouped: Record<TagClass, string[]> = {
    envelope: [],
    record: [],
    event: [],
    attribute: [],
    linkage: [],
    evidence: [],
    administrative: [],
    other: [],
  };
  for (const [tag, tagClass] of classifyTags()) grouped[tagClass].push(tag);
  for (const list of Object.values(grouped)) list.sort();
  return grouped;
}
