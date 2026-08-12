import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'florianguitton.vscode-gedcom';
const SAMPLE = 'unicode/names-multiscript.ged';

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
      symbols.some((symbol) => symbol.name.startsWith('INDI')),
      'expected at least one INDI record in the outline',
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

describe('discoverability', () => {
  it('contributes a Show Graph command', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('gedcom.showGraph'), 'expected gedcom.showGraph to be registered');
  });

  it('the command opens the panel without throwing', async () => {
    await openFixture(SAMPLE);
    await vscode.commands.executeCommand('gedcom.showGraph');
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
