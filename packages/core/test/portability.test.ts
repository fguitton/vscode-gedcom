/**
 * The parser's portability contract.
 *
 * `packages/core/src` must run unchanged in the Node extension host, in a browser
 * worker on vscode.dev, and in plain tests. That rests on two properties which
 * are easy to break by accident and impossible to notice until the web build
 * fails at runtime, so they are asserted directly rather than left to a lib list
 * in tsconfig.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const files = sources(sourceRoot).map((path) => ({
  name: relative(sourceRoot, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Matches every import and re-export specifier. */
const SPECIFIERS = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g;

describe('no dependencies', () => {
  it.each(files.map((f) => f.name))('%s imports only relative paths', (name) => {
    const file = files.find((f) => f.name === name)!;

    const external: string[] = [];
    for (const [, specifier] of file.text.matchAll(SPECIFIERS)) {
      if (specifier!.startsWith('.')) continue;
      external.push(specifier!);
    }

    // A bare specifier is either a Node builtin or a package. Both break the
    // browser build, and neither is needed: the parser is self-contained.
    expect(external).toEqual([]);
  });
});

describe('no Node builtins', () => {
  it.each(files.map((f) => f.name))('%s uses no Node globals', (name) => {
    const file = files.find((f) => f.name === name)!;

    const forbidden = ['process.', 'Buffer.', '__dirname', '__filename', 'require('];
    const used = forbidden.filter((token) => file.text.includes(token));

    expect(used).toEqual([]);
  });
});

describe('the public API accepts bytes', () => {
  it('takes a Uint8Array, not a Node Buffer', async () => {
    // Detection is defined over bytes and must not assume a Node type.
    const { analyze } = await import('../src/index.ts');
    const bytes = new TextEncoder().encode('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n');
    expect(analyze(bytes).version).toBe('7.0');
  });
});
