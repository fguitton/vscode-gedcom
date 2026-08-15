/**
 * Regenerates the equinox table from the vendored snapshot.
 *
 * `vendor/calendrier/equinoxes.txt` lists the true autumn equinox at Paris for
 * every Gregorian year from 1583 to 2999, in French, one line each. The French
 * Republican year began on the day of that equinox, so the table *is* the
 * calendar's definition — the arithmetic rules proposed to replace observation
 * disagree with it during the calendar's own lifetime.
 *
 * Run with `vp run equinoxes`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const FIRST = 1583;
const LAST = 2999;

const source = readFileSync(join(root, 'vendor', 'calendrier', 'equinoxes.txt'), 'utf8');

const byYear = new Map<number, number>();
for (const line of source.split(/\r?\n/)) {
  if (!line.trim()) continue;
  // `le 21/09/2092 à 23h 41m 38s 93 jours ...` — day, month, year, then the time.
  const numbers = line
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  const [day, month, year] = numbers;
  if (day === undefined || month !== 9 || year === undefined) {
    throw new Error(`unexpected line: ${line}`);
  }
  byYear.set(year, day);
}

let table = '';
for (let year = FIRST; year <= LAST; year += 1) {
  const day = byYear.get(year);
  if (day === undefined) throw new Error(`no equinox recorded for ${year}`);
  if (day < 21 || day > 24) throw new Error(`equinox out of range in ${year}: ${day}`);
  // One character per year: '1' is the 21st of September, '4' the 24th.
  table += String(day - 20);
}

writeFileSync(
  join(root, 'packages', 'core', 'src', 'equinoxes.generated.ts'),
  `/**
 * GENERATED FILE — do not edit.
 *
 * The day in September on which the true autumn equinox fell at Paris, for every
 * Gregorian year from ${FIRST} to ${LAST}, as one character per year: '1' is the
 * 21st, '4' the 24th.
 *
 * The French Republican year began on the day of that equinox — observation, not
 * arithmetic — so this table is the calendar's definition rather than an
 * approximation of it. Produced from vendor/calendrier/equinoxes.txt by
 * packages/core/scripts/build-equinoxes.ts.
 *
 * Source: https://github.com/Mubelotix/calendrier (rust/data/equinoxes.txt)
 */

export const EQUINOX_FIRST_YEAR = ${FIRST};

export const EQUINOX_DAYS = '${table}';
`,
);

console.log(`equinoxes: ${table.length} years, ${FIRST}–${LAST}`);
