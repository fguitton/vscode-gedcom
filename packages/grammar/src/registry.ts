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
