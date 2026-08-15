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

/**
 * The one package `packages/core` is allowed to import.
 *
 * The rule this test enforces is portability, not purity: whatever is imported
 * has to survive being bundled into a browser worker, which a Node builtin does
 * not. `@internationalized/date` is pure JavaScript with no builtins of its own,
 * and it carries the Hebrew calendar — arithmetic fiddly enough that borrowing an
 * implementation the whole industry uses beats writing a fifth one here.
 *
 * Anything else added to this list needs the same argument made for it.
 */
const PERMITTED = new Set(['@internationalized/date']);

describe('no dependencies', () => {
  it.each(files.map((f) => f.name))('%s imports only relative paths', (name) => {
    const file = files.find((f) => f.name === name)!;

    const external: string[] = [];
    for (const [, specifier] of file.text.matchAll(SPECIFIERS)) {
      if (specifier!.startsWith('.') || PERMITTED.has(specifier!)) continue;
      external.push(specifier!);
    }

    // A bare specifier is either a Node builtin or a package. A builtin breaks
    // the browser build outright; a package has to earn its place above.
    expect(external).toEqual([]);
  });

  it('imports no Node builtin anywhere, which is the rule that matters', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [, specifier] of file.text.matchAll(SPECIFIERS)) {
        if (/^node:/.test(specifier!) || /^(fs|path|os|crypto|url|util)$/.test(specifier!)) {
          offenders.push(`${file.name}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
