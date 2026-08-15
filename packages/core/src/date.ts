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

import { fromFrenchRepublican, fromHebrew, fromJulian, fromThai } from './calendar.ts';

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

const MONTH_NAMES: Record<string, string> = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  MAY: 'May',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
};

/**
 * What each date keyword says, in words.
 *
 * Lower case because most of them appear inside a phrase — `FROM ABT 1900 TO
 * 1910` reads "from about 1900 to 1910" — and only the first word of a payload
 * is capitalised, by `readableDate`.
 *
 * `ABT` is "about" rather than "around" or "approximately": it is the word the
 * specification's own prose uses, and the shortest of the three.
 */
const KEYWORD_WORDS: Record<string, string> = {
  ABT: 'about',
  EST: 'estimated',
  CAL: 'calculated',
  INT: 'interpreted as',
  BEF: 'before',
  AFT: 'after',
  BET: 'between',
  AND: 'and',
  FROM: 'from',
  TO: 'to',
};

/**
 * The months of the calendars GEDCOM defines, from the registry's own tokens.
 *
 * The French Republican months keep their French names — they have no English
 * ones in use, and "Vendémiaire" is what a reader will find if they look it up.
 * `COMP` is not a month at all but the five or six days left over at the end of
 * the year, so it is named as what it is.
 */
const FRENCH_R_MONTHS: Record<string, string> = {
  VEND: 'Vendémiaire',
  BRUM: 'Brumaire',
  FRIM: 'Frimaire',
  NIVO: 'Nivôse',
  PLUV: 'Pluviôse',
  VENT: 'Ventôse',
  GERM: 'Germinal',
  FLOR: 'Floréal',
  PRAI: 'Prairial',
  MESS: 'Messidor',
  THER: 'Thermidor',
  FRUC: 'Fructidor',
  COMP: 'complementary days',
};

/** `ADS` is the second Adar, which only a leap year has. */
const HEBREW_MONTHS: Record<string, string> = {
  TSH: 'Tishrei',
  CSH: 'Cheshvan',
  KSL: 'Kislev',
  TVT: 'Tevet',
  SHV: 'Shevat',
  ADR: 'Adar',
  ADS: 'Adar II',
  NSN: 'Nisan',
  IYR: 'Iyar',
  SVN: 'Sivan',
  TMZ: 'Tammuz',
  AAV: 'Av',
  ELL: 'Elul',
};

const CALENDAR_NAMES: Record<string, string> = {
  THAI: 'Thai',
  FRENCH_R: 'French Republican',
  HEBREW: 'Hebrew',
  JULIAN: 'Julian',
};

/**
 * Which calendar a payload declares.
 *
 * 5.5.1 writes an escape — `@#DFRENCH R@`, with a space — and 7.0 writes the
 * calendar as a bare keyword before the date. Both spellings are read here so
 * the rest of the code never has to care which generation it is looking at.
 */
function calendarOf(payload: string): string {
  const escaped = /@#D([A-Z_ ]+)@/.exec(payload)?.[1];
  if (escaped) return escaped.trim().replace(/\s+/g, '_');

  // `THAI` is nobody's standard; Thai exporters write it and files carry it.
  return /^(FRENCH_R|HEBREW|JULIAN|GREGORIAN|THAI)\b/.exec(payload.trim())?.[1] ?? 'GREGORIAN';
}

/** Days in each month, for the day check. Leap February is allowed at 29. */
const GREGORIAN_DAYS: Record<string, number> = {
  JAN: 31,
  FEB: 29,
  MAR: 31,
  APR: 30,
  MAY: 31,
  JUN: 30,
  JUL: 31,
  AUG: 31,
  SEP: 30,
  OCT: 31,
  NOV: 30,
  DEC: 31,
};

/**
 * What is wrong with a date payload, if anything.
 *
 * Deliberately narrow: a word where a month belongs, or a day the month cannot
 * have. Those are the mistakes a person makes typing a date, and both are
 * unambiguous in any calendar and any version.
 *
 * Everything else is left alone. A GEDCOM date may be a range, a period, an
 * approximation, a dual year, an interpreted date with a free-text phrase, or a
 * year on its own, and a validator that does not know a form it meets should say
 * nothing rather than call a correct file wrong.
 */
export function dateProblems(payload: string): string[] {
  const problems: string[] = [];
  const months = monthsOf(payload);
  const calendar = calendarOf(payload);

  // The phrase in `INT 1901 (a guess)` is free text and is not inspected.
  const withoutPhrase = payload.replace(/\([^)]*\)/g, ' ');

  for (const [, day, token] of withoutPhrase.matchAll(
    /(?:\b(\d{1,2})\s+)?\b([A-Z][A-Z_]{1,4})\b/g,
  )) {
    // Keywords and calendar escapes are not months.
    if (token! in KEYWORD_WORDS || /^(GREGORIAN|JULIAN|HEBREW|FRENCH_R|BCE)$/.test(token!))
      continue;
    if (/^@#D/.test(token!)) continue;

    if (!(token! in months)) {
      problems.push(
        `\`${token}\` is not a month in the ${CALENDAR_NAMES[calendar] ?? 'Gregorian'} calendar.`,
      );
      continue;
    }

    const limit = GREGORIAN_DAYS[token!] ?? 30;
    if (day !== undefined && Number(day) > limit) {
      problems.push(`${token} has no day ${day}.`);
    }
  }

  return problems;
}

function monthsOf(payload: string): Record<string, string> {
  const calendar = calendarOf(payload);
  if (calendar === 'FRENCH_R') return FRENCH_R_MONTHS;
  if (calendar === 'HEBREW') return HEBREW_MONTHS;
  return MONTH_NAMES;
}

/**
 * A date payload as a reader would say it.
 *
 * `ABT 3 NOV 1901` is a machine's spelling of "about 3 November 1901". The
 * keywords are as much shorthand as the months are, and a panel that expands one
 * but not the other has only done half the job.
 *
 * The first word is capitalised and the rest are not, which is what makes
 * `BET 1 JAN 1900 AND 31 DEC 1910` come out as a sentence rather than as a row
 * of proper nouns.
 */
export function readableDate(payload: string): string {
  let first = true;
  const months = monthsOf(payload);

  const said = payload
    // 5.5.1 writes the calendar as an escape and 7.0 as a bare keyword. Either
    // way it has been read by now, and the reader is told which calendar it is
    // in words at the end rather than in the middle of the date.
    .replace(/@#D[A-Z_ ]+@\s*/g, '')
    .replace(/^(FRENCH_R|HEBREW|JULIAN|GREGORIAN|THAI)\s+/, '')
    .replace(/\b([A-Z][A-Z_]{1,4})\b/g, (token) => {
      const month = months[token];
      if (month) return month;

      const word = KEYWORD_WORDS[token];
      if (!word) return token;

      const capitalised = first ? word.charAt(0).toUpperCase() + word.slice(1) : word;
      first = false;
      return capitalised;
    });

  const calendar = calendarOf(payload);
  if (calendar === 'GREGORIAN') return said;

  const name = CALENDAR_NAMES[calendar] ?? calendar;
  const converted = toGregorian(payload, calendar);

  // The conversion is the point of the parenthetical: `15 Tishrei 5760` tells a
  // reader nothing they can place, and `25 September 1999` does. Where the date
  // is partial, or bounded, or otherwise not one day, the calendar is still
  // named — that much is always true.
  return converted ? `${said} (${name} · ${converted})` : `${said} (${name})`;
}

/**
 * The Gregorian equivalent of a payload naming one whole day.
 *
 * Only that case: a range, a period or a year on its own converts to a span
 * rather than a date, and printing one end of it would be a lie of omission.
 */
function toGregorian(payload: string, calendar: string): string | undefined {
  if (scanDate(payload).length > 0) return undefined;

  const months = monthsOf(payload);
  const order = Object.keys(months);

  const match = /\b(\d{1,2})\s+([A-Z][A-Z_]{1,4})\s+(\d{1,5})\b/.exec(payload);
  if (!match) return undefined;

  const [, day, token, year] = match;
  const month = order.indexOf(token!) + 1;
  if (month === 0) return undefined;

  const converted =
    calendar === 'HEBREW'
      ? fromHebrew(Number(year), month, Number(day))
      : calendar === 'FRENCH_R'
        ? fromFrenchRepublican(Number(year), month, Number(day))
        : calendar === 'JULIAN'
          ? fromJulian(Number(year), month, Number(day))
          : calendar === 'THAI'
            ? fromThai(Number(year), month, Number(day))
            : undefined;

  return converted
    ? `${converted.day} ${MONTH_ORDER[converted.month - 1]} ${converted.year}`
    : undefined;
}

const MONTH_ORDER = Object.values(MONTH_NAMES);

/**
 * A date payload with its month written out.
 *
 * For reading, not for writing: `14 FEB 1998` is what the file says and what the
 * editor shows, but a panel is prose and `14 February 1998` is how a date is
 * written in prose.
 *
 * Deliberately a substitution rather than a parse. A payload may be a range, an
 * approximation, a dual year, an interpreted date or a phrase, and every one of
 * those forms carries its months the same way — so replacing the month tokens
 * handles all of them, and anything unrecognised passes through untouched. The
 * other calendars name their months differently and are left alone rather than
 * half-translated.
 */
export function expandMonths(payload: string): string {
  return payload.replace(/\b([A-Z]{3})\b/g, (token) => MONTH_NAMES[token] ?? token);
}

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

/**
 * The year a payload settles on.
 *
 * The *last* year in the payload, so `BET 1830 AND 1840` reports 1840 and
 * `FROM 1914 TO 1918` reports 1918. That is the wrong answer for some questions
 * and the right one for the question actually being asked — when did this stop
 * being true — which is what an age or a lifespan is reckoned from.
 */
export function yearOf(payload: string): number | undefined {
  const matches = payload.match(/\b\d{3,4}\b/g);
  return matches ? Number(matches[matches.length - 1]) : undefined;
}

/** Days since the Unix epoch, for arithmetic between two exact dates. */
export function dayNumber(date: ExactDate): number {
  const utc = new Date(Date.UTC(2000, date.month - 1, date.day));
  utc.setUTCFullYear(date.year);
  return Math.round(utc.getTime() / 86_400_000);
}

export interface AgeAt {
  readonly years: number;
  /** True when either date was a bare year, so the answer is off by up to one. */
  readonly approximate: boolean;
}

/**
 * How old somebody was, given a birth date payload and an event date payload.
 *
 * Falls back to subtracting years when either date is not exact, which is the
 * common case in genealogy and still worth showing — knowing a marriage happened
 * at roughly nineteen rather than roughly forty changes how the record reads. The
 * result is flagged approximate so the caller can hedge rather than assert.
 */
export function ageAt(birth: string, event: string): AgeAt | undefined {
  const from = parseExactDate(birth);
  const to = parseExactDate(event);

  if (from && to) {
    let years = to.year - from.year;
    // Not yet had their birthday that year.
    if (to.month < from.month || (to.month === from.month && to.day < from.day)) years -= 1;
    return { years, approximate: false };
  }

  const birthYear = yearOf(birth);
  const eventYear = yearOf(event);
  if (birthYear === undefined || eventYear === undefined) return undefined;

  return { years: eventYear - birthYear, approximate: true };
}

/**
 * How long ago an exact date was, in words.
 *
 * For `CHAN` and `CREA`, where the absolute date answers a question nobody asked
 * and "eleven years ago" answers the one they did: is this record maintained, or
 * has nobody touched it since an import.
 */
export function relativeTime(payload: string, now: Date = new Date()): string | undefined {
  const date = parseExactDate(payload);
  if (!date) return undefined;

  const today = Math.floor(now.getTime() / 86_400_000);
  const days = today - dayNumber(date);

  if (days < 0) return 'in the future';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;

  // Counted in calendar months and years rather than by dividing days. Two
  // calendar years spanning a leap year are 730 days, which a mean-length divisor
  // rounds down to one — reporting a two-year-old change as a year old.
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const beforeAnniversary = nowDayIsBefore(now, date);

  const months =
    (nowYear - date.year) * 12 + (nowMonth - date.month) - (now.getUTCDate() < date.day ? 1 : 0);
  if (months < 12) return months <= 1 ? 'a month ago' : `${months} months ago`;

  const years = nowYear - date.year - (beforeAnniversary ? 1 : 0);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

/** True when the date's anniversary has not yet come round this year. */
function nowDayIsBefore(now: Date, date: ExactDate): boolean {
  const month = now.getUTCMonth() + 1;
  return month < date.month || (month === date.month && now.getUTCDate() < date.day);
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
