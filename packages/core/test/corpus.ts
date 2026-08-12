/** Shared access to the fixture corpus as raw bytes, since detection needs them. */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, '..', '..', '..', 'fixtures');

export interface Fixture {
  readonly name: string;
  readonly bytes: Uint8Array;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ged') ? [full] : [];
  });
}

let cache: Fixture[] | undefined;

export function fixtures(): readonly Fixture[] {
  cache ??= walk(fixtureRoot)
    .sort()
    .map((path) => ({
      name: relative(fixtureRoot, path).replace(/\\/g, '/'),
      bytes: new Uint8Array(readFileSync(path)),
    }));
  return cache;
}

export function fixture(name: string): Fixture {
  const found = fixtures().find((f) => f.name === name);
  if (!found) throw new Error(`No fixture named ${name}`);
  return found;
}

/** Encodes a GEDCOM source string to bytes, for hand-written cases. */
export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
