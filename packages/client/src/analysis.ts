/**
 * One analysis per document version, shared by everything that draws.
 *
 * Four things read the same document whenever the cursor moves: the selection
 * store works out which record it landed in, the tree redraws, the details panel
 * redraws, and the status bar re-reads the version. Parsing separately for each
 * costs four passes over the file per keystroke — a quarter of a second on
 * `Royal92.ged`, and proportionally worse on the files people actually keep their
 * own trees in. An extension host that spends that long per cursor move is one
 * the editor eventually declares unresponsive.
 *
 * The server keeps the same cache for the same reason. Kept free of any VS Code
 * import so it can be exercised directly.
 */

import { analyzeText, type Analysis } from '@vscode-gedcom/core';

/** What this needs of a document, which is all `TextDocument` has to satisfy. */
export interface Readable {
  readonly uri: { toString(): string };
  /** Bumped by the editor on every edit, which is what makes this safe. */
  readonly version: number;
  getText(): string;
}

/**
 * How many documents to hold at once.
 *
 * An analysis of a large file is the largest thing this extension keeps in
 * memory, and a reader comparing trees has a handful open at most.
 */
const KEPT = 8;

const cache = new Map<string, { version: number; analysis: Analysis }>();

export function analysisOf(document: Readable): Analysis {
  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached?.version === document.version) return cached.analysis;

  const analysis = analyzeText(document.getText());
  // Re-inserted rather than updated in place, so the map's own order is least
  // recently read first and the oldest entry is the one that goes.
  cache.delete(key);
  cache.set(key, { version: document.version, analysis });

  for (const oldest of cache.keys()) {
    if (cache.size <= KEPT) break;
    cache.delete(oldest);
  }

  return analysis;
}

/** Drops a document's analysis, for when the editor is done with it. */
export function forget(uri: { toString(): string }): void {
  cache.delete(uri.toString());
}
