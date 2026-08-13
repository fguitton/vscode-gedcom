/**
 * What enumerated payload values actually mean.
 *
 * The registry tells us which values a structure admits; it does not tell us what
 * any of them mean. `2 QUAY 3` is legal, and to anyone who has not memorised the
 * specification it is also completely opaque — yet it is the field that says how
 * much to trust everything around it. The same goes for `PEDI`, `RESN` and
 * `FAMC.STAT`: short codes carrying the judgements a researcher most wants to see.
 *
 * These sentences are the specification's own definitions, condensed. Nothing here
 * is derived, because nothing in the registry carries it — the registry ships the
 * vocabulary, not its semantics.
 */

export interface EnumMeaning {
  /** A word or two, for an inlay hint where there is no room for a sentence. */
  readonly label: string;
  /** A sentence, for a hover. */
  readonly note?: string;
}

type MeaningSet = Readonly<Record<string, EnumMeaning>>;

const QUAY: MeaningSet = {
  '0': {
    label: 'unreliable',
    note: 'Unreliable or estimated data — a guess, or evidence known to be poor.',
  },
  '1': {
    label: 'questionable',
    note: 'Questionable reliability: interviews, census returns, oral genealogies, or anything with an obvious potential for bias.',
  },
  '2': {
    label: 'secondary',
    note: 'Secondary evidence — data recorded officially, but some time after the event.',
  },
  '3': {
    label: 'primary',
    note: 'Direct and primary evidence, or a conclusion carried by the weight of the evidence.',
  },
};

const PEDI: MeaningSet = {
  BIRTH: { label: 'birth', note: 'The genetic or birth parents.' },
  ADOPTED: { label: 'adopted', note: 'Adoptive parents.' },
  FOSTER: {
    label: 'foster',
    note: 'The child was raised by this family as a foster child or ward.',
  },
  SEALING: {
    label: 'sealing',
    note: 'Sealed to these parents in a Latter-day Saint ordinance, rather than born to them.',
  },
  OTHER: {
    label: 'other',
    note: 'A relationship the enumeration does not cover; the accompanying `PHRASE` says which.',
  },
};

const RESN: MeaningSet = {
  CONFIDENTIAL: {
    label: 'confidential',
    note: 'Marked confidential by the submitter. Tools are asked not to show it without the reader asking.',
  },
  LOCKED: {
    label: 'locked',
    note: 'Locked against editing. Automated tools and bulk changes should leave this record alone.',
  },
  PRIVACY: {
    label: 'private',
    note: 'Private. Should not be shared or exported outside a limited circle.',
  },
};

const SEX: MeaningSet = {
  M: { label: 'male' },
  F: { label: 'female' },
  X: { label: 'neither', note: 'Does not fit the male/female binary.' },
  U: { label: 'unknown', note: 'Not known, or deliberately not stated.' },
};

const FAMC_STAT: MeaningSet = {
  CHALLENGED: {
    label: 'challenged',
    note: 'The link between this child and this family is disputed, but has been neither proven nor disproven.',
  },
  DISPROVEN: {
    label: 'disproven',
    note: 'The link has been claimed by someone and subsequently disproven.',
  },
  PROVEN: { label: 'proven', note: 'The link between this child and this family has been proven.' },
};

const FAMC_ADOP: MeaningSet = {
  HUSB: { label: 'by the husband', note: 'Adopted by the husband of this family alone.' },
  WIFE: { label: 'by the wife', note: 'Adopted by the wife of this family alone.' },
  BOTH: { label: 'by both', note: 'Adopted by both spouses.' },
};

const NAME_TYPE: MeaningSet = {
  AKA: { label: 'also known as', note: 'An alias or nickname, not a formal name.' },
  BIRTH: { label: 'birth name', note: 'The name given at or near birth.' },
  IMMIGRANT: {
    label: 'immigrant name',
    note: 'A name taken on immigration, often an anglicisation.',
  },
  MAIDEN: { label: 'maiden name', note: 'The surname held before a first marriage.' },
  MARRIED: { label: 'married name', note: 'A name taken at marriage.' },
  PROFESSIONAL: {
    label: 'professional name',
    note: 'A name used professionally — a stage, pen or religious name.',
  },
  OTHER: {
    label: 'other',
    note: 'A kind of name the enumeration does not cover; the accompanying `PHRASE` says which.',
  },
};

const MEDI: MeaningSet = {
  AUDIO: { label: 'audio recording' },
  BOOK: { label: 'book', note: 'A bound printed volume.' },
  CARD: { label: 'card', note: 'A card index or file card.' },
  ELECTRONIC: { label: 'electronic', note: 'A digital artefact — a database, a website, a file.' },
  FICHE: { label: 'microfiche' },
  FILM: { label: 'microfilm' },
  MAGAZINE: { label: 'magazine', note: 'A magazine or other periodical.' },
  MANUSCRIPT: { label: 'manuscript', note: 'Handwritten or typed, and unpublished.' },
  MAP: { label: 'map' },
  NEWSPAPER: { label: 'newspaper' },
  PHOTO: { label: 'photograph' },
  TOMBSTONE: {
    label: 'tombstone',
    note: 'A grave marker, monument or other memorial inscription.',
  },
  VIDEO: { label: 'video recording' },
  OTHER: {
    label: 'other',
    note: 'A medium the enumeration does not cover; the accompanying `PHRASE` says which.',
  },
};

const ROLE: MeaningSet = {
  CHIL: { label: 'child', note: 'Appeared in the event as a child.' },
  CLERGY: { label: 'clergy', note: 'A religious official attending, but not the one presiding.' },
  FATH: {
    label: 'father',
    note: 'Appeared as a father. `PARENT` is preferred where the role is not gendered.',
  },
  FRIEND: { label: 'friend' },
  GODP: { label: 'godparent', note: 'A godparent or religious sponsor.' },
  HUSB: { label: 'husband', note: 'Appeared as the husband in the event.' },
  MOTH: {
    label: 'mother',
    note: 'Appeared as a mother. `PARENT` is preferred where the role is not gendered.',
  },
  MULTIPLE: {
    label: 'multiple birth',
    note: 'A sibling from the same multiple birth — a twin, triplet and so on.',
  },
  NGHBR: { label: 'neighbour' },
  OFFICIATOR: { label: 'officiator', note: 'The official who presided over the event.' },
  PARENT: { label: 'parent' },
  SPOU: { label: 'spouse' },
  WIFE: { label: 'wife', note: 'Appeared as the wife in the event.' },
  WITN: { label: 'witness' },
  OTHER: {
    label: 'other',
    note: 'A role the enumeration does not cover; the accompanying `PHRASE` says which.',
  },
};

/**
 * Latter-day Saint ordinance status. These are the codes a Temple submission comes
 * back with, and several of them mean "do not resubmit" for reasons that are not
 * guessable from the code.
 */
const ORD_STAT: MeaningSet = {
  BIC: {
    label: 'born in the covenant',
    note: 'Born in the covenant, so the sealing to parents is not required.',
  },
  CANCELED: { label: 'cancelled', note: 'The ordinance was cancelled and is no longer valid.' },
  CHILD: {
    label: 'died as a child',
    note: 'Died before the age of eight; the ordinance is not required.',
  },
  COMPLETED: {
    label: 'completed',
    note: 'The ordinance was performed, though the date is not known.',
  },
  DNS: { label: 'do not seal', note: 'This person is not to be sealed.' },
  DNS_CAN: {
    label: 'do not seal, previously cancelled',
    note: 'Not to be sealed to the spouse; a previous sealing was cancelled.',
  },
  EXCLUDED: { label: 'excluded', note: 'Excluded from submission by the submitter.' },
  INFANT: {
    label: 'died in infancy',
    note: 'Died before the age of one; the ordinance is not required.',
  },
  PRE_1970: {
    label: 'before 1970',
    note: 'Completed before 1970, before records were kept in a searchable form.',
  },
  STILLBORN: { label: 'stillborn', note: 'Stillborn, so no ordinance is required.' },
  SUBMITTED: { label: 'submitted', note: 'Submitted, but not yet performed.' },
  UNCLEARED: { label: 'uncleared', note: 'Data is insufficient for the ordinance to proceed.' },
};

const SETS: Readonly<Record<string, MeaningSet>> = {
  QUAY,
  PEDI,
  RESN,
  SEX,
  'FAMC-STAT': FAMC_STAT,
  'FAMC-ADOP': FAMC_ADOP,
  'NAME-TYPE': NAME_TYPE,
  MEDI,
  ROLE,
  'ord-STAT': ORD_STAT,
};

/**
 * Which enumeration set a structure draws from.
 *
 * The registry slug is authoritative where we have one — it already carries the
 * context that makes `STAT` under `FAMC` different from `STAT` under `SLGC`. The
 * 5.5.1 model carries no enumerations at all, so for those files the tag and its
 * parent are all there is to go on; the values themselves have not changed between
 * generations, only the way the registry describes them.
 */
export function enumSetFor(
  slug: string | null | undefined,
  tag: string,
  parentTag?: string,
): string | undefined {
  if (slug && slug in SETS) return slug;

  switch (tag) {
    case 'QUAY':
    case 'PEDI':
    case 'RESN':
    case 'SEX':
    case 'MEDI':
      return tag;
    case 'ROLE':
    // 5.5.1 spelled the same idea RELA, which GEDCOM 7 renamed to ROLE.
    case 'RELA':
      return 'ROLE';
    case 'STAT':
      return parentTag === 'FAMC' ? 'FAMC-STAT' : 'ord-STAT';
    case 'ADOP':
      return parentTag === 'ADOP' || parentTag === 'FAMC' ? 'FAMC-ADOP' : undefined;
    case 'TYPE':
      return parentTag === 'NAME' ? 'NAME-TYPE' : undefined;
    default:
      return undefined;
  }
}

/** The meaning of one value within a set, or nothing when the value is not one of them. */
export function describeEnumValue(set: string, value: string): EnumMeaning | undefined {
  return SETS[set]?.[value.trim().toUpperCase()];
}

/**
 * A label as it should read where it stands on its own.
 *
 * The labels above are written in lower case because most of their uses are
 * inside a sentence — "recorded as female", "marked confidential". A panel field
 * and an inlay hint are not sentences: they are captions, and a caption that
 * starts lower case looks like a fragment of something else.
 */
export function standalone(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The meaning of a payload, resolved from its position in the tree.
 *
 * Returns nothing rather than guessing when the payload is not an enumerated
 * value — an unrecognised code is more likely to be a custom extension than a
 * mistake, and inventing a meaning for it would be worse than saying nothing.
 */
export function meaningOf(
  slug: string | null | undefined,
  tag: string,
  payload: string,
  parentTag?: string,
): EnumMeaning | undefined {
  const set = enumSetFor(slug, tag, parentTag);
  return set ? describeEnumValue(set, payload) : undefined;
}
