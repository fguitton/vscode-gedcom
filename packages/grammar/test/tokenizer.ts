/**
 * Tokenizes text with the real grammar, through the same engine VS Code uses
 * (vscode-textmate over Oniguruma). Testing against a hand-rolled regex runner
 * would not prove anything about how the grammar actually behaves in the editor.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');
export const grammarPath = join(repoRoot, 'syntaxes', 'gedcom.tmLanguage.json');

const require = createRequire(import.meta.url);

export interface Token {
  readonly line: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly text: string;
  readonly scopes: readonly string[];
}

let grammarPromise: Promise<textmate.IGrammar> | undefined;

async function loadGrammar(): Promise<textmate.IGrammar> {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
  const wasm = await readFile(wasmPath);
  await oniguruma.loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  );

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName !== 'source.gedcom') return null;
      const raw = await readFile(grammarPath, 'utf8');
      return textmate.parseRawGrammar(raw, grammarPath);
    },
  });

  const grammar = await registry.loadGrammar('source.gedcom');
  if (!grammar) throw new Error('Failed to load source.gedcom grammar');
  return grammar;
}

export function grammar(): Promise<textmate.IGrammar> {
  grammarPromise ??= loadGrammar();
  return grammarPromise;
}

/** Tokenizes every line, threading rule state exactly as the editor does. */
export async function tokenize(text: string): Promise<Token[]> {
  const g = await grammar();
  const tokens: Token[] = [];
  let state = textmate.INITIAL;

  const lines = text.split(/\r\n|\r|\n/);
  for (const [index, line] of lines.entries()) {
    const result = g.tokenizeLine(line, state);
    for (const token of result.tokens) {
      tokens.push({
        line: index,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      });
    }
    state = result.ruleStack;
  }

  return tokens;
}

/**
 * Tokenizes and returns the rule stack after each line. A correct GEDCOM grammar
 * leaves the stack at its initial depth on every line boundary — see
 * `invariants.test.ts`.
 */
export async function tokenizeWithState(
  text: string,
): Promise<{ line: string; index: number; stack: textmate.StateStack }[]> {
  const g = await grammar();
  const out: { line: string; index: number; stack: textmate.StateStack }[] = [];
  let state = textmate.INITIAL;

  const lines = text.split(/\r\n|\r|\n/);
  for (const [index, line] of lines.entries()) {
    const result = g.tokenizeLine(line, state);
    state = result.ruleStack;
    out.push({ line, index, stack: state });
  }

  return out;
}

/** The most specific scope on a token, ignoring the always-present root scope. */
export function leafScope(token: Token): string {
  return token.scopes[token.scopes.length - 1] ?? 'source.gedcom';
}

/** Finds the token covering a character offset on a given line. */
export function tokenAt(tokens: readonly Token[], line: number, column: number): Token | undefined {
  return tokens.find((t) => t.line === line && t.startIndex <= column && column < t.endIndex);
}
