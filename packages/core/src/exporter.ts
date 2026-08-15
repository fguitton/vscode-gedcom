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

import type { Diagnostic, Document, Structure } from './cst.ts';

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
  /**
   * Deviations this program is known to write, which are its fault rather than
   * the reader's.
   *
   * Matched on the diagnostic's code and, where it matters, the tag it was
   * raised on. A match is downgraded to a warning and gains a sentence naming
   * the program — the file is still wrong, and still says so, but the reader is
   * told who to blame and spared deciding whether to fix it themselves.
   */
  readonly tolerates?: readonly { readonly code: string; readonly tag?: string }[];
  /**
   * A header this program is known to write incorrectly.
   *
   * Reported, never acted on. Family Tree Maker has declared 5.5 while writing
   * 5.5.1, and has written Windows-1252 whatever `HEAD.CHAR` says — but which
   * release did that is not something the file records, so silently overriding
   * the header would swap one wrong answer for another. The reader is told what
   * to check, and `gedcom.validation` already lets them override the version by
   * hand if they agree.
   */
  readonly headerMayLie?: {
    readonly about: 'version' | 'encoding' | 'both';
    readonly detail: string;
  };
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
    tolerates: [
      { code: 'enum-value-unknown', tag: 'QUAY' },
      // Every export carries them, and the header never declares any of them.
      { code: 'undocumented-extension' },
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
    headerMayLie: {
      about: 'both',
      detail:
        'Some releases declare GEDCOM 5.5 while writing 5.5.1, and write ' +
        'Windows-1252 whatever `HEAD.CHAR` claims. If a character looks wrong, or a ' +
        'tag is reported as unknown that 5.5.1 defines, the header is the thing to ' +
        'doubt first.',
    },
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

/**
 * Re-rates the diagnostics a known exporter is responsible for.
 *
 * The deviation is still reported — a file that says `QUAY 4` still says
 * something no reader can act on — but as a warning naming the program rather
 * than an error implying the reader typed it. Nothing is suppressed: an
 * exporter's reputation is not a reason to hide what a file contains.
 */
export function attributeToExporter(
  diagnostics: readonly Diagnostic[],
  profile: ExporterProfile | undefined,
  tagOf: (diagnostic: Diagnostic) => string | undefined,
): Diagnostic[] {
  if (!profile?.tolerates?.length) return [...diagnostics];

  return diagnostics.map((diagnostic) => {
    const tag = tagOf(diagnostic);
    const known = profile.tolerates!.some(
      (entry) => entry.code === diagnostic.code && (entry.tag === undefined || entry.tag === tag),
    );
    if (!known) return diagnostic;

    return {
      ...diagnostic,
      // Downgraded only from error. A deviation already rated a warning or a
      // hint keeps that rating — the point is to stop blaming the reader, not to
      // quieten the file further.
      severity: diagnostic.severity === 'error' ? ('warning' as const) : diagnostic.severity,
      message: `${diagnostic.message} ${profile.name} writes this; it is the exporter's doing rather than yours.`,
    };
  });
}
