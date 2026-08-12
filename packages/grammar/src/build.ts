/**
 * Regenerates syntaxes/gedcom.tmLanguage.json from the pinned spec registry.
 *
 * The output is committed to the repository because GitHub Linguist consumes this
 * repo as a submodule (vendor/grammars/vscode-gedcom) and reads the grammar file
 * directly — it does not run any build step. Keep the path and the `source.gedcom`
 * scope name stable; both are referenced from Linguist's grammars.yml.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildGrammar } from './grammar.ts';
import { knownTags, repoRoot, v551Tags, v7Tags } from './registry.ts';

const outputPath = join(repoRoot, 'syntaxes', 'gedcom.tmLanguage.json');

const grammar = buildGrammar();
writeFileSync(outputPath, `${JSON.stringify(grammar, null, '\t')}\n`, 'utf8');

const ruleCount = Object.keys(grammar.repository).length;
console.log(`Wrote ${outputPath}`);
console.log(
  `  ${knownTags.length} known tags (${v7Tags.size} from 7.x, ${v551Tags.size} from 5.5.1), ${ruleCount} repository rules`,
);
