/**
 * What the panels are allowed to fetch.
 *
 * The image preview setting is a privacy control, and a privacy control is only
 * worth the guarantee behind it: with previews off, the panel must be unable to
 * make the request, not merely uninclined to. That guarantee lives in one string.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy } from '../src/policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

describe('the panel security policy', () => {
  it('permits nothing by default', () => {
    expect(contentSecurityPolicy({ nonce: 'abc' })).toBe(
      "default-src 'none'; style-src 'nonce-abc'; script-src 'nonce-abc'",
    );
  });

  it('grants no image source when previews are off', () => {
    // The setting is a promise that the panel makes no request of its own. A
    // policy that still allowed one would leave that promise resting on the
    // renderer's restraint.
    expect(contentSecurityPolicy({ nonce: 'abc', images: false })).not.toContain('img-src');
  });

  it('grants https alone when previews are on', () => {
    const policy = contentSecurityPolicy({ nonce: 'abc', images: true });
    expect(policy).toContain('img-src https:');
    // Plaintext would announce which file is being read, and to whom, to every
    // hop in between. No thumbnail is worth that.
    expect(policy).not.toContain('http:;');
    expect(policy).not.toContain('data:');
  });

  it('grants cspSource for webview local resource access when provided', () => {
    const policy = contentSecurityPolicy({
      nonce: 'abc',
      images: true,
      cspSource: 'vscode-webview-resource:',
    });
    expect(policy).toContain('img-src https: vscode-webview-resource:');
  });

  it('grants data: source when dataImages is enabled', () => {
    const policy = contentSecurityPolicy({
      nonce: 'abc',
      dataImages: true,
    });
    expect(policy).toContain('img-src data:');
  });

  it('binds inline code to the nonce whatever else it permits', () => {
    for (const images of [true, false]) {
      const policy = contentSecurityPolicy({ nonce: 'xyz', images });
      expect(policy).toContain("script-src 'nonce-xyz'");
      expect(policy).toContain("default-src 'none'");
      expect(policy).not.toContain('unsafe-inline');
    }
  });
});

describe('the panels', () => {
  const source = (name: string) =>
    readFileSync(join(root, 'packages', 'client', 'src', name), 'utf8');

  it('write no policy of their own', () => {
    // Two panels once carried two hand-written policies, and only one of them
    // was ever reviewed. Both now go through the function tested above.
    for (const name of ['details-view.ts', 'graph-view.ts']) {
      expect(source(name), `${name} writes a policy of its own`).not.toMatch(
        /content="default-src/,
      );
      expect(source(name), `${name} does not use the shared policy`).toContain(
        'contentSecurityPolicy(',
      );
    }
  });
});
