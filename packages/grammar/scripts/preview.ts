/**
 * Renders a GEDCOM fixture through the real grammar and a real theme, to HTML.
 *
 * The colour design is a set of claims — that events read apart from attributes,
 * that citations recede, that a linkage tag and its pointer look like one gesture.
 * None of those can be checked by reading scope names. They need looking at.
 *
 * Screenshotting an editor would work but is heavy and hard to diff. This instead
 * resolves the same tokens the editor would produce against a theme's own
 * `tokenColors` rules, using TextMate's scope-matching precedence, and emits a
 * standalone page. Deterministic, reviewable in a browser, diffable in CI.
 *
 *     node --experimental-strip-types packages/grammar/scripts/preview.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma') as typeof import('vscode-oniguruma');
const textmate = require('vscode-textmate') as typeof import('vscode-textmate');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const grammarPath = join(repoRoot, 'syntaxes', 'gedcom.tmLanguage.json');
const outputPath = join(repoRoot, 'dist', 'preview', 'index.html');

import { highlight, palette } from '../src/prettylights.ts';
import { resolve, THEMES } from '../src/themes.ts';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SAMPLE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 SCHMA',
  '2 TAG _LOC https://genealogy.net/GEDCOM#_LOC',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE ABT 1901',
  '2 PLAC 京都市, 日本',
  '2 SOUR @S1@',
  '3 PAGE Parish register, p.42',
  '3 QUAY 3',
  '1 DEAT',
  '2 DATE BET 1975 AND 1978',
  '1 FAMS @F1@',
  '1 _UID 4F2A-9C11',
  '1 CHAN',
  '2 DATE 3 MAR 2024',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @VOID@',
  '1 MARR',
  '2 DATE 12 AUG 1925',
  '0 @S1@ SOUR',
  '1 TITL Register of baptisms',
  '1 AUTH Diocese of Kyoto',
  '0 @N1@ SNOTE me@example.com is not a pointer',
  '1 CONT   indented continuation',
  '0 TRLR',
].join('\n');

async function main(): Promise<void> {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  );

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }),
    loadGrammar: async () =>
      textmate.parseRawGrammar(readFileSync(grammarPath, 'utf8'), grammarPath),
  });

  const grammar = await registry.loadGrammar('source.gedcom');
  if (!grammar) throw new Error('Failed to load source.gedcom');

  const panels = THEMES.map((theme) => {
    let state = textmate.INITIAL;
    const lines: string[] = [];

    for (const line of SAMPLE.split('\n')) {
      const result = grammar.tokenizeLine(line, state);
      state = result.ruleStack;

      let html = '';
      for (const token of result.tokens) {
        const text = escapeHtml(line.slice(token.startIndex, token.endIndex));
        const { color, italic } = resolve(token.scopes, theme);
        const style = `color:${color}${italic ? ';font-style:italic' : ''}`;
        const title = escapeHtml(token.scopes[token.scopes.length - 1] ?? '');
        html += `<span style="${style}" title="${title}">${text}</span>`;
      }
      lines.push(html || '&nbsp;');
    }

    return `<section>
      <h2>${escapeHtml(theme.name)}</h2>
      <pre style="background:${theme.background};color:${theme.foreground}">${lines.join('\n')}</pre>
    </section>`;
  });

  // The real thing, rather than an approximation of it: GitHub's own classes
  // from its own highlighter, coloured by GitHub's own published palette.
  const github = await Promise.all(
    (['light', 'dark'] as const).map(async (theme) => {
      const colours = palette(theme);
      const runs = await highlight(SAMPLE);

      let html = '';
      for (const run of runs) {
        const text = escapeHtml(run.text);
        if (run.classes.length === 0) {
          html += text;
          continue;
        }
        const title = escapeHtml(run.classes.join(' '));
        html += `<span style="color:${colours.colourOf(run.classes)}" title="${title}">${text}</span>`;
      }

      return `<section>
      <h2>GitHub PrettyLights (${theme}) — starry-night + @primer/primitives</h2>
      <pre style="background:${colours.background};color:${colours.foreground}">${html}</pre>
    </section>`;
    }),
  );

  const page = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>GEDCOM colour preview</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f6f7f9; color: #10151c; }
  h1 { font-size: 1.25rem; }
  p { max-width: 60rem; color: #4a5568; }
  section { margin: 2rem 0; }
  h2 { font-size: .9rem; text-transform: uppercase; letter-spacing: .08em; color: #4a5568; }
  pre { padding: 1rem; border-radius: 6px; overflow-x: auto;
        font-family: ui-monospace, "Cascadia Mono", monospace; font-size: 13px; line-height: 1.5; }
  span[title]:hover { outline: 1px dotted currentColor; }
</style></head>
<body>
<h1>GEDCOM colour preview</h1>
<p>The same sample tokenized by <code>syntaxes/gedcom.tmLanguage.json</code> and resolved against
each theme's own rules. Hover any token to see what it resolved to.</p>
<p>The last two panels are <strong>not approximations</strong>. They run this grammar through
<code>@wooorm/starry-night</code>, the open reimplementation of GitHub's highlighter, and colour the
result with the PrettyLights palette published in <code>@primer/primitives</code> — so both the
classes and the colours are GitHub's own. Primer separates far fewer buckets than a VS Code theme,
so two semantic classes that look alike there will look alike on github.com.</p>
${panels.join('\n')}
${github.join('\n')}
</body></html>`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, page, 'utf8');
  console.log(`Wrote ${outputPath}`);
  console.log(`  ${panels.length + github.length} panels, ${SAMPLE.split('\n').length} lines`);
}

await main();
