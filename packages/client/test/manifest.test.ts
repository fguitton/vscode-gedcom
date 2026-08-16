/**
 * Invariants of the extension manifest.
 *
 * Everything checked here has already broken this extension once, in a way that
 * no other test could see: the manifest is read by VS Code and by nothing else,
 * so a mistake in it produces an extension that installs, activates nothing, and
 * reports no error anywhere a developer is looking.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  main: string;
  browser: string;
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  contributes: {
    commands: { command: string }[];
    menus: Record<string, { command: string }[]>;
    configuration: { properties: Record<string, unknown> };
    views: Record<string, { id: string; when?: string }[]>;
  };
};

describe('the API level', () => {
  /**
   * `@types/vscode` is not an ordinary dependency and must not be updated like
   * one. It decides which APIs the compiler believes exist, while
   * `engines.vscode` is the promise made to users about where the extension
   * runs. Raise the types alone and the build happily compiles calls to APIs
   * that are missing on the oldest version we claim to support — and the failure
   * lands on a user, at runtime, on a machine we do not have.
   *
   * So the two move together or not at all. At the time of writing the latest
   * published types are 1.125, twenty-odd releases ahead; nothing here needs
   * them, and adopting them would drop every reader on an older editor for no
   * feature in return.
   */
  it('pins the types to the oldest editor the extension claims to support', () => {
    const types = manifest.devDependencies['@types/vscode'];
    const engines = manifest.engines.vscode;

    expect(types).toBeDefined();
    expect(types!.replace(/^[~^]/, '')).toBe(engines.replace(/^[~^]/, ''));
  });

  it('does not promise more than the language client can deliver', () => {
    // vscode-languageclient sets the real floor; claiming to run below it would
    // be a promise the dependency breaks.
    const client = JSON.parse(
      readFileSync(join(root, 'node_modules', 'vscode-languageclient', 'package.json'), 'utf8'),
    ) as { engines: { vscode: string } };

    expect(manifest.engines.vscode).toBe(client.engines.vscode);
  });
});

describe('the security overrides', () => {
  /**
   * Two advisories reach this repository only through the test runner:
   * `@vscode/test-cli` pins `mocha`, which pins vulnerable `serialize-javascript`
   * and `diff`. Neither is in the published extension — the VSIX contains
   * `dist/`, `syntaxes/` and `images/` and nothing else — but an unfixable
   * advisory fails the security update job on every run, and a permanently red
   * check is one nobody reads.
   *
   * Both replacements were verified against the code that actually uses them,
   * including mocha's failure-diff rendering, which only runs when a test fails
   * and so is never exercised by a green suite.
   */
  it('holds the overrides that clear the advisories', () => {
    const overrides = (manifest as unknown as { overrides: Record<string, string> }).overrides;
    expect(overrides['serialize-javascript']).toBeDefined();
    expect(overrides['diff']).toBeDefined();
  });

  it('resolves them to the versions the advisories require', () => {
    const version = (name: string) =>
      (
        JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as {
          version: string;
        }
      ).version;

    // GHSA fixes land in serialize-javascript 7.0.5 and diff 8.0.3.
    expect(Number.parseInt(version('serialize-javascript'), 10)).toBeGreaterThanOrEqual(7);
    expect(Number.parseInt(version('diff'), 10)).toBeGreaterThanOrEqual(8);
  });
});

describe('the release artifact', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');

  /**
   * The VSIX must be named the way `vsce` would name it —
   * `vscode-gedcom-<version>.vsix`. A hand-written name is one the extension
   * answers to nowhere else: not in the manifest, not on the Marketplace, not in
   * `code --install-extension`. The first two releases went out as
   * `gedcom-<version>.vsix` because the workflow spelled it out by hand.
   */
  it('derives the file name from the manifest rather than spelling it out', () => {
    expect(workflow).toContain("require('./package.json').name");
    expect(workflow).toMatch(/artifact=\$name-\$manifest\.vsix/);
  });

  it('never hard-codes a name the extension does not answer to', () => {
    expect(workflow).not.toMatch(/["']gedcom-\$/);
    expect(workflow).not.toMatch(/gedcom-\$\{/);
  });
});

describe('the entry points', () => {
  /**
   * Both hosts read `"type": "module"` from this package and conclude that a
   * bare `.js` is ESM. The bundles are CommonJS, so Node throws
   * `exports is not defined` and the web worker host — which supports no ESM at
   * all — refuses to load the file. Each cost a release to find.
   */
  it('names both bundles .cjs, whatever the package type says', () => {
    expect(manifest.main.endsWith('.cjs')).toBe(true);
    expect(manifest.browser.endsWith('.cjs')).toBe(true);
  });
});

describe('the contributions', () => {
  it('offers every contributed command somewhere a user can reach it', () => {
    const commands = manifest.contributes.commands.map((entry) => entry.command);
    const reachable = new Set(
      Object.values(manifest.contributes.menus).flatMap((entries) =>
        entries.map((entry) => entry.command),
      ),
    );

    for (const command of commands) expect(reachable.has(command)).toBe(true);
  });

  it('names every setting under the gedcom section', () => {
    // A setting outside the section is never delivered to the server, which
    // synchronises `gedcom` and nothing else.
    for (const key of Object.keys(manifest.contributes.configuration.properties)) {
      expect(key.startsWith('gedcom.')).toBe(true);
    }
  });

  it('declares every setting the source reads', () => {
    // A setting read but never contributed has no default, no description and no
    // entry in the settings UI. Nothing reports it: it simply reads as undefined
    // for every user, forever.
    const directory = join(root, 'packages', 'client', 'src');
    const sources = readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');

    // A setting has a section and a name under `gedcom`; a view or command id
    // has one segment, and `.focus` is the command VS Code makes for a view.
    const read = new Set(
      [...sources.matchAll(/'(gedcom\.[a-z][a-zA-Z]*\.[a-zA-Z.]+)'/g)]
        .map(([, key]) => key!)
        .filter((key) => !key.endsWith('.focus')),
    );

    const declared = Object.keys(manifest.contributes.configuration.properties);
    for (const key of read) expect(declared, `${key} is read but not contributed`).toContain(key);
  });

  it('offers image previews by default and can turn them off', () => {
    const setting = manifest.contributes.configuration.properties[
      'gedcom.details.imagePreviews'
    ] as { type: string; default: boolean } | undefined;

    expect(setting?.type).toBe('boolean');
    // On by default because a file that points at a photograph is usually
    // pointing at one the reader wants; off is one click away, and off means the
    // panel makes no request at all.
    expect(setting?.default).toBe(true);
  });

  it('puts both panels in the GEDCOM container unconditionally', () => {
    const views = manifest.contributes.views['gedcom']?.map((view) => view.id) ?? [];
    expect(views).toContain('gedcom.graph');
    expect(views).toContain('gedcom.details');
  });
});
