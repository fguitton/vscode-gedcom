/**
 * Files written with the level indented.
 *
 * The specification puts the level first on the line with nothing before it, and
 * plenty of exporters indent it anyway to show the hierarchy — the sample in
 * `tmcw/gedcom` is one, and it is the kind of file people paste into an issue.
 *
 * The grammar this replaced anchored on `^(\d+)`, so the first line of such a
 * file highlighted and every line after it came out as plain text. That is still
 * what github.com shows, because Linguist vendors a snapshot: the fix reaches
 * GitHub only when the submodule there is bumped.
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { highlight } from '../src/prettylights.ts';
import { repoRoot } from '../src/registry.ts';
import { leafScope, tokenize } from './tokenizer.ts';

const INDENTED = readFileSync(join(repoRoot, 'fixtures', 'style', 'indent-1-space.ged'), 'utf8');

/** The scope covering a substring of a line. */
async function scopeAt(line: string, needle: string): Promise<string> {
  const column = line.indexOf(needle);
  const tokens = await tokenize(line);
  const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
  return token ? leafScope(token) : '';
}

describe('the level need not start the line', () => {
  it('reads the level, tag and payload at any depth', async () => {
    expect(await scopeAt(' 1 NAME Tom /MacWright/', '1')).toBe(
      'constant.numeric.integer.level.gedcom',
    );
    expect(await scopeAt('  2 GIVN Tom', 'GIVN')).toBe('entity.name.tag.gedcom');
    expect(await scopeAt('   3 CITY Williamsburg', 'Williamsburg')).toBe(
      'string.unquoted.payload.gedcom',
    );
  });

  it('still finds the surname inside an indented name', async () => {
    expect(await scopeAt(' 1 NAME Tom /MacWright/', 'MacWright')).toBe(
      'string.quoted.other.surname.gedcom',
    );
  });

  it('never marks an indented line illegal', async () => {
    for (const line of INDENTED.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      for (const token of await tokenize(line)) {
        expect(`${line.trim()} → ${leafScope(token)}`).not.toMatch(/invalid\./);
      }
    }
  });
});

describe('as GitHub would render it', () => {
  it('classifies the whole file rather than the first line alone', async () => {
    // The symptom on github.com today: one coloured line and twenty-one plain
    // ones. Anything above a handful of classified runs means the file is being
    // read as GEDCOM all the way down.
    const runs = await highlight(INDENTED);
    const classified = runs.filter((run) => run.classes.length > 0);
    expect(classified.length).toBeGreaterThan(30);
  });

  it('leaves no visible text unclassified except the pointer delimiters', async () => {
    const runs = await highlight(INDENTED);
    const bare = runs
      .filter((run) => run.classes.length === 0 && run.text.trim() !== '')
      .map((run) => run.text.trim());

    // `@` opens and closes an identifier and carries no colour of its own.
    expect(bare.every((text) => /^@*$/.test(text))).toBe(true);
  });
});
