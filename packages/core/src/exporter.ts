/**
 * Which program wrote this file, and what it is known to get wrong.
 *
 * Every GEDCOM file names its author in `HEAD.SOUR`, and the major exporters
 * each have documented, reproducible defects. Naming the program turns a wall of
 * red squiggles into one comprehensible fact — "this came from MyHeritage, which
 * writes line breaks the format has no way to carry" — and lets a diagnostic say
 * whose fault a line is.
 *
 * A profile is data. It says what to expect and how loudly to say it; it does not
 * branch the parser. The one behavioural difference is `repairsContinuations`,
 * and even that only relaxes an error into a repair the reader is told about.
 */

import type { Document } from './cst.ts';

export interface ExporterQuirk {
  /** What the program does, said plainly enough for a diagnostic. */
  readonly summary: string;
  /** Where it was reported, so a reader can check rather than take our word. */
  readonly source?: string;
}

export interface ExporterProfile {
  readonly id: string;
  readonly name: string;
  /** Matched case-insensitively against the `HEAD.SOUR` payload. */
  readonly matches: readonly string[];
  readonly quirks: readonly ExporterQuirk[];
  /**
   * Whether a physical line that cannot be a GEDCOM line should be read as more
   * of the payload above it rather than reported as malformed.
   *
   * True only where the program is known to write payloads containing literal
   * line breaks, which the format has no way to carry: MyHeritage emits `CONC`
   * and never `CONT`, so its multi-line values arrive as bare text.
   */
  readonly repairsContinuations: boolean;
}

const PROFILES: readonly ExporterProfile[] = [
  {
    id: 'myheritage',
    name: 'MyHeritage Family Tree Builder',
    matches: ['myheritage'],
    repairsContinuations: true,
    quirks: [
      {
        summary:
          'Writes literal line breaks inside a payload. It emits `CONC` and never ' +
          '`CONT`, so a value spanning lines arrives as text with no level number.',
        source: 'https://www.tamurajones.net/GEDCOMCONCAndCONT.xhtml',
      },
      {
        summary:
          'Splits HTML entities across a `CONC` boundary, so `&gt;` may arrive as ' +
          '`&g` then `t;`. Reading a payload before it is rejoined sees nonsense.',
        source: 'https://gramps.discourse.group/t/import-of-gedcom-file-from-myheritage-fails/5722',
      },
      {
        summary:
          'Escapes HTML twice in citation text, so `<br>` is written `&amp;lt;br&amp;gt;` ' +
          'and renders as visible tag soup.',
      },
      { summary: 'Writes `QUAY 4`, which is outside the four values the specification defines.' },
    ],
  },
  {
    id: 'wikitree',
    name: 'WikiTree',
    matches: ['wikitree'],
    // WikiTree's breakage is inside a character, not between lines: rejoining
    // the payload restores it, and nothing needs repairing.
    repairsContinuations: false,
    quirks: [
      {
        summary:
          'Splits multibyte characters across a `CONC` boundary, so half a ' +
          'character ends one line and half begins the next. The file is not valid ' +
          'UTF-8 until the lines are rejoined.',
        source: 'https://www.tamurajones.net/WikiTreeGEDCOM.xhtml',
      },
    ],
  },
  {
    id: 'ftm',
    name: 'Family Tree Maker',
    matches: ['ftm', 'family tree maker'],
    repairsContinuations: false,
    quirks: [
      {
        summary:
          'Has declared a version it does not write — 5.5 in the header while using ' +
          '5.5.1 — and has written Windows-1252 whatever `HEAD.CHAR` claims.',
        source:
          'https://www.tamurajones.net/Ancestry.comAndSoftwareMacKievFamilyTreeMakerGEDCOMHeader.xhtml',
      },
    ],
  },
];

/** What `HEAD.SOUR` says, which is where every exporter names itself. */
export function exporterName(document: Document): string | undefined {
  const head = document.records.find((record) => record.tag === 'HEAD');
  const sour = head?.children.find((child) => child.tag === 'SOUR');
  if (!sour) return undefined;

  // The payload is the program's identifier; `NAME` beneath it is the pretty
  // name. Either will do for matching, and the payload is the one always there.
  const name = sour.children.find((child) => child.tag === 'NAME')?.payload;
  return sour.payload?.trim() ?? name?.trim() ?? undefined;
}

/** The profile for a document, where its exporter is one we know about. */
export function exporterProfile(document: Document): ExporterProfile | undefined {
  const name = exporterName(document)?.toLowerCase();
  if (!name) return undefined;

  return PROFILES.find((profile) => profile.matches.some((token) => name.includes(token)));
}

/** Every profile, for tests and for documentation that cannot drift. */
export function exporterProfiles(): readonly ExporterProfile[] {
  return PROFILES;
}
