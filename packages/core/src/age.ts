/**
 * Age payloads.
 *
 * `2 AGE 20y 6m` is a compact notation that reads as noise until you know it, and
 * it is worth reading because it is frequently the only evidence for a birth date
 * — a death certificate gives an age, and the birth year is inferred from it.
 *
 * Which is also why it is worth checking. An age recorded beside an event, in a
 * record that also carries a birth date, is a claim that can disagree with the
 * rest of the file; nothing else in the format cross-checks it.
 */

export interface Age {
  /** `<` or `>` — the true age is less or greater than what follows. */
  readonly bound?: '<' | '>';
  readonly years?: number;
  readonly months?: number;
  readonly weeks?: number;
  readonly days?: number;
  /**
   * `CHILD`, `INFANT` or `STILLBORN`. GEDCOM 5.5.1 allowed these words in place of
   * a duration; GEDCOM 7 dropped them in favour of a `PHRASE` substructure.
   */
  readonly phrase?: string;
}

const WORDS: Record<string, string> = {
  CHILD: 'a child — under eight years old',
  INFANT: 'an infant — under one year old',
  STILLBORN: 'stillborn',
};

const UNIT = /(\d+)\s*([ymwd])/gi;

/**
 * Reads an age payload, leniently.
 *
 * Lenient because the grammar fixes an order — years, months, weeks, days — that
 * exporters do not reliably honour, and a payload written out of order is
 * unambiguous even so. Ordering is a validation question, not a reading one.
 */
export function parseAge(payload: string): Age | undefined {
  const text = payload.trim();
  if (text.length === 0) return undefined;

  const word = text.toUpperCase();
  if (word in WORDS) return { phrase: word };

  const boundMatch = /^([<>])\s*/.exec(text);
  const bound = boundMatch?.[1] as '<' | '>' | undefined;
  const rest = boundMatch ? text.slice(boundMatch[0].length) : text;

  const age: { -readonly [K in keyof Age]: Age[K] } = {};
  if (bound) age.bound = bound;

  let matched = 0;
  let consumed = 0;
  for (const match of rest.matchAll(UNIT)) {
    const value = Number(match[1]);
    switch (match[2]!.toLowerCase()) {
      case 'y':
        age.years = value;
        break;
      case 'm':
        age.months = value;
        break;
      case 'w':
        age.weeks = value;
        break;
      case 'd':
        age.days = value;
        break;
    }
    matched += 1;
    consumed += match[0].length;
  }

  if (matched === 0) return undefined;
  // A payload that is mostly something else with a stray `3d` in it is not an age.
  if (consumed < rest.replace(/\s+/g, '').length) return undefined;

  return age;
}

const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;

/** An age in words, for a reader who has not memorised the notation. */
export function describeAge(age: Age): string {
  if (age.phrase) return WORDS[age.phrase] ?? age.phrase.toLowerCase();

  const parts: string[] = [];
  if (age.years !== undefined) parts.push(plural(age.years, 'year'));
  if (age.months !== undefined) parts.push(plural(age.months, 'month'));
  if (age.weeks !== undefined) parts.push(plural(age.weeks, 'week'));
  if (age.days !== undefined) parts.push(plural(age.days, 'day'));

  const duration = parts.join(', ');
  if (age.bound === '<') return `less than ${duration}`;
  if (age.bound === '>') return `more than ${duration}`;
  return duration;
}

/** Mean days per year and per month, for comparing an age against a date interval. */
const DAYS_PER_YEAR = 365.2425;
const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;

/**
 * An age as a number of days, for comparison against dates.
 *
 * Approximate by construction: `6m` does not name which six months. That is fine
 * for the only thing this is used for — noticing that a stated age and a pair of
 * dates disagree by years rather than by days.
 */
export function ageInDays(age: Age): number | undefined {
  if (age.phrase) return undefined;

  const total =
    (age.years ?? 0) * DAYS_PER_YEAR +
    (age.months ?? 0) * DAYS_PER_MONTH +
    (age.weeks ?? 0) * 7 +
    (age.days ?? 0);

  return total > 0 || age.years === 0 || age.days === 0 ? total : undefined;
}
