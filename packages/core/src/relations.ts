/**
 * Genealogical relationships, resolved through the family records that carry them.
 *
 * GEDCOM never states that two people are siblings. It states that each of them
 * is a `CHIL` of the same `FAM`, and the reader is expected to join the two. Every
 * question worth asking about a person — how many children, who their parents
 * were, whether they had more than one spouse — is that same join, which is why
 * it belongs here rather than being re-derived by each caller.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { asPointer } from './xref.ts';

export interface Relations {
  /** Families this person is a spouse in, via FAMS. */
  readonly spouseFamilies: string[];
  /** Families this person is a child in, via FAMC. */
  readonly childFamilies: string[];
  readonly spouses: string[];
  readonly children: string[];
  readonly parents: string[];
  /** Everyone sharing a parent family, excluding the person themselves. */
  readonly siblings: string[];
}

const EMPTY: Relations = {
  spouseFamilies: [],
  childFamilies: [],
  spouses: [],
  children: [],
  parents: [],
  siblings: [],
};

/** Pointer payloads of a record's direct children bearing the given tag. */
function pointers(record: Structure, tag: string): string[] {
  const found: string[] = [];
  for (const child of record.children) {
    if (child.tag !== tag) continue;
    const pointer = asPointer(child);
    if (pointer !== null && pointer !== 'VOID') found.push(pointer);
  }
  return found;
}

const unique = (values: string[]): string[] => [...new Set(values)];

/** Everything a person's family memberships imply about them. */
export function relationsOf(analysis: Analysis, xref: string): Relations {
  const record = analysis.xrefs.definitions.get(xref);
  if (!record || record.tag !== 'INDI') return EMPTY;

  const family = (id: string) => analysis.xrefs.definitions.get(id);

  const spouseFamilies = pointers(record, 'FAMS');
  const childFamilies = pointers(record, 'FAMC');

  const spouses: string[] = [];
  const children: string[] = [];
  for (const id of spouseFamilies) {
    const fam = family(id);
    if (!fam) continue;
    for (const partner of [...pointers(fam, 'HUSB'), ...pointers(fam, 'WIFE')]) {
      if (partner !== xref) spouses.push(partner);
    }
    children.push(...pointers(fam, 'CHIL'));
  }

  const parents: string[] = [];
  const siblings: string[] = [];
  for (const id of childFamilies) {
    const fam = family(id);
    if (!fam) continue;
    parents.push(...pointers(fam, 'HUSB'), ...pointers(fam, 'WIFE'));
    for (const sibling of pointers(fam, 'CHIL')) {
      if (sibling !== xref) siblings.push(sibling);
    }
  }

  return {
    spouseFamilies,
    childFamilies,
    spouses: unique(spouses),
    children: unique(children),
    parents: unique(parents),
    siblings: unique(siblings),
  };
}

/** The year part of a record's first date under the given event tag. */
export function eventYear(analysis: Analysis, xref: string, tag: string): number | undefined {
  const record = analysis.xrefs.definitions.get(xref);
  const event = record?.children.find((c) => c.tag === tag);
  const date = event?.children.find((c) => c.tag === 'DATE')?.payload;
  const year = date?.match(/\b(\d{3,4})\b(?!.*\b\d{3,4}\b)/)?.[1];
  return year ? Number(year) : undefined;
}

/** `1901–1975`, or a single year, or undefined when neither is recorded. */
export function lifespan(analysis: Analysis, xref: string): string | undefined {
  const birth = eventYear(analysis, xref, 'BIRT');
  const death = eventYear(analysis, xref, 'DEAT');
  if (birth === undefined && death === undefined) return undefined;
  return `${birth ?? '?'}–${death ?? ''}`.replace(/–$/, '–');
}
