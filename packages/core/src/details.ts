/**
 * What a record says about itself, arranged for reading.
 *
 * The graph answers one question — who connects to whom — and answers it by
 * throwing almost everything else away. A person's occupation, the place they
 * were born, the sources somebody cited for it: none of that belongs in a box on
 * a chart, and putting it there would ruin the chart. But it is most of what the
 * record actually contains, and a reader looking at the chart is exactly the
 * reader who wants it.
 *
 * So it comes out here instead, as flat labelled fields that a panel can render
 * without knowing anything about GEDCOM. Composition is deliberately generic:
 * every substructure becomes a field, named from the registry, so a tag nobody
 * anticipated still appears rather than being silently dropped.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { modelFor, tagLabel } from './spec/index.ts';
import { statistics } from './stats.ts';
import { asPointer } from './xref.ts';

export interface DetailField {
  readonly label: string;
  readonly value: string;
  /**
   * The value is text written across `CONT` lines and its line breaks are part
   * of it. A panel should render it verbatim rather than as a labelled value —
   * `Royal92.ged` carries a twenty-eight line mailing list posting this way, and
   * flattened into a row it is unreadable.
   */
  readonly block?: boolean;
  /** Line to reveal when the field is activated, where one is meaningful. */
  readonly line?: number;
}

export interface DetailSection {
  readonly title: string;
  readonly fields: readonly DetailField[];
}

export interface Details {
  readonly title: string;
  readonly subtitle?: string;
  /** The record this describes, when it is a record rather than the file. */
  readonly xref?: string;
  readonly line?: number;
  readonly sections: readonly DetailSection[];
}

/**
 * Structures the graph already draws.
 *
 * Repeating them here would waste the panel on the one thing the reader can
 * already see, and `1 FAMS @F1@` says nothing on its own anyway.
 */
const DRAWN_BY_THE_GRAPH = new Set(['FAMS', 'FAMC', 'HUSB', 'WIFE', 'CHIL']);

/** Structures given a section of their own rather than listed as facts. */
const OWN_SECTION = new Set(['NOTE', 'SNOTE', 'SOUR', 'OBJE', 'REFN', 'UID', 'EXID', 'RIN', 'AFN']);

const firstLine = (text: string, max = 200): string => {
  const line = text.split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * Folded text, kept whole.
 *
 * A `CONT` chain is one piece of text written across many lines, and the parser
 * already reassembles it. Truncating it to the first line threw away almost all
 * of it, and the interesting part of a note is rarely in its opening clause.
 *
 * Line breaks are preserved rather than collapsed: `CONT` exists precisely to
 * encode them, and the text in the wild is addresses and correspondence, where
 * the breaks are the layout.
 */
const MAX_BLOCK = 8_000;

const wholeText = (text: string): string => {
  const trimmed = text.replace(/[ \t]+$/gm, '').trim();
  return trimmed.length > MAX_BLOCK ? `${trimmed.slice(0, MAX_BLOCK)}\n…` : trimmed;
};

/** True when the text's own line breaks are worth preserving on screen. */
const isBlock = (text: string): boolean => text.includes('\n');

const child = (structure: Structure, tag: string): Structure | undefined =>
  structure.children.find((candidate) => candidate.tag === tag);

/** A record's display name: a personal name, a title, or its payload. */
function nameOf(record: Structure): string | undefined {
  const name = child(record, 'NAME')?.payload;
  if (name) return name.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();

  const title = child(record, 'TITL')?.payload;
  if (title) return firstLine(title, 60);

  return record.payload ? firstLine(record.payload, 60) : undefined;
}

/** Follows a pointer to something worth showing in its place. */
function resolve(analysis: Analysis, structure: Structure): string | undefined {
  const pointer = asPointer(structure);
  if (pointer === null) return undefined;
  if (pointer === 'VOID') return 'deliberately nothing';

  const target = analysis.xrefs.definitions.get(pointer);
  return target ? (nameOf(target) ?? `@${pointer}@`) : `@${pointer}@ — no such record`;
}

/**
 * A structure written as one line of prose.
 *
 * An event carries its detail in substructures rather than in its payload, so
 * `1 OCCU Blacksmith / 2 PLAC Sheffield` has to be read as a whole to say
 * anything; the payload alone is half the fact.
 */
function valueOf(analysis: Analysis, structure: Structure): string {
  const parts: string[] = [];

  const pointed = resolve(analysis, structure);
  if (pointed) parts.push(pointed);
  else if (structure.payload) parts.push(firstLine(structure.payload));

  const date = child(structure, 'DATE')?.payload;
  const place = child(structure, 'PLAC')?.payload;
  const age = child(structure, 'AGE')?.payload;

  // `Y` asserts only that the event happened, so it reads as noise beside a date.
  const asserted = parts.length === 1 && parts[0] === 'Y';
  if (asserted && (date ?? place)) parts.length = 0;

  if (date) parts.push(date.trim());
  if (place) parts.push(firstLine(place, 80));
  if (age) parts.push(`aged ${age.trim()}`);

  return parts.length > 0 ? parts.join(' · ') : 'recorded';
}

/** Note text, whether written inline or pointed at. */
function noteText(analysis: Analysis, structure: Structure): string | undefined {
  const pointer = asPointer(structure);
  if (pointer !== null && pointer !== 'VOID') {
    const target = analysis.xrefs.definitions.get(pointer);
    return target?.payload ? wholeText(target.payload) : undefined;
  }
  return structure.payload ? wholeText(structure.payload) : undefined;
}

function section(title: string, fields: DetailField[]): DetailSection[] {
  return fields.length > 0 ? [{ title, fields }] : [];
}

/**
 * Everything a record carries, minus what the graph is already showing.
 */
export function recordDetails(analysis: Analysis, xref: string): Details | undefined {
  const record = analysis.xrefs.definitions.get(xref);
  if (!record) return undefined;

  const model = modelFor(analysis.version);
  const slug = analysis.validation.resolutions.get(record)?.slug;
  const kind = tagLabel(model, record.tag, slug);

  const facts: DetailField[] = [];
  const notes: DetailField[] = [];
  const sources: DetailField[] = [];
  const media: DetailField[] = [];
  const identifiers: DetailField[] = [];

  for (const structure of record.children) {
    const tag = structure.tag;
    if (DRAWN_BY_THE_GRAPH.has(tag)) continue;

    const label = tagLabel(model, tag, analysis.validation.resolutions.get(structure)?.slug);
    const line = structure.span.line;

    if (tag === 'NOTE' || tag === 'SNOTE') {
      const text = noteText(analysis, structure);
      if (text) notes.push({ label, value: text, block: isBlock(text), line });
      continue;
    }

    if (tag === 'SOUR') {
      const page = child(structure, 'PAGE')?.payload;
      const cited = resolve(analysis, structure) ?? structure.payload ?? '';
      sources.push({
        label,
        value: [firstLine(cited, 80), page ? firstLine(page, 80) : undefined]
          .filter(Boolean)
          .join(' · '),
        line,
      });
      continue;
    }

    if (tag === 'OBJE') {
      const file = child(structure, 'FILE')?.payload;
      media.push({
        label,
        value: file ? firstLine(file) : (resolve(analysis, structure) ?? ''),
        line,
      });
      continue;
    }

    if (OWN_SECTION.has(tag)) {
      identifiers.push({
        label,
        value: structure.payload ? firstLine(structure.payload) : '',
        line,
      });
      continue;
    }

    facts.push({ label, value: valueOf(analysis, structure), line });
  }

  return {
    title: nameOf(record) ?? `@${xref}@`,
    subtitle: kind,
    xref,
    line: record.span.line,
    sections: [
      ...section('Facts', facts),
      ...section('Notes', notes),
      ...section('Sources', sources),
      ...section('Media', media),
      ...section('Identifiers', identifiers),
    ],
  };
}

/**
 * What the file says about itself.
 *
 * The submitter, the program that wrote it, the copyright, the header notes —
 * real information, and none of it a person or a family. Drawn into the graph it
 * became a node with no generation and no relationships, hanging off the side of
 * a tree it has nothing to do with.
 */
export function documentDetails(analysis: Analysis): Details {
  const model = modelFor(analysis.version);
  const head = analysis.document.records.find((record) => record.tag === 'HEAD');

  const file: DetailField[] = [];
  const submitter: DetailField[] = [];
  const notes: DetailField[] = [];

  if (head) {
    const source = child(head, 'SOUR');
    if (source) {
      const program = child(source, 'NAME')?.payload ?? source.payload;
      const version = child(source, 'VERS')?.payload;
      const corporation = child(source, 'CORP')?.payload;
      if (program) {
        file.push({
          label: 'Written by',
          value: [firstLine(program), version?.trim()].filter(Boolean).join(' '),
          line: source.span.line,
        });
      }
      if (corporation) {
        file.push({ label: 'Publisher', value: firstLine(corporation), line: source.span.line });
      }
    }

    for (const tag of ['DATE', 'LANG', 'COPR', 'DEST', 'FILE', 'CHAR'] as const) {
      const structure = child(head, tag);
      if (!structure?.payload) continue;
      file.push({
        label: tagLabel(model, tag, analysis.validation.resolutions.get(structure)?.slug),
        value: firstLine(structure.payload),
        line: structure.span.line,
      });
    }

    const version = child(head, 'GEDC') && child(child(head, 'GEDC')!, 'VERS')?.payload;
    if (version) file.push({ label: 'GEDCOM version', value: version.trim() });

    const form = child(head, 'PLAC') && child(child(head, 'PLAC')!, 'FORM')?.payload;
    if (form) file.push({ label: 'Place form', value: firstLine(form) });

    // The submitter is a record of its own, normally pointed at from the header.
    // Normally: PAF-era files carry a `SUBM` record that nothing points at, and
    // Linguist's own `Royal92.ged` is one of them — so an unreferenced submitter
    // is found rather than lost.
    const pointer = child(head, 'SUBM');
    const target =
      (pointer ? analysis.xrefs.definitions.get(asPointer(pointer) ?? '') : undefined) ??
      analysis.document.records.find((record) => record.tag === 'SUBM');

    if (target) {
      const name = nameOf(target);
      if (name) submitter.push({ label: 'Name', value: name, line: target.span.line });

      // Everything else generically, so an address, a telephone number and a
      // 1992 mailing-list posting under a custom tag all survive.
      for (const structure of target.children) {
        if (structure.tag === 'NAME') continue;

        if (structure.tag === 'NOTE' || structure.tag === 'SNOTE') {
          const text = noteText(analysis, structure);
          if (text) {
            notes.push({
              label: 'Submitter note',
              value: text,
              block: isBlock(text),
              line: structure.span.line,
            });
          }
          continue;
        }

        if (!structure.payload) continue;
        submitter.push({
          label: tagLabel(
            model,
            structure.tag,
            analysis.validation.resolutions.get(structure)?.slug,
          ),
          // Kept whole: an address and a mailing-list posting are both written
          // across `CONT` lines, and the first of them is never enough.
          value: wholeText(structure.payload),
          block: isBlock(structure.payload),
          line: structure.span.line,
        });
      }
    }

    for (const structure of head.children) {
      if (structure.tag !== 'NOTE' && structure.tag !== 'SNOTE') continue;
      const text = noteText(analysis, structure);
      if (text) {
        notes.push({
          label: 'File note',
          value: text,
          block: isBlock(text),
          line: structure.span.line,
        });
      }
    }
  }

  const stats = statistics(analysis);
  const contents: DetailField[] = Object.entries(stats.records)
    .filter(([tag]) => tag !== 'HEAD' && tag !== 'TRLR')
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({
      label: tagLabel(model, tag),
      value: count.toLocaleString('en'),
    }));

  if (stats.earliest !== undefined && stats.latest !== undefined) {
    contents.push({ label: 'Dates from', value: `${stats.earliest} to ${stats.latest}` });
  }

  return {
    title: 'This file',
    subtitle: analysis.version === null ? 'GEDCOM, version unknown' : `GEDCOM ${analysis.version}`,
    sections: [
      ...section('Contents', contents),
      ...section('File', file),
      ...section('Submitter', submitter),
      ...section('Notes', notes),
    ],
  };
}
