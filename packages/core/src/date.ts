/**
 * Date payload scanning.
 *
 * Genealogical dates are rarely exact, and the difference between a date that is
 * *known* and one that is *guessed* is among the most important distinctions in a
 * file. GEDCOM encodes it in a leading keyword, which is easy to miss when every
 * date is coloured the same.
 *
 * This scans for those keywords and reports where they are, so callers can treat
 * an approximate date differently from a bounded one. It is not a date parser —
 * validating the calendar and the numbers is a separate concern.
 */

export type DateQualifier =
  /** ABT, EST, CAL, INT — the value is not asserted as exact. */
  | 'uncertain'
  /** BEF, AFT, BET, AND — bounded, but exact within its bounds. */
  | 'range'
  /** FROM, TO — a span during which something was continuously true. */
  | 'period';

export interface DateKeyword {
  readonly keyword: string;
  readonly qualifier: DateQualifier;
  /** Column offsets within the payload. */
  readonly start: number;
  readonly end: number;
}

const QUALIFIERS: Record<string, DateQualifier> = {
  ABT: 'uncertain',
  EST: 'uncertain',
  CAL: 'uncertain',
  INT: 'uncertain',
  BEF: 'range',
  AFT: 'range',
  BET: 'range',
  AND: 'range',
  FROM: 'period',
  TO: 'period',
};

const KEYWORD = /\b(ABT|EST|CAL|INT|BEF|AFT|BET|AND|FROM|TO)\b/g;

/** Finds every date keyword in a payload, with its offsets. */
export function scanDate(payload: string): DateKeyword[] {
  const found: DateKeyword[] = [];
  for (const match of payload.matchAll(KEYWORD)) {
    const keyword = match[1]!;
    found.push({
      keyword,
      qualifier: QUALIFIERS[keyword]!,
      start: match.index,
      end: match.index + keyword.length,
    });
  }
  return found;
}

/** True when a date payload asserts something other than an exact date. */
export function isUncertain(payload: string): boolean {
  return scanDate(payload).some((k) => k.qualifier === 'uncertain');
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface ExactDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
  /** Weekday name, which is the whole reason for parsing the date at all. */
  readonly weekday: string;
}

/**
 * Reads a complete, unqualified Gregorian date.
 *
 * Returns nothing for anything else — a year alone, a range, an approximation, or
 * a non-Gregorian calendar — because the interesting thing to say about a full
 * date is what day of the week it fell on, and that is only meaningful when the
 * day is actually known and the calendar is the one JavaScript reckons in.
 */
export function parseExactDate(payload: string): ExactDate | undefined {
  if (scanDate(payload).length > 0) return undefined;
  // A leading calendar keyword means it is not the proleptic Gregorian calendar
  // JavaScript's Date implements, so a weekday would be wrong.
  if (/^\s*(JULIAN|HEBREW|FRENCH_R|ROMAN|UNKNOWN)\b/.test(payload)) return undefined;
  if (/\bBCE?\b/.test(payload)) return undefined;

  const match = /^\s*(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})\s*$/.exec(payload);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = MONTHS.indexOf(match[2]!);
  const year = Number(match[3]);
  if (month < 0) return undefined;

  const date = new Date(Date.UTC(year, month, day));
  // Years under 100 are shifted into the 20th century by the Date constructor.
  date.setUTCFullYear(year);

  // Reject dates the calendar rolled over, such as 31 FEB.
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return undefined;

  return { day, month: month + 1, year, weekday: WEEKDAYS[date.getUTCDay()]! };
}

/** A human phrase for what a qualified date is claiming. */
export function describeDate(payload: string): string | undefined {
  const keywords = scanDate(payload);
  if (keywords.length === 0) return undefined;

  const has = (word: string) => keywords.some((k) => k.keyword === word);

  if (has('BET') && has('AND')) return 'Somewhere between two dates, inclusive.';
  if (has('FROM') && has('TO')) return 'A period, running between two dates.';
  if (has('FROM')) return 'A period starting at this date.';
  if (has('TO')) return 'A period ending at this date.';
  if (has('BEF')) return 'Before this date, exclusive.';
  if (has('AFT')) return 'After this date, exclusive.';
  if (has('ABT')) return 'Approximate — the true date is near this one.';
  if (has('EST')) return 'Estimated from other evidence rather than recorded.';
  if (has('CAL')) return 'Calculated from another date, such as an age at death.';
  if (has('INT')) return 'Interpreted by the compiler from a non-standard record.';
  return undefined;
}
