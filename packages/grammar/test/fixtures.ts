/**
 * Loads the GEDCOM fixture corpus, decoding each file by its byte-order mark.
 *
 * Encoding detection follows the official algorithm's first step
 * (vendor/registries/version-detection.md): the first two bytes give character
 * width and byte order, because a GEDCOM stream always begins with `0`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
export const fixtureRoot = join(repoRoot, 'fixtures');

export interface Fixture {
  /** Path relative to fixtures/, e.g. "v7/atsign.ged". */
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
}

function decode(bytes: Buffer): { text: string; encoding: Fixture['encoding'] } {
  const [b0, b1] = [bytes[0], bytes[1]];

  // FF FE / 30 00 -> UTF-16 little-endian; FE FF / 00 30 -> big-endian.
  if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0x30 && b1 === 0x00)) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if ((b0 === 0xfe && b1 === 0xff) || (b0 === 0x00 && b1 === 0x30)) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  }
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
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
    .map((path) => {
      const bytes = readFileSync(path);
      const { text, encoding } = decode(bytes);
      return {
        name: relative(fixtureRoot, path).replace(/\\/g, '/'),
        path,
        // Strip the BOM: the editor does this before the grammar ever sees text.
        text: text.replace(/^﻿/, ''),
        encoding,
      };
    });
  return cache;
}

/** Fixtures that are deliberately malformed, used to test error scoping. */
export const knownInvalid = new Set<string>([
  'v5/age-invalid.ged',
  'v7/age-invalid.ged',
  'v5/date-dual-invalid.ged',
  'v7/date-dual-invalid.ged',
]);
