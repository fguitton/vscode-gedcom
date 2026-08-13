/**
 * The grammar as GitHub renders it.
 *
 * github.com highlights server-side and sends HTML already marked up with
 * PrettyLights classes — `pl-k`, `pl-s`, `pl-ent` — which Primer's CSS then
 * colours. The highlighter itself has never been open source, so this repository
 * previously approximated the palette by hand, which meant the claim that the
 * semantic classes stay distinct on github.com was a claim nobody could check.
 *
 * Both halves turn out to be obtainable:
 *
 *  - `@wooorm/starry-night` is an open reimplementation of GitHub's highlighter,
 *    built on the same `vscode-textmate` and `vscode-oniguruma` this repository
 *    already uses for its tokenizer tests. It takes our generated grammar as it
 *    stands and emits the same `pl-*` classes.
 *  - `@primer/primitives` publishes the palette itself, and `starry-night` ships
 *    the rules mapping each class to a colour from it.
 *
 * So the Primer panel and the colour tests now run on the real thing. It remains
 * a reimplementation rather than GitHub's own service and could in principle
 * drift, but it is enormously closer than a palette written from memory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { createStarryNight } from '@wooorm/starry-night';

import { repoRoot } from './registry.ts';

const require = createRequire(import.meta.url);

/** The committed grammar, which is what Linguist reads and what GitHub runs. */
const grammarPath = join(repoRoot, 'syntaxes', 'gedcom.tmLanguage.json');

export type PrettyLightsTheme = 'light' | 'dark';

/** A run of source text and the PrettyLights classes wrapping it. */
export interface PrettyLightsToken {
  readonly text: string;
  /** Outermost first, so the last entry is the one that colours the run. */
  readonly classes: readonly string[];
}

/** Minimal shape of the hast tree starry-night returns. */
interface HastNode {
  readonly type: string;
  readonly value?: string;
  readonly properties?: { readonly className?: readonly string[] };
  readonly children?: readonly HastNode[];
}

/**
 * Our grammar, dressed as a Linguist entry.
 *
 * starry-night keys grammars the way Linguist does, so it wants the language
 * names and extensions alongside the TextMate rules. They are the same ones
 * `languages.yml` carries for GEDCOM.
 */
function gedcomGrammar(): Record<string, unknown> {
  const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as Record<string, unknown>;
  return { ...grammar, names: ['gedcom'], extensions: ['.ged', '.gedcom'] };
}

let highlighter: Awaited<ReturnType<typeof createStarryNight>> | undefined;

/** Built once: registering a grammar compiles it. */
async function starryNight() {
  highlighter ??= await createStarryNight([gedcomGrammar() as never]);
  return highlighter;
}

/** Highlights GEDCOM exactly as starry-night would for github.com. */
export async function highlight(source: string): Promise<PrettyLightsToken[]> {
  const engine = await starryNight();
  const tree = engine.highlight(source, 'source.gedcom') as unknown as HastNode;

  const tokens: PrettyLightsToken[] = [];
  const walk = (node: HastNode, classes: readonly string[]): void => {
    if (node.type === 'text') {
      if (node.value !== undefined && node.value !== '') tokens.push({ text: node.value, classes });
      return;
    }
    const nested = node.properties?.className
      ? [...classes, ...node.properties.className]
      : classes;
    for (const child of node.children ?? []) walk(child, nested);
  };

  walk(tree, []);
  return tokens;
}

// --- the palette ------------------------------------------------------------

/** One `.pl-x` or `.pl-a .pl-b` selector, and the colour it applies. */
interface Rule {
  /** Class names the selector requires, ancestors first. */
  readonly chain: readonly string[];
  readonly variable: string;
}

/**
 * Read from the package directory rather than through its export map, which
 * rewrites `./style/*` and does not expose `package.json` at all. The root is
 * found by walking up from the entry point until a manifest appears.
 */
function packageRoot(name: string): string {
  let directory = dirname(require.resolve(name));
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Could not find the root of ${name}.`);
    directory = parent;
  }
  return directory;
}

const styleFile = (name: string): string =>
  readFileSync(join(packageRoot('@wooorm/starry-night'), 'style', `${name}.css`), 'utf8');

/**
 * Reads starry-night's own stylesheet into rules.
 *
 * Parsed rather than reimplemented, so the mapping stays whatever the package
 * says it is. The selectors are all plain class chains — `.pl-c`, `.pl-s .pl-v`
 * — which is why a few lines of parsing suffice where a CSS engine would
 * otherwise be needed.
 */
function rules(): Rule[] {
  const css = styleFile('core');
  const found: Rule[] = [];

  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const variable = /var\(\s*(--color-prettylights-syntax-[a-z-]+)/.exec(body ?? '')?.[1];
    if (!variable) continue;

    for (const selector of (selectors ?? '').split(',')) {
      const chain = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
      if (chain.length > 0) found.push({ chain, variable });
    }
  }

  return found;
}

/** Resolved values for one theme, keyed by custom property. */
function values(theme: PrettyLightsTheme): Map<string, string> {
  const css = styleFile(theme);
  const map = new Map<string, string>();
  for (const [, name, value] of css.matchAll(
    /(--color-prettylights-syntax-[a-z-]+):\s*([^;]+);/g,
  )) {
    map.set(name!, value!.trim());
  }
  return map;
}

export interface Palette {
  readonly theme: PrettyLightsTheme;
  /** Colour of unclassified text, which is most of a GEDCOM file. */
  readonly foreground: string;
  readonly background: string;
  colourOf(classes: readonly string[]): string;
}

/** GitHub's own colours for text GitHub's own highlighter has classified. */
export function palette(theme: PrettyLightsTheme): Palette {
  const applicable = rules();
  const resolved = values(theme);

  // Primer's default foreground and canvas, which PrettyLights leaves alone.
  const foreground = theme === 'light' ? '#1f2328' : '#e6edf3';
  const background = theme === 'light' ? '#ffffff' : '#0d1117';

  return {
    theme,
    foreground,
    background,

    colourOf(classes) {
      if (classes.length === 0) return foreground;
      const innermost = classes[classes.length - 1]!;

      // Later rules win, as they would in a stylesheet, and a descendant
      // selector only applies when its ancestor really is one.
      let colour = foreground;
      for (const rule of applicable) {
        const target = rule.chain[rule.chain.length - 1]!;
        if (target !== innermost) continue;

        const ancestors = rule.chain.slice(0, -1);
        if (!ancestors.every((ancestor) => classes.includes(ancestor))) continue;

        colour = resolved.get(rule.variable) ?? colour;
      }

      return colour;
    },
  };
}
