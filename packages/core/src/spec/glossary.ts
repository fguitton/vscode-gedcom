/**
 * What each tag is for, in one sentence.
 *
 * The registry we vendor is a machine's view of the format: tags, payload types,
 * cardinalities, labels. It carries no prose, so a hover built from it alone can
 * do no better than name the tag and report that its payload is text — which
 * tells a reader nothing they could not see on the line in front of them.
 *
 * These sentences are the missing half. They say what belongs in the payload,
 * and where two tags are easily confused they say which is which, because that
 * is the question a reader hovering a tag is usually asking.
 *
 * Keyed by structure slug where the same tag means different things in different
 * places, and by bare tag otherwise. `SOUR` is the clearest case: in the header
 * it is the program that wrote the file, and under a fact it is where the fact
 * came from.
 */
const GLOSSES: Record<string, string> = {
  // --- names ----------------------------------------------------------------
  GIVN: 'The given names, in the order they are used.',
  SURN: 'The family name, without any prefix that is not sorted on.',
  SPFX: 'The part of a surname that sorting ignores — `van`, `de`, `of`.',
  NPFX: 'A title standing before the name — `Dr`, `Rev`, `Lt`.',
  NSFX: 'What follows the name — `Jr`, `III`, `MD`.',
  NICK: 'A name the person was known by that is not part of their formal name.',
  'INDI-NAME-FONE': 'The name written as it sounds; the `TYPE` beneath names the scheme.',
  'INDI-NAME-ROMN': 'The name written in Latin script; the `TYPE` beneath names the scheme.',
  'INDI-NAME-TYPE': 'What kind of name this is — birth, married, immigrant, also known as.',

  // --- attributes of a person -----------------------------------------------
  OCCU: 'The trade or profession, as the recorder wrote it.',
  EDUC: 'Schooling, training or degrees held.',
  DSCR: 'A physical description, in whatever words the record used.',
  NATI: 'The nation or people the person belonged to, which is not their citizenship.',
  'INDI-RELI': 'The religion the person practised.',
  'RELI-RELIGIOUS_AFFILIATION': 'The religious body an event was performed under.',
  PROP: 'Property owned, as described rather than valued.',
  IDNO: 'An identifying number issued by whatever the `TYPE` beneath names.',
  SSN: 'A national identity number.',
  'INDI-TITL': 'A title of nobility or of office that the person held.',
  FACT: 'An attribute with no tag of its own; the `TYPE` beneath says what it is.',
  'INDI-EVEN': 'An event with no tag of its own; the `TYPE` beneath says what it was.',
  'FAM-EVEN': 'An event with no tag of its own; the `TYPE` beneath says what it was.',
  'TYPE-EVENT_OR_FACT_CLASSIFICATION': 'What this otherwise unnamed event or fact was.',

  // --- places and addresses -------------------------------------------------
  CITY: 'The city or town.',
  STAE: 'The state, province or county.',
  POST: 'The postal or zip code.',
  CTRY: 'The country.',
  LATI: 'Latitude, as `N` or `S` followed by degrees — `N51.5`.',
  LONG: 'Longitude, as `E` or `W` followed by degrees — `W0.12`.',
  'FORM-PLACE_HIERARCHY': 'What each comma-separated part of a place name means, smallest first.',
  'PLAC-PLACE_NAME-FONE': 'The place name written as it sounds.',
  'PLAC-PLACE_NAME-ROMN': 'The place name written in Latin script.',

  // --- contact --------------------------------------------------------------
  PHON: 'A telephone number, in whatever form it was written.',
  EMAIL: 'An email address.',
  FAX: 'A fax number.',
  WWW: 'A web address.',

  // --- sources and citations ------------------------------------------------
  'SOUR-SOURCE_DESCRIPTION': 'A source described here rather than by pointing at a source record.',
  PAGE: 'Where in the source this was found — page, entry, folio, film frame.',
  TEXT: 'The words of the source itself, quoted rather than summarised.',
  'SOUR-TITL': 'The title of the work, as it appears on it.',
  PUBL: 'Who published the source, where, and when.',
  'REPO-NAME': 'The name of the archive, library or repository holding it.',
  'SOUR-XREF_SOUR-EVEN': 'Which kinds of event this citation is evidence for.',
  ROLE: 'The part the person played in the event this source records.',
  RELA: 'How the associated person stands to this one — godparent, witness, employer.',

  // --- media ----------------------------------------------------------------
  'OBJE-FILE': 'Where the file is: a web address, or a path relative to this document.',
  'OBJE-NULL-FILE': 'Where the file is: a web address, or a path relative to this document.',
  'TITL-DESCRIPTIVE_TITLE': 'A title for the media object, for showing beside it.',

  // --- identifiers ----------------------------------------------------------
  REFN: 'An identifier this record carries in some other system, chosen by whoever made it.',
  'REFN-TYPE': 'Which system the identifier above belongs to.',
  RIN: 'The identifier the database that exported this file used internally.',
  'SUBM-RFN': "The submitter's registered file number in the Ancestral File.",

  // --- the header -----------------------------------------------------------
  'HEAD-SOUR': 'The program that wrote this file.',
  'HEAD-SOUR-NAME': 'The full name of that program, for a human to read.',
  CORP: 'The organisation that publishes the program named above.',
  'HEAD-SOUR-DATA': 'The database or collection the file was extracted from.',
  'HEAD-FILE': 'The name this file was given when it was written.',
  DEST: 'The system the file was written to be read by.',
  'HEAD-COPR': 'Who owns the material in this file, and on what terms it may be used.',
  'HEAD-SOUR-DATA-COPR': 'Who owns the data the file was extracted from.',
  VERS: 'The version of whatever the enclosing structure names.',
  'SUBM-NAME': 'The name of the person or organisation who submitted the file.',
  FAMF: 'The name of the family file this record was taken from.',
  TEMP: 'The temple where the ordinance was performed, by its code.',

  // --- tags that turn up almost everywhere ----------------------------------
  // These are the commonest tags in a real file and were the emptiest hovers in
  // it: each one is generic by design, and its meaning comes from what it hangs
  // under.
  TYPE: 'What kind of thing the structure above is, in the recorder’s own words.',
  'TYPE-PHONETIC_TYPE': 'Which phonetic scheme the spelling above uses.',
  'TYPE-ROMANIZED_TYPE': 'Which romanisation scheme the spelling above uses.',
  NOTE: 'A note in the recorder’s own words, about the structure it hangs under.',
  PHRASE: 'The same fact in words, for what the coded form above cannot carry.',
  LANG: 'The language of the text, as a BCP 47 tag — `en`, `fr-CA`, `cy`.',
  NAME: 'The name of whatever the structure above describes.',
  ADDR: 'A postal address, either written whole here or split across the parts beneath.',
  TITL: 'The title of whatever the structure above describes.',
  AUTH: 'Who created the source: an author, an agency, a court.',
  FILE: 'Where the file is: a web address, or a path relative to this document.',
  FORM: 'The format of the thing above, as a media type.',
  ABBR: 'A short form of the title, for citing it repeatedly.',
  CAUS: 'The cause recorded for the event, as it was written.',
  AGNC: 'The organisation responsible for the event or the record of it.',
  UID: 'An identifier that stays with this record wherever it is copied.',
  EXID: 'This record’s identifier in some external authority, named beneath.',
  MIME: 'The media type of the text above — `text/plain` or `text/html`.',
  TRAN: 'The same content in another script, language or format.',
  SCHMA: 'Declares what the extension tags used in this file mean.',
  TAG: 'One extension tag, and the address of its definition.',
  CHAR: 'The character set the file was written in, which 7.0 fixes as UTF-8.',
  GEDC: 'Declares which version of GEDCOM this file claims to follow.',

  // --- notes ----------------------------------------------------------------
  'HEAD-NOTE': 'A note about the file as a whole.',
  'record-NOTE': 'Note text held as a record, so that many structures can point at one note.',
  'NOTE-SUBMITTER_TEXT_OR_NULL': 'A note written here, or a pointer to a note record.',
};

/**
 * What a tag is for, where we have something to say about it.
 *
 * The slug is tried first: the same tag genuinely means different things in
 * different places, and answering `SOUR` in the header with what `SOUR` means
 * under a birth would be worse than saying nothing.
 */
export function glossOf(tag: string, slug?: string | null): string | undefined {
  return (slug ? GLOSSES[slug] : undefined) ?? GLOSSES[tag];
}
