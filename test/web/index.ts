/**
 * Integration tests for the web extension host.
 *
 * This is the host that only a browser can exercise: the extension runs as a web
 * worker with no Node builtins, the language server runs in a *nested* worker
 * loaded by URL, and the graph panel renders under a content security policy that
 * forbids everything the Node host tolerates. None of that is reachable from
 * `@vscode/test-electron`, and the class of bug it hides is the worst kind — the
 * activation failure in 0.4.0 was invisible to every unit test.
 *
 * The runner is hand-rolled rather than Mocha because this module is bundled into
 * a worker, and forty lines of collector cost less than making a test framework
 * survive that environment. `run()` is the entry point VS Code calls.
 */

import * as vscode from 'vscode';

interface Test {
  readonly suite: string;
  readonly name: string;
  readonly fn: () => Promise<void> | void;
}

const tests: Test[] = [];
let currentSuite = '';

function suite(name: string, body: () => void): void {
  currentSuite = name;
  body();
  currentSuite = '';
}

function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ suite: currentSuite, name, fn });
}

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

const EXTENSION_ID = 'florianguitton.vscode-gedcom';

/** Opens an in-memory document and waits for the nested worker to answer. */
async function open(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: 'gedcom', content });
  await vscode.window.showTextDocument(document);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  return document;
}

const TREE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 CHIL @NOPE@',
  '0 TRLR',
  '',
].join('\n');

suite('activation', () => {
  test('the extension activates in the worker host', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    ok(extension, `${EXTENSION_ID} should be installed`);
    await extension.activate();
    equal(extension.isActive, true, 'the extension should be active');
  });

  test('a GEDCOM document is recognised', async () => {
    const document = await open(TREE);
    equal(document.languageId, 'gedcom', 'language id');
  });
});

suite('the language server in a nested worker', () => {
  // Every assertion below proves the same underlying thing: the server bundle
  // loaded as a worker by URL and is answering requests over the message port.

  test('go to definition resolves a pointer', async () => {
    const document = await open(TREE);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(10, 8),
    );

    ok(locations?.length, 'expected a definition for @I1@');
    equal(locations[0]!.range.start.line, 3, 'definition line');
  });

  test('diagnostics are published', async () => {
    const document = await open(TREE);
    const codes = vscode.languages
      .getDiagnostics(document.uri)
      .map((d) => (typeof d.code === 'string' ? d.code : ''));

    ok(codes.includes('dangling-pointer'), `expected a dangling pointer, saw ${codes.join(', ')}`);
  });

  test('semantic tokens are produced', async () => {
    const document = await open(TREE);
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri,
    );

    ok(tokens?.data?.length, 'expected semantic tokens');
    equal(tokens.data.length % 5, 0, 'tokens are encoded as quintuples');
  });

  test('hovers carry the enriched description', async () => {
    const document = await open(TREE);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(7, 3),
    );

    const text = (hovers ?? [])
      .flatMap((hover) => hover.contents)
      .map((part) => (typeof part === 'string' ? part : part.value))
      .join('\n');

    ok(text.includes('Monday'), `expected a weekday in the hover, saw ${text}`);
  });

  test('inlay hints resolve pointers', async () => {
    const document = await open(TREE);
    const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      'vscode.executeInlayHintProvider',
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
    );

    ok(hints?.length, 'expected inlay hints');

    const label = hints
      .filter((hint) => hint.position.line === 10)
      .map((hint) =>
        typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join(''),
      )
      .join('')
      // Each hint carries a leading indent so it does not read as part of the
      // payload it annotates.
      .trim();

    equal(label, 'John Smith', 'the HUSB pointer should resolve');
  });

  test('code lenses are provided', async () => {
    const document = await open(TREE);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      document.uri,
    );

    ok(lenses?.length, 'expected code lenses');
  });
});

suite('the graph panel under the web content security policy', () => {
  test('the view is contributed and can be focused', async () => {
    await open(TREE);
    // The panel's HTML is inline behind a nonce. A CSP violation would fail here
    // and nowhere else, because the Node host serves the same page more leniently.
    await vscode.commands.executeCommand('gedcom.graph.focus');
  });

  test('the commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const command of ['gedcom.showGraph', 'gedcom.showReferences']) {
      ok(all.includes(command), `expected ${command} to be registered`);
    }
  });
});

/**
 * Every test is raced against a clock.
 *
 * A test that never settles takes the whole run with it, and the harness reports
 * nothing at all — no output, no exit, just a browser sitting there. That is the
 * worst failure mode a test runner can have, because it looks identical to an
 * environment problem and tells you nothing about which line is at fault.
 */
const TEST_TIMEOUT_MS = 20_000;

function withTimeout(name: string, run: () => Promise<void> | void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${TEST_TIMEOUT_MS / 1000}s`)),
      TEST_TIMEOUT_MS,
    );

    void (async () => {
      try {
        await run();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        clearTimeout(timer);
      }
    })();
  });
}

export async function run(): Promise<void> {
  const failures: string[] = [];
  let lastSuite = '';

  console.log('\n  running web extension host tests\n');

  for (const entry of tests) {
    if (entry.suite !== lastSuite) {
      console.log(`\n  ${entry.suite}`);
      lastSuite = entry.suite;
    }

    try {
      await withTimeout(entry.name, entry.fn);
      console.log(`    ✔ ${entry.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${entry.suite} > ${entry.name}: ${message}`);
      console.error(`    ✖ ${entry.name}\n      ${message}`);
    }
  }

  console.log(`\n  ${tests.length - failures.length} passing, ${failures.length} failing\n`);

  // Throwing is how the harness learns the run failed; the browser exits non-zero.
  if (failures.length > 0)
    throw new Error(`${failures.length} web test(s) failed:\n${failures.join('\n')}`);
}
