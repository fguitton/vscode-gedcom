/**
 * Transport-agnostic server wiring.
 *
 * Both entry points — Node and browser worker — hand this function a connection
 * and it registers the same handlers on both. Keeping the split this thin is
 * what makes dual-host support a build concern rather than a code concern.
 */

import type { Analysis } from '@vscode-gedcom/core';
import {
  CodeActionKind,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type InitializeResult,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  analyzeDocument,
  codeActions,
  codeLenses,
  resolveCodeLens,
  completion,
  defaultSettings,
  definition,
  diagnostics,
  documentHighlights,
  documentLinks,
  documentSymbols,
  foldingRanges,
  hover,
  inlayHints,
  references,
  renameEdits,
  resolveSettings,
  semanticTokens,
  semanticTokensLegend,
  workspaceSymbols,
  type Settings,
} from './features.ts';

/**
 * A file as it may be named in a log: what it is called, never where it lives.
 *
 * These lines reach the client's channel and from there a bug report, and a home
 * directory carries the reader's name.
 */
function named(uri: string): string {
  return uri.split('/').filter(Boolean).pop() ?? uri;
}

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  let settings: Settings = defaultSettings;

  /**
   * Answers a request, or says why it could not.
   *
   * Every feature is a pure function over an analysis, and any of them can meet
   * a file nothing anticipated. Unguarded, one bad document takes down the
   * feature for every document — and in a notification handler it can take the
   * server with it, which the client answers by starting another one. The
   * fallback is what the feature returns when it has nothing to say.
   */
  function guard<T>(what: string, fallback: T, run: () => T): T {
    try {
      return run();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure);
      connection.console.error(`${what} failed: ${detail}`);
      return fallback;
    }
  }

  /**
   * Analyses are cached per document version. Every feature needs one, and a
   * 30,000-line file is not something to reparse once per keystroke per feature.
   */
  const cache = new Map<string, { version: number; analysis: Analysis }>();

  function analysisOf(document: TextDocument): Analysis {
    const cached = cache.get(document.uri);
    if (cached?.version === document.version) return cached.analysis;

    const started = Date.now();
    const analysis = analyzeDocument(document.getText(), settings);
    cache.set(document.uri, { version: document.version, analysis });

    connection.console.debug(
      `${named(document.uri)}: ${document.lineCount} lines, ` +
        `${analysis.document.records.length} records, ` +
        `${analysis.diagnostics.length} diagnostics, ` +
        `${analysis.version ?? 'no'} version ${analysis.versionSource}, ` +
        `${Date.now() - started} ms`,
    );

    return analysis;
  }

  function publish(document: TextDocument): void {
    const found = guard(
      `Analysing ${named(document.uri)}`,
      [] as ReturnType<typeof diagnostics>,
      () => diagnostics(analysisOf(document)),
    );
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: found });
  }

  /** Resolves a request's document, or undefined if it has closed. */
  const documentFor = (uri: string) => documents.get(uri);

  connection.onInitialize((parameters): InitializeResult => {
    const client = parameters.clientInfo;
    connection.console.info(
      `Server ready for ${client?.name ?? 'an unnamed client'} ${client?.version ?? ''}`.trim(),
    );

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        foldingRangeProvider: true,
        documentHighlightProvider: true,
        renameProvider: true,
        completionProvider: {
          // A cross-reference starts with @; a tag follows the level's space.
          triggerCharacters: ['@', ' '],
        },
        semanticTokensProvider: {
          legend: semanticTokensLegend,
          full: true,
        },
        inlayHintProvider: true,
        documentLinkProvider: { resolveProvider: false },
        codeLensProvider: { resolveProvider: true },
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
      },
    };
  });

  documents.onDidOpen((event) => {
    connection.console.info(`Reading ${named(event.document.uri)}`);
  });

  documents.onDidChangeContent((event) => {
    publish(event.document);
  });

  connection.onDidChangeConfiguration((change) => {
    settings = resolveSettings((change.settings as { gedcom?: unknown } | undefined)?.gedcom);
    connection.console.info(
      `Settings changed: validating ${settings.strictness}, ` +
        `${documents.all().length} open ${documents.all().length === 1 ? 'document' : 'documents'} re-read`,
    );

    // Strictness changes which diagnostics apply, so every open document has to
    // be re-analysed, not just the active one.
    cache.clear();
    for (const document of documents.all()) publish(document);

    // Inlay hints and lenses are not diagnostics; the client has to be asked to
    // fetch them again, or a settings change appears to do nothing until an edit.
    void connection.languages.inlayHint.refresh();
    void connection.sendRequest('workspace/codeLens/refresh');
  });

  documents.onDidClose((event) => {
    cache.delete(event.document.uri);
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  connection.onDefinition(({ textDocument, position }) =>
    guard('Go to definition', null, () => {
      const document = documentFor(textDocument.uri);
      return document ? definition(analysisOf(document), textDocument.uri, position) : null;
    }),
  );

  connection.onReferences(({ textDocument, position, context }) =>
    guard('Find references', [], () => {
      const document = documentFor(textDocument.uri);
      if (!document) return [];
      return references(
        analysisOf(document),
        textDocument.uri,
        position,
        context?.includeDeclaration ?? true,
      );
    }),
  );

  connection.onHover(({ textDocument, position }) =>
    guard('Hover', null, () => {
      const document = documentFor(textDocument.uri);
      return document ? hover(analysisOf(document), position) : null;
    }),
  );

  connection.onDocumentHighlight(({ textDocument, position }) =>
    guard('Highlight', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? documentHighlights(analysisOf(document), position) : [];
    }),
  );

  connection.onDocumentSymbol(({ textDocument }) =>
    guard('Outline', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? documentSymbols(analysisOf(document)) : [];
    }),
  );

  connection.onWorkspaceSymbol(({ query }) =>
    guard('Workspace symbols', [], () => {
      const results = [];
      for (const document of documents.all()) {
        results.push(...workspaceSymbols(analysisOf(document), document.uri, query));
      }
      return results;
    }),
  );

  connection.onFoldingRanges(({ textDocument }) =>
    guard('Folding', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? foldingRanges(analysisOf(document)) : [];
    }),
  );

  connection.onRenameRequest(({ textDocument, position, newName }) =>
    guard('Rename', null, () => {
      const document = documentFor(textDocument.uri);
      return document
        ? renameEdits(analysisOf(document), textDocument.uri, position, newName)
        : null;
    }),
  );

  connection.onCompletion(({ textDocument, position }) => {
    return guard('Completion', [], () => {
      const document = documentFor(textDocument.uri);
      if (!document) return [];
      const lineText = document.getText({
        start: { line: position.line, character: 0 },
        end: position,
      });
      return completion(analysisOf(document), position, lineText);
    });
  });

  connection.languages.semanticTokens.on(({ textDocument }) =>
    guard('Semantic tokens', { data: [] }, () => {
      const document = documentFor(textDocument.uri);
      return { data: document ? semanticTokens(analysisOf(document)) : [] };
    }),
  );

  connection.languages.inlayHint.on(({ textDocument, range }) =>
    guard('Inlay hints', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? inlayHints(analysisOf(document), range, settings) : [];
    }),
  );

  connection.onDocumentLinks(({ textDocument }) =>
    guard('Document links', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? documentLinks(analysisOf(document)) : [];
    }),
  );

  connection.onCodeLens(({ textDocument }) =>
    guard('Code lenses', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? codeLenses(analysisOf(document), textDocument.uri, settings) : [];
    }),
  );

  connection.onCodeLensResolve((lens) =>
    guard('Code lens title', lens, () => {
      const uri = (lens.data as { uri?: string } | undefined)?.uri;
      const document = uri ? documentFor(uri) : undefined;
      return document ? resolveCodeLens(analysisOf(document), lens) : lens;
    }),
  );

  connection.onCodeAction(({ textDocument, range, context }) =>
    guard('Code actions', [], () => {
      const document = documentFor(textDocument.uri);
      return document ? codeActions(analysisOf(document), textDocument.uri, range, context) : [];
    }),
  );

  documents.listen(connection);
  connection.listen();
}
