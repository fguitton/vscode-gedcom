/**
 * Personal names.
 *
 * A `NAME` payload marks the surname with slashes — `John Henry /Smith/ Jr` — and
 * everything else about the structure of the name is left to the reader. The
 * slashes exist because there is no other way to tell which word is the family
 * name in a corpus that spans every naming convention there is: `Ludwig van
 * /Beethoven/`, `/Wang/ Xiaoming`, `Maria /García Lorca/`.
 *
 * The parts are worth naming rather than just stripping the slashes, because the
 * surname is the one part a reader is usually trying to pick out.
 */

export interface PersonalName {
  /** Titles and honorifics preceding the given name. */
  readonly prefix?: string;
  readonly given?: string;
  readonly surname?: string;
  /** Generational and post-nominal parts following the surname. */
  readonly suffix?: string;
  /** The whole name with the slashes removed, for display. */
  readonly display: string;
}

const tidy = (text: string): string | undefined => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : undefined;
};

/**
 * Splits a name payload on its surname slashes.
 *
 * An unslashed payload is a name with no surname marked, not a malformed one —
 * mononyms are real, and plenty of exporters simply never wrote the slashes. It
 * comes back as the given name, which is the reading that loses least.
 */
export function parsePersonalName(payload: string): PersonalName {
  const display = tidy(payload.replace(/\//g, ' ')) ?? '';

  const match = /^([^/]*)\/([^/]*)\/(.*)$/s.exec(payload);
  if (!match) {
    const given = tidy(payload);
    return given ? { given, display } : { display };
  }

  const prefix = tidy(match[1]!);
  const surname = tidy(match[2]!);
  const suffix = tidy(match[3]!);

  // Everything before the slashes is given names, possibly with a title in front.
  // Splitting title from given name needs a vocabulary this has no business
  // carrying, so the whole run is reported as the given name.
  return {
    ...(prefix ? { given: prefix } : {}),
    ...(surname ? { surname } : {}),
    ...(suffix ? { suffix } : {}),
    display,
  };
}
