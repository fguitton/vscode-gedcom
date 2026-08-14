/**
 * What each verb is worth saying, given where it sits.
 *
 * A hover that reads back the tag has told the reader nothing they could not see.
 * The useful hover answers the question the line provokes: `2 QUAY 3` provokes
 * "how much should I trust this", `2 AGE 20y 6m` provokes "so when were they
 * born", `2 PLAC St Giles, Camberwell, Surrey` provokes "which of those is the
 * county". Every describer here exists because a real line raises a real question.
 *
 * Two rules keep it honest. Nothing is invented — every claim is either in the
 * registry, in the file, or arithmetic over the two. And where the file
 * contradicts itself, that is said out loud rather than smoothed over; a stated
 * age that disagrees with the stated dates is the most useful thing on the line.
 */

import {
  ageAt,
  ageInDays,
  asPointer,
  coordinatesOf,
  describeAge,
  describeDate,
  describeLanguage,
  describeMediaType,
  describePlace,
  enumValuesOf,
  formatCoordinate,
  labelOf,
  meaningOf,
  modelFor,
  parseAge,
  parseCoordinate,
  parseExactDate,
  parsePersonalName,
  recordNoun,
  placeFormOf,
  relationsOf,
  relativeTime,
  signedDegrees,
  standalone,
  statistics,
  tagLabel,
  type Analysis,
  type Structure,
} from '@vscode-gedcom/core';

/** The level-0 record a structure belongs to. */
function recordOf(structure: Structure): Structure {
  let current = structure;
  while (current.parent) current = current.parent;
  return current;
}

const childPayload = (structure: Structure, tag: string): string | undefined =>
  structure.children.find((c) => c.tag === tag)?.payload ?? undefined;

/** The first `DATE` under a record's structure of the given tag. */
function eventDate(record: Structure, tag: string): string | undefined {
  const event = record.children.find((c) => c.tag === tag);
  return event ? childPayload(event, 'DATE') : undefined;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- individual describers --------------------------------------------------

/**
 * Dates.
 *
 * The weekday for an exact date, what a qualified date is claiming, how long ago
 * a maintenance date was, and — the one that takes the file into account — how old
 * the subject was when the event happened.
 */
function describeDateStructure(analysis: Analysis, structure: Structure): string[] {
  const payload = structure.payload;
  if (!payload) return [];

  const lines: string[] = [];
  const parent = structure.parent;

  const exact = parseExactDate(payload);
  if (exact) {
    // Parish registers and censuses were kept on particular days of the week, so
    // the weekday is a real check on a transcription, not a curiosity.
    lines.push(`A **${exact.weekday}**.`);
  } else {
    const claim = describeDate(payload);
    if (claim) lines.push(`_${claim}_`);
  }

  // A date under CHAN or CREA is bookkeeping. The absolute value answers nothing;
  // how stale it is answers whether the record is maintained.
  if (parent && (parent.tag === 'CHAN' || parent.tag === 'CREA' || parent.tag === 'HEAD')) {
    const ago = relativeTime(payload);
    if (ago) lines.push(`Last changed **${ago}**.`);
    return lines;
  }

  if (!parent || parent.level === 0) return lines;

  const record = recordOf(structure);
  if (record.tag !== 'INDI' || parent.tag === 'BIRT') return lines;

  const birth = eventDate(record, 'BIRT');
  if (!birth) return lines;

  const age = ageAt(birth, payload);
  if (!age || age.years < -1) return lines;

  // The label is keyed by the enclosing event's registry slug, not its tag: the
  // slug for CENS inside an INDI is `INDI-CENS`, and looking up the bare tag
  // finds nothing and falls back to shouting the tag back at the reader.
  const eventSlug = analysis.validation.resolutions.get(parent)?.slug;
  const model = modelFor(analysis.version);
  const label =
    (eventSlug ? labelOf(model, eventSlug) : undefined) ?? labelOf(model, parent.tag) ?? parent.tag;
  lines.push(
    age.years < 0
      ? `⚠️ Dated **before** the recorded birth.`
      : `${label} at **${age.years === 0 ? 'under a year' : plural(age.years, 'year')}** old${age.approximate ? ', roughly' : ''}.`,
  );

  return lines;
}

/**
 * Ages, cross-checked.
 *
 * An age beside an event is often the only evidence for a birth year, and it is
 * also the field most likely to disagree with the dates already in the record.
 * Nothing else in the format checks the two against each other.
 */
function describeAgeStructure(structure: Structure): string[] {
  const payload = structure.payload;
  if (!payload) return [];

  const age = parseAge(payload);
  if (!age) return [];

  const lines = [`**${describeAge(age)}**.`];

  const event = structure.parent;
  const record = event ? recordOf(structure) : undefined;
  const eventDatePayload = event ? childPayload(event, 'DATE') : undefined;
  const birth = record?.tag === 'INDI' ? eventDate(record, 'BIRT') : undefined;

  if (!eventDatePayload || !birth) return lines;

  const computed = ageAt(birth, eventDatePayload);
  const stated = ageInDays(age);
  if (!computed || stated === undefined) return lines;

  const statedYears = stated / 365.2425;
  const drift = Math.abs(statedYears - computed.years);

  // A year of slack absorbs the ordinary case of a birthday falling either side
  // of the event; bounded ages are claims about an interval, so they are exempt.
  if (age.bound === undefined && drift > 1.5) {
    lines.push(
      `⚠️ The recorded dates give **${plural(computed.years, 'year')}**, which does not match.`,
    );
  } else if (drift <= 1.5) {
    lines.push(`_Consistent with the recorded dates._`);
  }

  return lines;
}

/** Places, with the levels named from the declared place form. */
function describePlaceStructure(analysis: Analysis, structure: Structure): string[] {
  const payload = structure.payload;
  if (!payload) return [];

  const form = placeFormOf(analysis.document, structure);
  const levels = describePlace(payload, form);
  if (levels.length === 0) return [];

  const lines: string[] = [];

  // Naming the levels is only worth a table when the form actually labels them;
  // otherwise the payload already reads as a list and repeating it adds nothing.
  if (levels.some((level) => level.label)) {
    lines.push(
      ...levels.map((level) => `- ${level.label ? `**${level.label}:** ` : ''}${level.name}`),
    );
  } else if (levels.length > 1) {
    lines.push(levels.map((level) => level.name).join(' → '));
  }

  const map = structure.children.find((c) => c.tag === 'MAP');
  if (map) lines.push('', ...describeMap(map));

  return lines;
}

function describeMap(structure: Structure): string[] {
  const coordinates = coordinatesOf(structure);
  if (!coordinates) return [];

  const lat = signedDegrees(coordinates.lat);
  const long = signedDegrees(coordinates.long);

  return [
    `${formatCoordinate(coordinates.lat)}, ${formatCoordinate(coordinates.long)}`,
    `[Open in OpenStreetMap](https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}#map=12/${lat}/${long})`,
  ];
}

/** Personal names, split on the surname slashes. */
function describeNameStructure(structure: Structure): string[] {
  const payload = structure.payload;
  if (!payload) return [];

  const name = parsePersonalName(payload);
  const parts: string[] = [];
  if (name.given) parts.push(`**Given:** ${name.given}`);
  if (name.surname) parts.push(`**Surname:** ${name.surname}`);
  if (name.suffix) parts.push(`**Suffix:** ${name.suffix}`);

  if (parts.length === 0) return [];
  if (!name.surname) {
    return [...parts, '_No surname is marked; slashes delimit the family name._'];
  }
  return parts;
}

/**
 * Counts the file states against counts the file implies.
 *
 * `NCHI` is an assertion, not a derivation, and the gap between the number claimed
 * and the number actually recorded is exactly the research question — which
 * children are still missing.
 */
function describeCount(analysis: Analysis, structure: Structure): string[] {
  const claimed = Number(structure.payload);
  if (!Number.isInteger(claimed)) return [];

  const record = recordOf(structure);

  let recorded: number | undefined;
  if (record.tag === 'FAM') recorded = record.children.filter((c) => c.tag === 'CHIL').length;
  else if (record.tag === 'INDI' && record.xref !== null) {
    recorded = relationsOf(analysis, record.xref).children.length;
  }

  if (recorded === undefined) return [];
  if (recorded === claimed) return [`All **${claimed}** are recorded in this file.`];
  if (recorded < claimed) {
    return [`**${claimed}** claimed, **${recorded}** recorded — ${claimed - recorded} missing.`];
  }
  return [`⚠️ **${claimed}** claimed, but **${recorded}** are recorded.`];
}

/** Dataset statistics, for the one structure that ought to carry them and does not. */
function describeHeader(analysis: Analysis): string[] {
  const stats = statistics(analysis);

  const counts = Object.entries(stats.records)
    .filter(([tag]) => tag !== 'HEAD' && tag !== 'TRLR')
    .sort((a, b) => b[1] - a[1])
    .map(
      ([tag, count]) =>
        `${count.toLocaleString('en')} ${recordNoun(tag, count, tagLabel(modelFor(analysis.version), tag))}`,
    );

  const lines: string[] = [];
  if (counts.length) lines.push(counts.join(' · '));
  if (stats.earliest !== undefined && stats.latest !== undefined) {
    lines.push(
      stats.earliest === stats.latest
        ? `Dates in ${stats.earliest}.`
        : `Dates from **${stats.earliest}** to **${stats.latest}**.`,
    );
  }

  const problems: string[] = [];
  if (stats.dangling) problems.push(`${plural(stats.dangling, 'dangling pointer')}`);
  if (stats.unreferenced)
    problems.push(`${plural(stats.unreferenced, 'record')} nothing points at`);
  if (problems.length) lines.push(`_${problems.join(', ')}._`);

  return lines;
}

/** Contact payloads, made clickable. */
function describeContact(structure: Structure): string[] {
  const payload = structure.payload?.trim();
  if (!payload) return [];

  switch (structure.tag) {
    case 'WWW':
      return /^https?:\/\//i.test(payload) ? [`[${payload}](${payload})`] : [];
    case 'EMAIL':
      return payload.includes('@') ? [`[${payload}](mailto:${payload})`] : [];
    case 'PHON':
    case 'FAX':
      return [`\`${payload}\``];
    default:
      return [];
  }
}

/** File references, with the media type spelled out. */
function describeFile(structure: Structure): string[] {
  const payload = structure.payload?.trim();
  if (!payload) return [];

  const lines: string[] = [];
  const form = childPayload(structure, 'FORM');
  const media = form ? describeMediaType(form) : undefined;
  if (media) lines.push(`A ${media}.`);

  if (/^(https?|file):\/\//i.test(payload)) lines.push(`[${payload}](${payload})`);
  else lines.push('_A path relative to the file, resolved by the importing program._');

  return lines;
}

/** The identifier families, which look alike and are not. */
const IDENTIFIERS: Record<string, string> = {
  REFN: 'A reference the submitter chose. Unique only within this file, and only if the submitter kept it so.',
  UID: 'A globally unique identifier for this record, stable across exports and merges.',
  EXID: 'An identifier this record has in an external system; the `TYPE` substructure names the system.',
  RIN: 'An identifier assigned automatically by the program that produced this file.',
  AFN: 'An Ancestral File Number, from the Latter-day Saint Ancestral File.',
  RFN: 'A permanent record file number, prefixed by the submitter registration number.',
};

// --- assembly ---------------------------------------------------------------

/**
 * Everything worth adding to a structure's hover.
 *
 * Ordered by how much the reader is likely to want it — the answer to the question
 * the line raises first, the specification's own framing after.
 */
export function describeStructure(
  analysis: Analysis,
  structure: Structure,
  slug: string | null | undefined,
): string[] {
  const model = modelFor(analysis.version);
  const payload = structure.payload;
  const parentTag = structure.parent?.tag;

  // Enumerated payloads are checked first: the value is the whole content of the
  // line, and its meaning is what the tag alone can never supply.
  if (payload) {
    const meaning = meaningOf(slug, structure.tag, payload, parentTag);
    if (meaning) {
      return [`**${meaning.label}**${meaning.note ? ` — ${meaning.note}` : ''}`];
    }

    // Not a value we know, but a position where the set is known: listing the
    // alternatives is more use than reporting that the value is unrecognised.
    const permitted = slug ? enumValuesOf(model, slug) : undefined;
    if (permitted?.length && !permitted.includes(payload.trim())) {
      return [`Expected one of: ${permitted.map((value) => `\`${value}\``).join(', ')}`];
    }
  }

  switch (structure.tag) {
    case 'DATE':
    case 'SDATE':
      return describeDateStructure(analysis, structure);
    case 'AGE':
      return describeAgeStructure(structure);
    case 'PLAC':
      return describePlaceStructure(analysis, structure);
    case 'MAP':
      return describeMap(structure);
    case 'LATI':
    case 'LONG': {
      const coordinate = payload ? parseCoordinate(payload) : undefined;
      return coordinate ? [`**${formatCoordinate(coordinate)}**`] : [];
    }
    case 'NAME':
      return recordOf(structure).tag === 'INDI' ? describeNameStructure(structure) : [];
    case 'NCHI':
      return describeCount(analysis, structure);
    case 'LANG': {
      const language = payload ? describeLanguage(payload) : undefined;
      return language ? [`**${language}**`] : [];
    }
    case 'FORM': {
      const media = payload ? describeMediaType(payload) : undefined;
      return media ? [`A ${media}.`] : [];
    }
    case 'FILE':
      return describeFile(structure);
    case 'WWW':
    case 'EMAIL':
    case 'PHON':
    case 'FAX':
      return describeContact(structure);
    case 'HEAD':
      return describeHeader(analysis);
    case 'TRLR':
      return ['The end of the dataset. Nothing may follow it.'];
    case 'REFN':
    case 'UID':
    case 'EXID':
    case 'RIN':
    case 'AFN':
    case 'RFN':
      return [IDENTIFIERS[structure.tag]!];
    case 'VERS':
      return parentTag === 'GEDC' && payload
        ? [`This file declares GEDCOM **${payload.trim()}**.`]
        : [];
    default:
      break;
  }

  // Anything with a date or a place under it is an event or an attribute, and the
  // useful summary is the same for all of them: when, and where.
  return describeEventLike(analysis, structure);
}

// --- inline annotations -----------------------------------------------------

/**
 * Which annotations to render inline. Separate toggles because they answer
 * different questions and readers want them in different combinations — the
 * resolved names are indispensable in an unfamiliar file and noise in your own.
 */
export interface AnnotationKinds {
  /** Resolved record summaries after pointer payloads. */
  readonly pointers: boolean;
  /** Meanings of coded values: enumerations, language tags. */
  readonly values: boolean;
  /** How old the subject was, after an event's date. */
  readonly ages: boolean;
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The meaning of a coded payload, short enough to sit at the end of the line.
 *
 * Covers the enumerations with fixed meanings, language tags, and the sets whose
 * values are themselves tags — `1 NO MARR` reads as "no marriage" only once you
 * know that `NO` takes an event tag as its payload.
 */
export function valueAnnotation(
  analysis: Analysis,
  structure: Structure,
  slug: string | null | undefined,
): string | undefined {
  const payload = structure.payload?.trim();
  if (!payload) return undefined;

  const meaning = meaningOf(slug, structure.tag, payload, structure.parent?.tag);
  if (meaning) return meaning.label;

  if (structure.tag === 'LANG') return describeLanguage(payload);

  const model = modelFor(analysis.version);
  const permitted = slug ? enumValuesOf(model, slug) : undefined;
  if (!permitted?.length) return undefined;

  // `List#Enum` payloads hold several values separated by commas.
  const values = payload
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0 || !values.every((value) => permitted.includes(value))) return undefined;

  const labels = values.map((value) => labelOf(model, value));
  return labels.every((label) => label !== undefined) ? labels.join(', ') : undefined;
}

/**
 * What the event did to the person, in the past tense.
 *
 * `age 4` beside a death date is true and cold; `died age 4` is the fact the
 * reader is actually taking in. The verb comes from the event, so the hint reads
 * as a sentence about that line rather than as a number floating beside it.
 */
const EVENT_VERBS: Record<string, string> = {
  DEAT: 'died',
  BURI: 'buried',
  CREM: 'cremated',
  PROB: 'probate',
  WILL: 'will written',
  MARR: 'married',
  MARB: 'banns read',
  MARC: 'contract signed',
  MARL: 'licence issued',
  MARS: 'settlement signed',
  ENGA: 'engaged',
  DIV: 'divorced',
  DIVF: 'divorce filed',
  ANUL: 'annulled',
  BAPM: 'baptised',
  CHR: 'christened',
  CHRA: 'christened',
  CONF: 'confirmed',
  FCOM: 'first communion',
  BARM: 'bar mitzvah',
  BASM: 'bas mitzvah',
  BLES: 'blessed',
  ADOP: 'adopted',
  EMIG: 'emigrated',
  IMMI: 'immigrated',
  NATU: 'naturalised',
  CENS: 'recorded',
  GRAD: 'graduated',
  ORDN: 'ordained',
  RETI: 'retired',
};

/** How old the subject of the enclosing record was when this date fell. */
export function ageAnnotation(structure: Structure): string | undefined {
  if (structure.tag !== 'DATE' && structure.tag !== 'SDATE') return undefined;

  const event = structure.parent;
  // A date directly on a record is the record's own, not an event's.
  if (!event || event.level === 0) return undefined;
  if (event.tag === 'BIRT' || event.tag === 'CHAN' || event.tag === 'CREA') return undefined;

  const record = recordOf(structure);
  if (record.tag !== 'INDI') return undefined;

  const birth = eventDate(record, 'BIRT');
  const payload = structure.payload;
  if (!birth || !payload) return undefined;

  const age = ageAt(birth, payload);
  // A negative age is a real finding, but the hover says so properly; an inline
  // hint has no room to explain itself and would just look like a bug.
  if (!age || age.years < 0 || age.years > 125) return undefined;

  const verb = EVENT_VERBS[event.tag];
  const measure = age.years === 0 ? 'under a year old' : `age ${age.years}`;
  return verb ? `${verb} ${measure}` : measure;
}

/**
 * The one annotation worth putting at the end of a line, if any.
 *
 * At most one, deliberately. Two annotations on a line stop being an aid to
 * reading and start being a second column of text competing with the first.
 */
export function annotate(
  analysis: Analysis,
  structure: Structure,
  slug: string | null | undefined,
  kinds: AnnotationKinds,
  summarize: (record: Structure) => string,
): string | undefined {
  if (kinds.pointers) {
    const pointer = structure.payload ? asPointer(structure) : null;
    if (pointer !== null && pointer !== 'VOID') {
      const target = analysis.xrefs.definitions.get(pointer);
      if (target) return truncate(summarize(target), 42);
    }
  }

  if (kinds.values) {
    const value = valueAnnotation(analysis, structure, slug);
    // A hint is a caption beside the line, not a clause continuing it, so it
    // reads as `Female` rather than as `female`.
    if (value) return truncate(standalone(value), 42);
  }

  // Capitalised for the same reason as a value hint: it is a caption beside the
  // line, not a clause continuing it.
  if (kinds.ages) {
    const age = ageAnnotation(structure);
    return age ? standalone(age) : undefined;
  }

  return undefined;
}

/**
 * When and where, for anything that carries a date or a place.
 *
 * Written as a sentence rather than as the fields it is built from. A hover that
 * answers `1 CHAN` with `1 JAN 2010` has copied a line from two lines below and
 * told the reader nothing they could not read for themselves.
 */
function describeEventLike(analysis: Analysis, structure: Structure): string[] {
  if (structure.level === 0) return [];

  const date = childPayload(structure, 'DATE')?.trim();
  const place = childPayload(structure, 'PLAC')?.trim();
  if (!date && !place) return [];

  const name = tagLabel(
    modelFor(analysis.version),
    structure.tag,
    analysis.validation.resolutions.get(structure)?.slug,
  ).toLowerCase();

  // Maintenance timestamps get the reading that answers the actual question:
  // not when, but how long ago — is anyone still looking after this record.
  if (structure.tag === 'CHAN' || structure.tag === 'CREA') {
    const verb = structure.tag === 'CHAN' ? 'Last changed' : 'Created';
    const ago = date ? relativeTime(date) : undefined;
    if (date) return [`${verb} on **${date}**${ago ? ` — ${ago}` : ''}.`];
    return [];
  }

  const when = date ? `on **${date}**` : undefined;
  const where = place ? `at **${place}**` : undefined;

  // "Recorded" rather than "happened": an attribute such as OCCU or RESI is not
  // an event, and asserting that one occurred on a date would be wrong.
  const clause = [when, where].filter(Boolean).join(' ');
  return [`A ${name} recorded ${clause}.`];
}
