import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'florianguitton.vscode-gedcom';
const SAMPLE = 'unicode/names-multiscript.ged';
/** Leading numbers that are not levels — a file the parser has to survive. */
const MALFORMED = 'malformed/numbered-list.ged';

/**
 * Anything that blew up without being awaited.
 *
 * These tests run inside the extension host, in the same process as the
 * extension, so a promise our code drops surfaces here. Nothing was watching for
 * that before: an `await` we never wrote fails silently, the feature quietly does
 * nothing, and the only trace is a line in a log nobody has open.
 *
 * Registered at import time so it covers activation itself, which is where most
 * of our unawaited work happens.
 */
const escaped = [];
process.on('unhandledRejection', (reason) => {
  escaped.push(`unhandled rejection: ${reason?.stack ?? reason}`);
});
process.on('uncaughtException', (error) => {
  escaped.push(`uncaught exception: ${error?.stack ?? error}`);
});

/** Opens a fixture from the workspace folder and waits for the server to settle. */
async function openFixture(relative) {
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, 'the fixtures folder should be open as the workspace');

  const uri = vscode.Uri.joinPath(folder.uri, relative);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);

  // Diagnostics and semantic tokens arrive asynchronously from the server.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  return document;
}

/**
 * Whether the graph panel is on screen, asked of the extension itself.
 *
 * There is no API for the visibility of somebody else's webview view, so the
 * extension returns a hook from `activate` for the tests to call. Without it the
 * most a test could say is that the command did not throw — and a command that
 * quietly opens nothing does not throw either, which is how issue #5 shipped.
 */
async function hooks() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  return extension.activate();
}

async function settle(ms = 1_000) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphVisible() {
  // The panel is revealed asynchronously; the webview resolves a tick later.
  await settle();
  return (await hooks()).graphVisible();
}

/**
 * Shuts the panel, so that a test asserting it opens is asserting *this*
 * invocation opened it.
 *
 * Without this the state leaks between tests: the first one to open the panel
 * leaves it open, every later assertion passes on its coat-tails, and a command
 * that opens nothing goes unnoticed — which is exactly what happened here. The
 * first version of these tests passed against the broken code.
 */
async function closePanel() {
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await settle();
  assert.equal((await hooks()).graphVisible(), false, 'the panel should start closed');
}

describe('activation without being asked', () => {
  // Every other test calls extension.activate() first, which is exactly what
  // F5 does NOT do. If VS Code does not activate us on its own, the panel never
  // registers for a real user while the whole suite still passes.
  it('activates on opening a GEDCOM file, with nobody calling activate()', async () => {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, SAMPLE),
    );
    await vscode.window.showTextDocument(document);
    await settle(3_000);

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(extension.isActive, true, 'VS Code did not activate the extension by itself');
  });
});

describe('cold start', () => {
  // Deliberately first-ish contact: no fixture opened, no settling waited for.
  // Every other test warms the extension before asking the panel for anything,
  // so none of them can see the race issue #5 most likely describes — the click
  // arriving while activation, the language context key and the view registration
  // are all still settling.
  it('opens the panel when asked before anything has warmed it', async () => {
    // A GEDCOM file is open — the view is behind a when clause on that — but
    // nothing has settled and no panel has ever been shown.
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, SAMPLE),
    );
    await vscode.window.showTextDocument(document);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph');
    assert.ok(await graphVisible(), 'expected the panel to open from cold');
  });
});

describe('activation', () => {
  it('the extension is present and activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be installed`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it('a .ged file is recognised as GEDCOM', async () => {
    const document = await openFixture(SAMPLE);
    assert.equal(document.languageId, 'gedcom');
  });
});

describe('settings', () => {
  /**
   * A setting the editor never registered is invisible: it has no entry in the
   * Settings UI, `@id:` finds nothing, and reading it returns undefined for
   * every user. Nothing in the manifest tests can see that, because they read
   * the manifest rather than asking the editor what it made of it.
   */
  it('the editor knows every contributed setting, with its declared default', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const declared = extension.packageJSON.contributes.configuration.properties;
    const configuration = vscode.workspace.getConfiguration();

    const missing = [];
    for (const [key, schema] of Object.entries(declared)) {
      const known = configuration.inspect(key);
      if (!known || known.defaultValue === undefined) {
        missing.push(`${key} (unknown to the editor)`);
        continue;
      }
      assert.deepEqual(known.defaultValue, schema.default, `${key} has the wrong default`);
    }

    assert.deepEqual(missing, []);
  });

  it('reads back the default through the section the server is given', async () => {
    // The server is handed the `gedcom` section, so a setting has to answer to
    // that name and not only to its full key.
    const section = vscode.workspace.getConfiguration('gedcom');
    assert.equal(section.get('virtualIndent.enabled'), false);
    assert.equal(section.get('codeLens.enabled'), true);
  });
});

describe('diagnostics a reader can send back', () => {
  it('copies a block naming the build, the host and the panel', async () => {
    await openFixture(SAMPLE);
    await vscode.commands.executeCommand('gedcom.copyDiagnostics');
    const copied = await vscode.env.clipboard.readText();

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.match(copied, /^GEDCOM diagnostics/, `unexpected block:\n${copied}`);
    assert.ok(
      copied.includes(`GEDCOM ${extension.packageJSON.version}`),
      `expected the extension version in:\n${copied}`,
    );
    assert.ok(copied.includes(vscode.version), 'expected the editor version');
    assert.match(copied, /Log level: /);
    assert.match(copied, /Panels: Tree/);
  });

  it('carries what the extension did, not what the file contains', async () => {
    await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    await vscode.commands.executeCommand('gedcom.copyDiagnostics');
    const copied = await vscode.env.clipboard.readText();

    assert.ok(copied.includes('Show Tree invoked'), `expected the invocation in:\n${copied}`);
    assert.ok(copied.includes('Tree panel on screen'), 'expected the outcome of opening it');

    // The fixture's own names, which a public issue must never carry.
    assert.ok(!copied.includes('山田'), 'a personal name reached the diagnostics');
    assert.ok(!copied.includes('الخوارزمي'), 'a personal name reached the diagnostics');
  });

  it('contributes a command that shows the log', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('gedcom.showLog'), 'expected gedcom.showLog');
    await vscode.commands.executeCommand('gedcom.showLog');
  });
});

describe('language server', () => {
  it('go to definition resolves a pointer to its record', async () => {
    const document = await openFixture(SAMPLE);

    // fixtures/unicode/names-multiscript.ged ends with a FAM pointing at @I1@.
    const text = document.getText();
    const offset = text.indexOf('1 HUSB @I1@') + '1 HUSB @'.length;
    const position = document.positionAt(offset);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      document.uri,
      position,
    );

    assert.ok(locations?.length, 'expected a definition for @I1@');
    const line = document.lineAt(locations[0].range.start.line).text;
    assert.match(line, /^0 @I1@ INDI/);
  });

  it('the outline lists records', async () => {
    const document = await openFixture(SAMPLE);
    const symbols = await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );

    assert.ok(symbols?.length, 'expected document symbols');
    assert.ok(
      symbols.some((symbol) => symbol.detail.startsWith('Individual ')),
      'expected at least one individual in the outline',
    );
  });

  it('folding follows level numbers, not indentation', async () => {
    const document = await openFixture(SAMPLE);
    const ranges = await vscode.commands.executeCommand(
      'vscode.executeFoldingRangeProvider',
      document.uri,
    );

    // Every line starts at column zero, so any ranges at all prove the server
    // supplied them rather than VS Code inferring from indentation.
    assert.ok(ranges?.length, 'expected folding ranges');
  });

  it('semantic tokens are produced', async () => {
    const document = await openFixture(SAMPLE);
    const tokens = await vscode.commands.executeCommand(
      'vscode.provideDocumentSemanticTokens',
      document.uri,
    );

    assert.ok(tokens?.data?.length, 'expected semantic tokens');
    assert.equal(tokens.data.length % 5, 0, 'tokens are encoded as quintuples');
  });

  it('a valid file reports no errors', async () => {
    const document = await openFixture(SAMPLE);
    const errors = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

    assert.deepEqual(
      errors.map((d) => `${d.range.start.line + 1}: ${d.message}`),
      [],
    );
  });

  it('a dangling pointer is reported', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'gedcom',
      content: '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n',
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // A diagnostic code is a string, a number, or a {value, target} pair; the
    // server sends plain strings, so narrow to those rather than stringifying.
    const codes = vscode.languages
      .getDiagnostics(document.uri)
      .map((d) => (typeof d.code === 'string' ? d.code : ''));

    assert.ok(
      codes.includes('dangling-pointer'),
      `expected a dangling pointer, saw ${codes.join(', ')}`,
    );
  });
});

describe('graph panel', () => {
  it('the view is contributed and can be focused', async () => {
    await openFixture(SAMPLE);
    // Throws if the view is not registered by the manifest.
    await vscode.commands.executeCommand('gedcom.graph.focus');
  });
});

describe('details panel', () => {
  it('the view is contributed and can be focused', async () => {
    await openFixture(SAMPLE);
    // Throws if the view is not registered by the manifest.
    await vscode.commands.executeCommand('gedcom.details.focus');
  });
});

describe('discoverability', () => {
  it('contributes a Show Tree command', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('gedcom.showGraph'), 'expected gedcom.showGraph to be registered');
  });

  it('the command opens the panel', async () => {
    await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph');
    assert.ok(await graphVisible(), 'expected the graph panel to be showing');
  });

  it('opens the panel when invoked the way the title bar invokes it', async () => {
    // Reported as issue #5: the toolbar button "fails to do anything, except
    // horizontally scroll the location pills". A menu never invokes a command
    // bare — the editor title bar builds its actions with the resource URI as
    // `arg` and forwards its own context after it:
    //
    //   arg: this.resourceContext.get()            // a Uri, not a string
    //   getActionsContext: () => ({ groupId, editorIndex })
    //
    // So the handler is called as (Uri, {groupId, editorIndex}) while the code
    // lens calls it as (uriString, lineNumber). Read as the latter, the menu's
    // context sent an object where a line number belonged: the editor was
    // revealed — which is the scrolling the reporter saw — and the panel never
    // opened, because the call threw before reaching it.
    const document = await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph', document.uri, {
      groupId: 1,
      editorIndex: 0,
    });
    assert.ok(await graphVisible(), 'expected the graph panel to be showing');
  });

  it('opens the panel from a code lens, which does send a line', async () => {
    const document = await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph', document.uri.toString(), 0);
    assert.ok(await graphVisible(), 'expected the graph panel to be showing');
  });
});

describe('the graph panel', () => {
  /** Moves the cursor to a line and lets the panel react. */
  async function putCursorOn(line) {
    const editor = vscode.window.activeTextEditor;
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    await settle();
  }

  it('draws the record the cursor is in', async () => {
    await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    await putCursorOn(5); // 0 @I1@ INDI
    assert.equal((await hooks()).graphShowing()?.focus, 'I1');
  });

  it('draws it on opening, without waiting for the cursor to move', async () => {
    // What a reader does: put the cursor in a record, then press the button.
    await openFixture(SAMPLE);
    await putCursorOn(5); // 0 @I1@ INDI
    await closePanel();

    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    // `graphDrawn` is the panel's own acknowledgement rather than what was sent
    // to it, which is the only way from out here to tell a drawing from a
    // message that never arrived.
    assert.equal((await hooks()).graphDrawn()?.focus, 'I1');
  });

  it('keeps the tree up while the reader works beside it', async () => {
    await openFixture(SAMPLE);
    await putCursorOn(5); // 0 @I1@ INDI
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    // Split, so the GEDCOM file is still on screen while another is worked in —
    // taking notes beside the tree is the whole reason to have both open.
    const other = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# notes taken while reading the tree\n',
    });
    await vscode.window.showTextDocument(other, vscode.ViewColumn.Beside);
    await settle();

    // The tree follows the GEDCOM file on screen, not the active editor.
    assert.equal(
      (await hooks()).graphDrawn()?.focus,
      'I1',
      'the tree should still hold the family the reader was looking at',
    );

    await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
    await settle();
  });

  it('says it is showing nothing when it is showing nothing', async () => {
    // `graphShowing` answers what the panel holds, and holding nothing is one of
    // the answers — every other assertion here rests on that.
    await openFixture(SAMPLE);
    await putCursorOn(5);
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();
    assert.equal((await hooks()).graphShowing()?.focus, 'I1');

    await putCursorOn(0); // 0 HEAD — a record, but not one with a family
    assert.equal((await hooks()).graphShowing()?.focus, null);
    assert.equal((await hooks()).graphDrawn()?.focus, null);
  });

  it('recentres when the cursor moves to another record', async () => {
    // Being open is not the same as being right. The panel is a webview and its
    // contents are opaque from out here, so what it was last asked to draw is
    // the only way to tell a panel that follows the cursor from one stuck on
    // whichever record happened to be under it when it opened.
    await openFixture(SAMPLE);
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    await putCursorOn(5); // 0 @I1@ INDI
    const first = (await hooks()).graphShowing();
    assert.equal(first?.focus, 'I1');
    assert.ok(first.nodes > 0, 'expected the graph to hold somebody');

    await putCursorOn(28); // 0 @I4@ INDI
    assert.equal((await hooks()).graphShowing()?.focus, 'I4');
  });

  it('brings back a panel whose views the reader has all hidden', async () => {
    // Hiding every view in a container takes the container off the panel's tab
    // bar with it, which is the state the button has to recover from.
    await openFixture(SAMPLE);
    await putCursorOn(5); // 0 @I1@ INDI
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();
    assert.equal((await hooks()).graphVisible(), true, 'expected the panel to start open');

    await vscode.commands.executeCommand('gedcom.graph.toggleVisibility');
    await vscode.commands.executeCommand('gedcom.details.toggleVisibility');
    await settle();
    assert.equal((await hooks()).graphVisible(), false, 'expected both views to be hidden');

    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle(2_000);

    assert.equal(
      (await hooks()).graphVisible(),
      true,
      'Show Tree must bring the panel back from a container with nothing left in it',
    );
    // The webview is rebuilt from nothing, so this cannot be a stale reading.
    assert.equal((await hooks()).graphDrawn()?.focus, 'I1');

    await vscode.commands.executeCommand('gedcom.details.resetViewLocation');
    await settle();
  });

  it('populates for a file that does not validate', async () => {
    // Leading numbers that climb without end: the tree is capped at a depth the
    // walkers can recurse, and the panel draws what records the file does hold.
    const document = await openFixture(MALFORMED);
    await closePanel();
    await putCursorOn(3); // 0 @I1@ INDI
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle(2_000);

    assert.ok(
      vscode.languages.getDiagnostics(document.uri).length > 0,
      'the fixture should not validate, or it is testing nothing',
    );
    assert.equal((await hooks()).graphVisible(), true, 'the panel should open');
    assert.equal((await hooks()).graphDrawn()?.focus, 'I1');
  });

  it('holds the record while the editor area is out of the way', async () => {
    // What maximising the panel does: the file stays open, every editor goes off
    // screen. The panels hold what they were showing until the file closes.
    await openFixture(SAMPLE);
    await putCursorOn(5); // 0 @I1@ INDI
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();
    assert.equal((await hooks()).graphDrawn()?.focus, 'I1');
    assert.ok((await hooks()).detailsShowing(), 'the details panel should have filled');

    const elsewhere = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# no editor showing the tree now\n',
    });
    await vscode.window.showTextDocument(elsewhere);
    await settle();

    assert.equal((await hooks()).graphDrawn()?.focus, 'I1', 'the tree emptied itself');
    assert.ok((await hooks()).detailsShowing(), 'the details panel emptied itself');
  });

  it('keeps drawing after the panel is closed and reopened', async () => {
    await openFixture(SAMPLE);
    await closePanel();
    await vscode.commands.executeCommand('gedcom.showGraph');
    await settle();

    await putCursorOn(15); // 0 @I2@ INDI
    assert.equal((await hooks()).graphShowing()?.focus, 'I2');
    assert.equal((await hooks()).graphDrawn()?.focus, 'I2');
  });
});

describe('inlay hints', () => {
  it('resolves a pointer to the record it names', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'gedcom',
      content: [
        '0 HEAD',
        '1 GEDC',
        '2 VERS 7.0',
        '0 @I1@ INDI',
        '1 NAME John /Smith/',
        '1 SEX M',
        '1 FAMS @F1@',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '0 TRLR',
        '',
      ].join('\n'),
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const hints = await vscode.commands.executeCommand(
      'vscode.executeInlayHintProvider',
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
    );

    assert.ok(hints?.length, 'expected inlay hints');

    // A hint's label is either a string or an array of parts. Trimmed, because
    // each carries a leading indent so it does not read as part of the payload.
    const labelOf = (hint) =>
      (typeof hint.label === 'string'
        ? hint.label
        : hint.label.map((part) => part.value).join('')
      ).trim();

    const onLine = (line) => hints.filter((hint) => hint.position.line === line).map(labelOf);

    assert.deepEqual(onLine(8), ['John Smith'], 'expected the HUSB pointer to resolve');
    assert.deepEqual(onLine(5), ['Male'], 'expected the SEX enumeration to be explained');
  });
});

describe('code lens', () => {
  it('summarises each record', async () => {
    const document = await openFixture(SAMPLE);
    const lenses = await vscode.commands.executeCommand(
      'vscode.executeCodeLensProvider',
      document.uri,
      // Titles are filled in by codeLens/resolve, which the client calls only for
      // the lenses it draws; ask for enough of them to assert on.
      50,
    );

    assert.ok(lenses?.length, 'expected code lenses');
    assert.ok(
      lenses.some((lens) => /reference/.test(lens.command?.title ?? '')),
      'expected a reference count lens',
    );
  });

  it('registers the command its lenses invoke', async () => {
    // A lens whose command is not registered fails only when clicked, which no
    // unit test would ever notice.
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('gedcom.showReferences'), 'expected gedcom.showReferences');
  });
});

describe('document links', () => {
  it('makes a web address clickable', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'gedcom',
      content:
        '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @S1@ SOUR\n1 WWW https://example.org/parish\n0 TRLR\n',
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', document.uri);

    assert.ok(links?.length, 'expected a document link');
    assert.equal(links[0].target?.toString(), 'https://example.org/parish');
  });
});

describe('the detected version', () => {
  it('contributes a command that explains it', async () => {
    // The version governs how every line in the file is read, and is often
    // guessed rather than declared. A reader who disagrees needs to see it.
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('gedcom.showVersion'), 'expected gedcom.showVersion');
  });

  it('the command runs without throwing', async () => {
    await openFixture(SAMPLE);
    await vscode.commands.executeCommand('gedcom.showVersion');
  });
});

describe('hovers', () => {
  it('reports the weekday of an exact date', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'gedcom',
      content: '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 BIRT\n2 DATE 12 AUG 1901\n0 TRLR\n',
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(5, 3),
    );

    // `contents` holds MarkdownString objects whose `value` is a getter, so
    // JSON.stringify renders them as `{}`. Read the property directly.
    const text = (hovers ?? [])
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === 'string' ? c : c.value))
      .join('\n');

    assert.match(text, /Monday/, `expected a weekday in the hover, saw ${text}`);
  });
});

/**
 * Last, so everything above has had its chance to misbehave.
 *
 * Mocha reports a failing assertion here rather than letting a dropped promise
 * scroll past in the extension host log, which is where this class of bug has
 * been living.
 */
describe('nothing escaped', () => {
  it('no unhandled rejection or uncaught exception during the run', () => {
    assert.deepEqual(escaped, []);
  });
});
