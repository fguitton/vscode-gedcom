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
import { expandMonths } from './date.ts';
import { meaningOf, standalone } from './enums.ts';
import { describeMediaType, mediaTypeOfPath, resolveMediaType } from './lang.ts';
import { parsePersonalName } from './name.ts';
import { modelFor, recordNoun, tagLabel } from './spec/index.ts';
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
  /**
   * The structure is present and carries nothing.
   *
   * Worth showing rather than hiding: an extension tag with no payload and no
   * substructures is a thing somebody wrote into the file, and a panel that drops
   * it silently is the reason nobody notices. The panel marks it as empty rather
   * than printing a word the file never said.
   */
  readonly empty?: boolean;
  /**
   * The value is markup — declared by a `MIME` substructure, or recognisable as
   * such in a version that has no way to declare it.
   *
   * A panel may offer to render it. It is not a promise that the markup is well
   * formed: plenty of it is not, and neither specification says it must be.
   */
  readonly html?: boolean;
  /** Line to reveal when the field is activated, where one is meaningful. */
  readonly line?: number;
  /**
   * A resource the field points at, when the file gives one that a viewer could
   * actually open — `http` or `https` only.
   *
   * A `FILE` payload is whatever the exporting program wrote there: a URL, a
   * path relative to the file, a drive letter from a machine retired in 2003.
   * Only the first kind can be followed from here, so only that kind is offered.
   */
  readonly url?: string;
  /** The media type of `url`, where it is known. */
  readonly mediaType?: string;
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

/**
 * True for the one kind of payload a viewer can safely follow.
 *
 * A GEDCOM file is untrusted input and a `FILE` payload is free text, so this is
 * a whitelist rather than a check for things known to be bad: `javascript:` and
 * `file:` are refused because they are not `http`, not because they were
 * anticipated.
 */
export function webUrl(payload: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(payload.trim());
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
 * An enumerated payload said in English, or nothing where it is not one.
 *
 * `F` is a code, and the panel exists to be read rather than decoded — a row
 * saying "Sex: F" has passed the file's shorthand straight through. The code
 * itself is still one click away on the line it came from.
 */
function coded(analysis: Analysis, structure: Structure): string | undefined {
  const payload = structure.payload?.trim();
  if (!payload) return undefined;

  const slug = analysis.validation.resolutions.get(structure)?.slug;
  const meaning = meaningOf(slug, structure.tag, payload, structure.parent?.tag);
  return meaning ? standalone(meaning.label) : undefined;
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
  else if (structure.payload) {
    // A DATE shown as a field of its own reads like any other date in the panel.
    const raw = coded(analysis, structure) ?? structure.payload;
    parts.push(firstLine(structure.tag === 'DATE' ? expandMonths(raw) : raw));
  }

  // The time of day hangs under the date rather than beside it — `2 DATE` then
  // `3 TIME` — in both 5.5.1 and 7.0, and reading only the date drops it. A
  // change record whose whole purpose is to say when is the place it shows most.
  const dated = child(structure, 'DATE');
  const date = dated?.payload;
  const time = dated ? child(dated, 'TIME')?.payload : undefined;
  const place = child(structure, 'PLAC')?.payload;
  const age = child(structure, 'AGE')?.payload;

  // `Y` asserts only that the event happened, so it reads as noise beside a date.
  const asserted = parts.length === 1 && parts[0] === 'Y';
  if (asserted && (date ?? place)) parts.length = 0;

  // Written out for reading: the panel is prose, and the editor a click away
  // still shows exactly what the file holds.
  if (date) {
    const written = expandMonths(date.trim());
    parts.push(time ? `${written} at ${time.trim()}` : written);
  }
  if (place) parts.push(firstLine(place, 80));
  else {
    // A residence usually carries an ADDR rather than a PLAC, and the address
    // is the whole fact — without it the row reads "Residence · recorded",
    // which tells a reader less than the file does.
    const address = addressLine(structure);
    if (address) parts.push(address);
  }
  if (age) parts.push(`aged ${age.trim()}`);

  // Nothing at all, which is a fact about the line rather than a failure to read
  // it: `1 _MAYBE` with nothing beneath it is a tag somebody wrote and gave no
  // value to. The panel says so in its own words; inventing one here — "recorded"
  // — read as though the file had said something.
  return parts.join(' · ');
}

/**
 * An address on one line.
 *
 * The payload holds the whole thing in older files and the jurisdiction
 * substructures hold it in newer ones; either way the reader wants one line.
 */
function addressLine(structure: Structure): string | undefined {
  const address = child(structure, 'ADDR');
  if (!address) return undefined;

  if (address.payload) return firstLine(address.payload, 80);

  const parts = ['ADR1', 'ADR2', 'ADR3', 'CITY', 'STAE', 'POST', 'CTRY']
    .map((tag) => child(address, tag)?.payload?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);

  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * A name, read rather than copied.
 *
 * The slashes in `/Family/ Personal` are not punctuation: they are how GEDCOM
 * marks which part of a name string is the surname, in a format that has to
 * carry names from cultures that write the surname first, last, or not at all.
 * Printing them verbatim shows the reader the file's markup instead of the name.
 *
 * The display keeps the order the file wrote, because that order is itself
 * information — a name recorded surname-first was recorded that way on purpose.
 * The parts follow underneath, which is where the slashes have something to say.
 *
 * A person may hold several names, and a row labelled "Name" twice tells the
 * reader nothing about which is which; the `TYPE` beneath each one does, so it
 * becomes the label.
 */
function personalName(
  analysis: Analysis,
  structure: Structure,
  fallbackLabel: string,
  line: number,
): DetailField[] {
  const parsed = parsePersonalName(structure.payload ?? '');

  const type = child(structure, 'TYPE')?.payload?.trim();
  const meaning = type ? meaningOf(null, 'TYPE', type, 'NAME') : undefined;
  const label = meaning
    ? standalone(meaning.label)
    : type
      ? `${fallbackLabel} (${type})`
      : fallbackLabel;

  const fields: DetailField[] = [{ label, value: parsed.display, line }];

  // The substructures win where the file wrote them: they are what the exporting
  // program meant, and the slashes are only our reading of the string.
  const given = child(structure, 'GIVN')?.payload?.trim() ?? parsed.given;
  const surname = child(structure, 'SURN')?.payload?.trim() ?? parsed.surname;

  // Only worth stating where the file marked a surname. Without one there is
  // nothing to distinguish: the whole payload is the given name by default, and
  // repeating it under a second label would say the same thing twice.
  if (!surname) return fields;

  const prefix = child(structure, 'NPFX')?.payload?.trim() ?? parsed.prefix;
  // The payload's grammar is `given /surname/ suffix`, so anything after the
  // closing slash is read as a suffix. Shown rather than dropped: where that
  // reading is not what the writer meant, seeing it is how a reader finds out.
  const suffix = child(structure, 'NSFX')?.payload?.trim() ?? parsed.suffix;

  if (prefix) fields.push({ label: 'Title', value: prefix, line });
  if (given) fields.push({ label: 'Given name', value: given, line });
  fields.push({ label: 'Surname', value: surname, line });
  if (suffix) fields.push({ label: 'Suffix', value: suffix, line });

  return fields;
}

/**
 * Whether a note's text is markup rather than prose that happens to contain a
 * pointy bracket.
 *
 * GEDCOM 7 says so outright with `MIME`, and where it does, that is the answer:
 * the file is entitled to declare its own payload, including declaring HTML that
 * turns out to be malformed. 5.5.1 has no way to say, and exporters put HTML in
 * notes anyway — MyHeritage does it routinely — so there the text is all there
 * is to go on.
 *
 * The guess is deliberately narrow: a recognised tag, opened and closed, not
 * merely an angle bracket. `5 < 7 and 7 > 5` is arithmetic, and a reader who is
 * offered a "render as HTML" button on it has been told something false.
 */
const MARKUP =
  /<(p|br|b|i|em|strong|u|ul|ol|li|a|h[1-6]|div|span|blockquote|pre|code|table)\b[^>]*>/i;

function looksLikeMarkup(structure: Structure, text: string): boolean {
  const mime = child(structure, 'MIME')?.payload?.trim().toLowerCase();
  if (mime) return mime === 'text/html';

  return MARKUP.test(text);
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

    if (tag === 'NAME' && structure.payload) {
      facts.push(...personalName(analysis, structure, label, line));
      continue;
    }

    if (tag === 'NOTE' || tag === 'SNOTE') {
      const text = noteText(analysis, structure);
      if (text) {
        notes.push({
          label,
          value: text,
          block: isBlock(text),
          ...(looksLikeMarkup(structure, text) ? { html: true } : {}),
          line,
        });
      }
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
      // Written inline, a media object is a FILE with a FORM and often a TITL
      // beside it. The tag label alone ("Media object") says nothing a reader
      // cannot see, so the object's own title takes its place where there is
      // one, and the format follows the path — a reader scanning a list of
      // files wants to know which is the photograph.
      const file = child(structure, 'FILE')?.payload;
      const form = child(structure, 'FORM')?.payload;
      const titl = child(structure, 'TITL')?.payload;
      const kind = form ? describeMediaType(form) : undefined;
      const path = file ? firstLine(file) : (resolve(analysis, structure) ?? '');
      // The FORM is the authority where the file writes one; where it does not,
      // the extension is the only evidence of what the thing is.
      const type = (form ? resolveMediaType(form) : undefined) ?? mediaTypeOfPath(path);
      media.push({
        label: titl ? firstLine(titl, 60) : label,
        value: [path, kind ?? (type ? describeMediaType(type) : undefined)]
          .filter(Boolean)
          .join(' · '),
        line,
        ...(webUrl(path) ? { url: path.trim() } : {}),
        ...(type ? { mediaType: type } : {}),
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

    // A payload written across CONT lines is text, whatever tag carries it —
    // an address, a comment, a transcription. It gets the same treatment a note
    // does rather than being cut down to its opening clause.
    if (structure.payload && isBlock(structure.payload)) {
      facts.push({ label, value: wholeText(structure.payload), block: true, line });
      continue;
    }

    const value = valueOf(analysis, structure);
    facts.push({ label, value, ...(value.length === 0 ? { empty: true } : {}), line });
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
      // A count wants the plural: "Individuals — 3,010", not "Individual — 3,010".
      label: standalone(recordNoun(tag, count, tagLabel(model, tag))),
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
