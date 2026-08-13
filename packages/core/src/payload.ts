/**
 * Payload types, in words.
 *
 * The registry names payload types with the URIs it uses internally — a structure
 * that takes plain text is described as `http://www.w3.org/2001/XMLSchema#string`,
 * and a date as `type-DATE_VALUE`. Those are identifiers for a machine, and showing
 * them to a reader is worse than showing nothing: it looks like an error message.
 *
 * What a reader wants from a payload type is the shape of the thing to write, so
 * each one is given as a description with an example where an example helps.
 */

export interface PayloadDescription {
  /** What kind of value goes here. */
  readonly summary: string;
  /** A representative value, where seeing one settles the question faster. */
  readonly example?: string;
}

const TYPES: Readonly<Record<string, PayloadDescription>> = {
  'XMLSchema#string': { summary: 'Text' },
  'XMLSchema#Language': { summary: 'A BCP 47 language tag', example: 'en-GB' },
  'XMLSchema#anyURI': { summary: 'A URI', example: 'https://example.org/records/1' },
  'XMLSchema#nonNegativeInteger': { summary: 'A whole number, zero or greater' },
  'dcat#mediaType': { summary: 'An IANA media type', example: 'image/jpeg' },

  // The one payload type nobody guesses. `Y` asserts that the event happened
  // while recording nothing whatever about it, and an empty payload says only
  // that the substructures below describe it.
  'Y|<NULL>': {
    summary:
      'Either `Y` or nothing. `Y` asserts the event took place without giving any detail; leave it empty when the substructures below supply the detail',
  },

  'type-Enum': { summary: 'One of a fixed set of values' },
  'type-List#Enum': {
    summary: 'A comma-separated list drawn from a fixed set',
    example: 'BIRT, CHR',
  },
  'type-List#Text': { summary: 'A comma-separated list' },

  'type-Date': { summary: 'A date, optionally qualified', example: 'ABT 1801, BET 1830 AND 1840' },
  'type-DATE_VALUE': {
    summary: 'A date, optionally qualified',
    example: 'ABT 1801, BET 1830 AND 1840',
  },
  'type-Date#exact': { summary: 'An exact Gregorian date', example: '12 AUG 1901' },
  'type-DATE_EXACT': { summary: 'An exact Gregorian date', example: '12 AUG 1901' },
  'type-Date#period': { summary: 'A period', example: 'FROM 1914 TO 1918' },
  'type-DATE_PERIOD': { summary: 'A period', example: 'FROM 1914 TO 1918' },

  'type-Time': { summary: 'A time of day', example: '14:30:00' },
  'type-TIME_VALUE': { summary: 'A time of day', example: '14:30:00' },

  'type-Age': { summary: 'An age', example: '20y 6m 2d' },
  'type-AGE_AT_EVENT': { summary: 'An age', example: '20y 6m, < 8y' },

  'type-Name': { summary: 'A personal name, surname between slashes', example: 'John /Smith/' },
  'type-NAME_PERSONAL': {
    summary: 'A personal name, surname between slashes',
    example: 'John /Smith/',
  },

  'type-FilePath': { summary: 'A file path or URL' },
  'type-Latitude': { summary: 'A latitude: `N` or `S`, then degrees', example: 'N51.5074' },
  'type-Longitude': { summary: 'A longitude: `E` or `W`, then degrees', example: 'W0.1278' },
  'type-PLACE_NAME': {
    summary: 'Jurisdictions from smallest to largest, comma-separated',
    example: 'Chelsea, London, England',
  },
  'type-EVENTS_RECORDED': {
    summary: 'A comma-separated list of event tags',
    example: 'BIRT, DEAT',
  },
  'type-TagDef': { summary: 'A tag followed by the URI defining it' },
  'type-GEDCOM_FORM': { summary: 'The form of the dataset', example: 'LINEAGE-LINKED' },
  'type-CHARACTER_SET': { summary: 'The character encoding of the file', example: 'UTF-8' },
  'type-MULTIMEDIA_FORMAT': { summary: 'A file format', example: 'jpeg' },
  'type-SOURCE_MEDIA_TYPE': { summary: 'The kind of medium the source is held on' },
  'type-ORDINANCE_PROCESS_FLAG': { summary: 'Either `yes` or `no`' },
  'type-PERMANENT_RECORD_FILE_NUMBER': {
    summary: 'A submitter registration number and record identifier, separated by a colon',
  },
  'type-LANGUAGE_ID': { summary: 'A language name', example: 'English' },
};

/** The 5.5.1 name-piece types are all plain text, and there are seven of them. */
const TEXT_PREFIXES = ['type-NAME_PIECE_'];

/**
 * A description of what belongs in a payload.
 *
 * Unmapped types fall back to their own name with the punctuation smoothed out,
 * which is imperfect but readable — `type-CHILD_LINKAGE_STATUS` becomes "child
 * linkage status" rather than being dropped, and the enumerated values are listed
 * separately anyway.
 */
export function describePayloadType(type: string): PayloadDescription {
  const known = TYPES[type];
  if (known) return known;

  if (TEXT_PREFIXES.some((prefix) => type.startsWith(prefix))) return { summary: 'Text' };

  const name = type
    .replace(/^type-/, '')
    .replace(/^[A-Za-z]+#/, '')
    .replace(/_/g, ' ')
    .toLowerCase();

  return { summary: name.charAt(0).toUpperCase() + name.slice(1) };
}
