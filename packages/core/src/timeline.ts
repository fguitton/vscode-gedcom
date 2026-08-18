/**
 * Life event timeline synthesizer.
 *
 * Gathers, dates, and chronologically arranges an individual's vital events,
 * marriages, children births, residences, and occupations with computed ages.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { readableDate, yearOf } from './date.ts';
import { relationsOf } from './relations.ts';
import { modelFor, tagLabel } from './spec/index.ts';
import { asPointer } from './xref.ts';

export interface TimelineEvent {
  readonly tag: string;
  readonly label: string;
  readonly detail?: string;
  readonly year?: number;
  readonly date?: string;
  readonly age?: string;
  readonly place?: string;
  readonly line?: number;
}

const norm = (xref: string) => xref.replace(/^@|@$/g, '');

const EVENT_TAGS = new Set([
  'BIRT',
  'CHR',
  'BAPM',
  'CONF',
  'BARM',
  'BASM',
  'GRAD',
  'EDUC',
  'OCCU',
  'RESI',
  'CENS',
  'NATU',
  'EMIG',
  'IMMI',
  'RETI',
  'PROB',
  'WILL',
  'DEAT',
  'BURI',
  'CREM',
  'EVEN',
]);

const TAG_ORDER: Record<string, number> = {
  BIRT: 10,
  CHR: 20,
  BAPM: 25,
  EDUC: 30,
  GRAD: 35,
  OCCU: 40,
  RESI: 45,
  CENS: 50,
  MARR: 60,
  CHIL: 65,
  DIV: 70,
  RETI: 80,
  DEAT: 90,
  BURI: 95,
  CREM: 96,
  PROB: 100,
  WILL: 105,
};

function nameOf(analysis: Analysis, xref: string): string {
  const record = analysis.xrefs.definitions.get(norm(xref));
  if (!record) return xref;
  const name = record.children
    .find((c) => c.tag === 'NAME')
    ?.payload?.replace(/\//g, '')
    .trim();
  return name || xref;
}

function childTag(structure: Structure, tag: string): Structure | undefined {
  return structure.children.find((c) => c.tag === tag);
}

function pointers(record: Structure, tag: string): string[] {
  const found: string[] = [];
  for (const child of record.children) {
    if (child.tag !== tag) continue;
    const pointer = asPointer(child);
    if (pointer !== null && pointer !== 'VOID') found.push(pointer);
  }
  return found;
}

import {
  formatTimelineAge,
  formatTimelineChildBirth,
  formatTimelineMarriage,
} from './i18n/index.ts';

/**
 * Extracts and synthesizes a chronological life timeline for an individual.
 */
export function individualTimeline(
  analysis: Analysis,
  xref: string,
  options: { locale?: string } = {},
): TimelineEvent[] {
  const id = norm(xref);
  const record = analysis.xrefs.definitions.get(id);
  if (!record || record.tag !== 'INDI') return [];

  // Find individual's birth year for calculating relative ages
  const birt = childTag(record, 'BIRT');
  const birtDate = birt ? childTag(birt, 'DATE')?.payload : undefined;
  const birthYear = birtDate ? yearOf(birtDate) : undefined;

  const events: TimelineEvent[] = [];

  const model = modelFor(analysis.version);

  // 1. Personal events directly on the INDI record
  for (const structure of record.children) {
    if (!EVENT_TAGS.has(structure.tag)) continue;

    const dateStr = childTag(structure, 'DATE')?.payload;
    const placeStr = childTag(structure, 'PLAC')?.payload;
    const year = dateStr ? yearOf(dateStr) : undefined;

    let age: string | undefined;
    if (birthYear !== undefined && year !== undefined) {
      const diff = year - birthYear;
      if (diff >= 0) {
        age = formatTimelineAge(diff, options.locale);
      }
    } else if (structure.tag === 'BIRT') {
      age = formatTimelineAge(0, options.locale);
    }

    const label = tagLabel(model, structure.tag, null, options.locale) || structure.tag;
    const detail = structure.payload?.trim() || undefined;

    events.push({
      tag: structure.tag,
      label,
      detail,
      year: year ?? undefined,
      date: dateStr ? readableDate(dateStr, options.locale) : undefined,
      age,
      place: placeStr ? placeStr.replace(/,/g, ', ') : undefined,
      line: structure.span.line,
    });
  }

  // 2. Family events: Marriages and Child births from spouse families
  const rels = relationsOf(analysis, id);
  for (const famId of rels.spouseFamilies) {
    const fam = analysis.xrefs.definitions.get(famId);
    if (!fam) continue;

    // Marriage to partner
    const partners = [...pointers(fam, 'HUSB'), ...pointers(fam, 'WIFE')].filter((p) => p !== id);
    const partnerName = partners.length > 0 ? nameOf(analysis, partners[0]!) : 'spouse';

    const marr = childTag(fam, 'MARR');
    if (marr) {
      const dateStr = childTag(marr, 'DATE')?.payload;
      const placeStr = childTag(marr, 'PLAC')?.payload;
      const year = dateStr ? yearOf(dateStr) : undefined;

      let age: string | undefined;
      if (birthYear !== undefined && year !== undefined && year >= birthYear) {
        age = formatTimelineAge(year - birthYear, options.locale);
      }

      events.push({
        tag: 'MARR',
        label: formatTimelineMarriage(partnerName, options.locale),
        year: year ?? undefined,
        date: dateStr ? readableDate(dateStr, options.locale) : undefined,
        age,
        place: placeStr ? placeStr.replace(/,/g, ', ') : undefined,
        line: marr.span.line,
      });
    }

    // Birth of each child
    for (const childId of pointers(fam, 'CHIL')) {
      const childRecord = analysis.xrefs.definitions.get(childId);
      if (!childRecord) continue;

      const childName = nameOf(analysis, childId);
      const childBirt = childTag(childRecord, 'BIRT');
      const dateStr = childBirt ? childTag(childBirt, 'DATE')?.payload : undefined;
      const placeStr = childBirt ? childTag(childBirt, 'PLAC')?.payload : undefined;
      const year = dateStr ? yearOf(dateStr) : undefined;

      let age: string | undefined;
      if (birthYear !== undefined && year !== undefined && year >= birthYear) {
        age = formatTimelineAge(year - birthYear, options.locale);
      }

      events.push({
        tag: 'CHIL',
        label: formatTimelineChildBirth(childName, options.locale),
        year: year ?? undefined,
        date: dateStr ? readableDate(dateStr, options.locale) : undefined,
        age,
        place: placeStr ? placeStr.replace(/,/g, ', ') : undefined,
        line: childBirt?.span.line ?? childRecord.span.line,
      });
    }
  }

  // 3. Chronological sorting
  events.sort((a, b) => {
    if (a.year !== undefined && b.year !== undefined) {
      if (a.year !== b.year) return a.year - b.year;
    } else if (a.year !== undefined) {
      return -1;
    } else if (b.year !== undefined) {
      return 1;
    }

    const orderA = TAG_ORDER[a.tag] ?? 50;
    const orderB = TAG_ORDER[b.tag] ?? 50;
    return orderA - orderB;
  });

  return events;
}
