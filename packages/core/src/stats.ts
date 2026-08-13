/**
 * Whole-file statistics.
 *
 * The one thing every reader wants on opening an unfamiliar GEDCOM — how big is
 * this, what period does it cover, how sound is it — and the one thing the format
 * makes you scroll thirty thousand lines to find out. The header says who exported
 * the file and when, and nothing whatever about what is in it.
 */

import type { Analysis } from './index.ts';
import { yearOf } from './date.ts';
import { walk } from './cst.ts';

export interface Statistics {
  /** Record counts by tag, `INDI` and `FAM` foremost. */
  readonly records: Readonly<Record<string, number>>;
  readonly total: number;
  /** The span of years the file's dates cover, ignoring anything implausible. */
  readonly earliest?: number;
  readonly latest?: number;
  /** Pointers with no matching record. */
  readonly dangling: number;
  /** Records nothing points at. */
  readonly unreferenced: number;
}

/**
 * Dates below this are almost always a typo or a placeholder year, and one of them
 * would otherwise set the earliest date for the whole file.
 */
const PLAUSIBLE_FROM = 1000;

export function statistics(analysis: Analysis): Statistics {
  const records: Record<string, number> = {};
  let earliest: number | undefined;
  let latest: number | undefined;

  const currentYear = new Date().getUTCFullYear();

  for (const record of analysis.document.records) {
    records[record.tag] = (records[record.tag] ?? 0) + 1;

    for (const structure of walk(record)) {
      if (structure.tag !== 'DATE' && structure.tag !== 'SDATE') continue;
      const year = structure.payload ? yearOf(structure.payload) : undefined;
      if (year === undefined || year < PLAUSIBLE_FROM || year > currentYear) continue;
      if (earliest === undefined || year < earliest) earliest = year;
      if (latest === undefined || year > latest) latest = year;
    }
  }

  let unreferenced = 0;
  for (const [xref] of analysis.xrefs.definitions) {
    if ((analysis.xrefs.referencesTo.get(xref)?.length ?? 0) === 0) unreferenced += 1;
  }

  const dangling = analysis.xrefs.references.filter(
    (reference) => !analysis.xrefs.definitions.has(reference.xref),
  ).length;

  return {
    records,
    total: analysis.document.records.length,
    ...(earliest !== undefined ? { earliest } : {}),
    ...(latest !== undefined ? { latest } : {}),
    dangling,
    unreferenced,
  };
}
