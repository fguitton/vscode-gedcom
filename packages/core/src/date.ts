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
