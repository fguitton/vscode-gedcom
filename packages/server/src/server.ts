/**
 * Transport-agnostic server wiring.
 *
 * Both entry points — Node and browser worker — hand this function a connection
 * and it registers the same handlers on both. Keeping the split this thin is
 * what makes dual-host support a build concern rather than a code concern.
 */

import type { Analysis } from '@vscode-gedcom/core';
import {
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type InitializeResult,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  analyzeDocument,
  completion,
  defaultSettings,
  definition,
  diagnostics,
  documentHighlights,
  documentSymbols,
  foldingRanges,
  hover,
  references,
  renameEdits,
  semanticTokens,
  semanticTokensLegend,
  type Settings,
} from './features.ts';

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  let settings: Settings = defaultSettings;

  /**
   * Analyses are cached per document version. Every feature needs one, and a
   * 30,000-line file is not something to reparse once per keystroke per feature.
   */
  const cache = new Map<string, { version: number; analysis: Analysis }>();

  function analysisOf(document: TextDocument): Analysis {
    const cached = cache.get(document.uri);
    if (cached?.version === document.version) return cached.analysis;

    const analysis = analyzeDocument(document.getText(), settings);
    cache.set(document.uri, { version: document.version, analysis });
    return analysis;
  }

  function publish(document: TextDocument): void {
    void connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: diagnostics(analysisOf(document)),
    });
  }

  /** Resolves a request's document, or undefined if it has closed. */
  const documentFor = (uri: string) => documents.get(uri);

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
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
    },
  }));

  documents.onDidChangeContent((event) => {
    publish(event.document);
  });

  connection.onDidChangeConfiguration((change) => {
    const section = (change.settings as { gedcom?: Partial<Settings> } | undefined)?.gedcom;
    settings = { ...defaultSettings, ...section };
    // Strictness changes which diagnostics apply, so every open document has to
    // be re-analysed, not just the active one.
    cache.clear();
    for (const document of documents.all()) publish(document);
  });

  documents.onDidClose((event) => {
    cache.delete(event.document.uri);
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  connection.onDefinition(({ textDocument, position }) => {
    const document = documentFor(textDocument.uri);
    return document ? definition(analysisOf(document), textDocument.uri, position) : null;
  });

  connection.onReferences(({ textDocument, position, context }) => {
    const document = documentFor(textDocument.uri);
    if (!document) return [];
    return references(
      analysisOf(document),
      textDocument.uri,
      position,
      context?.includeDeclaration ?? true,
    );
  });

  connection.onHover(({ textDocument, position }) => {
    const document = documentFor(textDocument.uri);
    return document ? hover(analysisOf(document), position) : null;
  });

  connection.onDocumentHighlight(({ textDocument, position }) => {
    const document = documentFor(textDocument.uri);
    return document ? documentHighlights(analysisOf(document), position) : [];
  });

  connection.onDocumentSymbol(({ textDocument }) => {
    const document = documentFor(textDocument.uri);
    return document ? documentSymbols(analysisOf(document)) : [];
  });

  connection.onFoldingRanges(({ textDocument }) => {
    const document = documentFor(textDocument.uri);
    return document ? foldingRanges(analysisOf(document)) : [];
  });

  connection.onRenameRequest(({ textDocument, position, newName }) => {
    const document = documentFor(textDocument.uri);
    return document ? renameEdits(analysisOf(document), textDocument.uri, position, newName) : null;
  });

  connection.onCompletion(({ textDocument, position }) => {
    const document = documentFor(textDocument.uri);
    if (!document) return [];
    const lineText = document.getText({
      start: { line: position.line, character: 0 },
      end: position,
    });
    return completion(analysisOf(document), position, lineText);
  });

  connection.languages.semanticTokens.on(({ textDocument }) => {
    const document = documentFor(textDocument.uri);
    return { data: document ? semanticTokens(analysisOf(document)) : [] };
  });

  documents.listen(connection);
  connection.listen();
}
