/**
 * Version inference for files the official detection algorithm cannot identify.
 *
 * Detection requires a `1 GEDC` / `2 VERS` pair, and files without one are
 * formally "not a valid GEDCOM file". They are not rare in practice: Linguist's
 * own GEDCOM sample, Royal92.ged, is a 1992 PAF export with no GEDC structure at
 * all, and it is the file GitHub renders as *the* example of the language.
 *
 * Treating those as unknown and defaulting to strict GEDCOM 7 would paint the
 * most-viewed GEDCOM file on the internet red. Instead, infer a generation from
 * structures that only exist on one side of the 5.5.1/7.0 split.
 */

import type { Document } from './cst.ts';
import type { GedcomVersion } from './detect.ts';

/** Structures introduced by GEDCOM 7 and absent from 5.5.1. */
const SEVEN_ONLY = new Set(['SCHMA', 'SNOTE', 'EXID', 'TRAN', 'CREA', 'INIL', 'SDATE', 'NO']);

/** Structures present in 5.5.1 and removed by GEDCOM 7. */
const FIVE_ONLY = new Set([
  'CHAR',
  'SUBN',
  'RFN',
  'AFN',
  'RIN',
  'FONE',
  'ROMN',
  'RELA',
  'ANCE',
  'DESC',
  'CONC',
]);

/**
 * Guesses a generation from the vocabulary a document actually uses.
 * Returns null when there is no evidence either way.
 */
export function inferVersion(document: Document): GedcomVersion | null {
  let seven = 0;
  let five = 0;

  for (const structure of document.structures) {
    if (SEVEN_ONLY.has(structure.tag)) seven++;
    if (FIVE_ONLY.has(structure.tag)) five++;
  }

  if (seven > five) return '7.0';
  if (five > seven) return '5.5.1';
  return null;
}
