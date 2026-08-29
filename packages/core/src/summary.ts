/**
 * Shared summary, descriptions, and CodeLens line builders across all file types
 * (.ged, GEDCOM X JSON, GEDCOM X XML).
 */

import type { Structure } from './cst.ts';
import type { Analysis } from './index.ts';
import { displayName } from './name.ts';
import { lifespan, relationsOf } from './relations.ts';
import { modelFor, recordNoun, tagLabel } from './spec/index.ts';
import { meaningOf, standalone } from './enums.ts';
import { statistics } from './stats.ts';
import { asPointer } from './xref.ts';

function resolveRecord(
  analysis: Analysis,
  recordOrXref: Structure | string,
): Structure | undefined {
  if (typeof recordOrXref === 'string') {
    return analysis.xrefs.definitions.get(recordOrXref);
  }
  return recordOrXref;
}

/**
 * A one-line title/summary of a record.
 */
export function summarizeRecord(record: Structure, analysis?: Analysis): string {
  const name = record.children.find((c) => c.tag === 'NAME')?.payload;
  if (name) return displayName(name);

  const title = record.children.find((c) => c.tag === 'TITL')?.payload;
  if (title) return title;

  if (record.payload) return record.payload.split('\n')[0]!.slice(0, 60);

  const spouse = (tag: string): string | undefined => {
    const structure = record.children.find((c) => c.tag === tag);
    if (!structure) return undefined;

    const pointer = asPointer(structure);
    if (pointer === null || !analysis) return structure.payload ?? undefined;

    const target = analysis.xrefs.definitions.get(pointer);
    const targetName = target?.children.find((c) => c.tag === 'NAME')?.payload;
    return (targetName ? displayName(targetName) : undefined) ?? structure.payload ?? undefined;
  };

  const husband = spouse('HUSB');
  const wife = spouse('WIFE');
  if (husband ?? wife) return `${husband ?? '?'} + ${wife ?? '?'}`;

  return record.tag;
}

/**
 * Detailed factual descriptors for a record (family, dates, citations).
 */
export function describeRecord(analysis: Analysis, recordOrXref: Structure | string): string[] {
  const record = resolveRecord(analysis, recordOrXref);
  if (!record) return [];

  const lines: string[] = [];
  const xref = record.xref;
  if (xref === null) return lines;

  if (record.tag === 'INDI') {
    const span = lifespan(analysis, xref);
    const coded = record.children.find((c) => c.tag === 'SEX')?.payload;
    const meaning = coded ? meaningOf(null, 'SEX', coded) : undefined;
    const facts = [meaning ? standalone(meaning.label) : coded, span].filter(Boolean);
    if (facts.length) lines.push(facts.join(' · '));

    const relations = relationsOf(analysis, xref);
    const counts: string[] = [];
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

    if (relations.parents.length) {
      counts.push(plural(relations.parents.length, 'parent', 'parents'));
    }
    if (relations.siblings.length) {
      counts.push(plural(relations.siblings.length, 'sibling', 'siblings'));
    }
    if (relations.spouses.length) {
      counts.push(plural(relations.spouses.length, 'spouse', 'spouses'));
    }
    if (relations.children.length) {
      counts.push(plural(relations.children.length, 'child', 'children'));
    }

    if (counts.length) lines.push(counts.join(' · '));
    else lines.push('_No family recorded._');
    return lines;
  }

  if (record.tag === 'FAM') {
    const children = record.children.filter((c) => c.tag === 'CHIL').length;
    const marriage = record.children
      .find((c) => c.tag === 'MARR')
      ?.children.find((c) => c.tag === 'DATE')?.payload;

    if (marriage) lines.push(`Married ${marriage}`);
    lines.push(children === 1 ? '1 child' : `${children} children`);
    return lines;
  }

  if (
    record.tag === 'SOUR' ||
    record.tag === 'REPO' ||
    record.tag === 'SNOTE' ||
    record.tag === 'SUBM'
  ) {
    const uses = analysis.xrefs.referencesTo.get(xref)?.length ?? 0;
    lines.push(
      uses === 0 ? '_Cited nowhere in this file._' : `Cited ${uses} time${uses === 1 ? '' : 's'}`,
    );
    return lines;
  }

  return lines;
}

/**
 * Summary string for the header lens at top of document.
 */
export function formatHeaderSummary(analysis: Analysis): string {
  const stats = statistics(analysis);
  const model = modelFor(analysis.version);
  const counts = Object.entries(stats.records)
    .filter(([tag]) => tag !== 'HEAD' && tag !== 'TRLR')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(
      ([tag, count]) =>
        `${count.toLocaleString('en')} ${recordNoun(tag, count, tagLabel(model, tag))}`,
    );

  const period =
    stats.earliest !== undefined && stats.latest !== undefined
      ? `${stats.earliest}–${stats.latest}`
      : undefined;

  return [...counts, period].filter(Boolean).join(' · ');
}

/**
 * Formats a single concise summary line for a record lens.
 */
export function formatRecordSummary(analysis: Analysis, recordOrXref: Structure | string): string {
  const record = resolveRecord(analysis, recordOrXref);
  if (!record) return '';

  const summary = summarizeRecord(record, analysis);
  const named = summary !== record.tag ? summary : undefined;

  return [named, ...describeRecord(analysis, record).filter((l) => !l.startsWith('_'))]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Formats reference count and lens title for a record.
 */
export function formatRecordReferences(
  analysis: Analysis,
  recordOrXref: Structure | string,
): { count: number; title: string } {
  const record = resolveRecord(analysis, recordOrXref);
  const xref = record?.xref ?? (typeof recordOrXref === 'string' ? recordOrXref : null);
  const uses = xref ? (analysis.xrefs.referencesTo.get(xref) ?? []) : [];
  return {
    count: uses.length,
    title: uses.length === 1 ? '1 reference' : `${uses.length} references`,
  };
}

/**
 * Formats the "Show in Tree" lens title.
 */
export function formatTreeLensTitle(): string {
  return '$(type-hierarchy) Show in Tree';
}
