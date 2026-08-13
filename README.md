# vscode-gedcom

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/florianguitton.vscode-gedcom?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/florianguitton.vscode-gedcom)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/florianguitton.vscode-gedcom)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![License](https://img.shields.io/github/license/fguitton/vscode-gedcom)](https://github.com/fguitton/vscode-gedcom/blob/master/LICENSE)

GEDCOM language support for Visual Studio Code — syntax highlighting for GEDCOM
5.5.1, GEDCOM 5.5.5 and FamilySearch GEDCOM 7.

This grammar is also the one GitHub uses. The repository is vendored into
[GitHub Linguist](https://github.com/github-linguist/linguist) as
`vendor/grammars/vscode-gedcom`, so it renders every `.ged` file on github.com.

## Features

Syntax highlighting for all three GEDCOM generations. The grammar is deliberately
version-agnostic: all three share one line syntax, and a lexer cannot know which
version a file claims until it has read `HEAD.GEDC.VERS`.

Recognised and distinctly coloured:

- **Levels**, tags, and payloads
- **Cross-references**, with a definition (`0 @I1@ INDI`) styled differently from a
  reference (`1 FAMS @F1@`), plus `@VOID@`
- **Extension tags** (`_UID`) distinct from unrecognised tags
- **Continuations** (`CONT`, `CONC`), preserving the payload's significant leading
  whitespace
- **Dates** — months, numeric components, range and approximation keywords, epochs,
  GEDCOM 7's bare calendar keyword and 5.5.1's `@#DJULIAN@` escape form
- **Personal names**, with the `/surname/` component delimited
- **At-sign escapes** — 5.5.1 doubles every `@`, GEDCOM 7 escapes only a leading one

Structural validity is deliberately _not_ the grammar's job. Whether a tag is legal
in a given position is a question about the structure tree, which no regular
expression can answer; that work belongs to the language server on the roadmap
below.

## Installation

Search for **GEDCOM Language** in the Extensions view, or run:

```
ext install florianguitton.vscode-gedcom
```

## Roadmap

| Status   | Milestone                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ 0.1.0 | Rewritten grammar, fixture corpus, regression harness                                                                                  |
| ✅ 0.2.0 | Zero-dependency GEDCOM parser: CST with source spans, xref index, registry-driven validation                                           |
| ✅ 0.3.0 | Language server — go-to-definition, references, rename, hovers, outline, level-based folding, completion, diagnostics, semantic tokens |
| ✅ 0.4.0 | Graph panel showing the record under the cursor and its nearest edges                                                                  |
| ⬜ later | Legacy encoding conversion (ANSEL, UTF-16), formatter, 5.5.1 → 7.0 conversion, GEDZIP                                                  |

## Development

Requires Node.js as pinned in `.node-version`. The toolchain is
[Vite+](https://viteplus.dev).

```bash
npm ci
npx vp run build     # bundle both extension hosts into dist/
npx vp run grammar   # regenerate syntaxes/gedcom.tmLanguage.json from the registry
npx vp run spec      # regenerate the parser's embedded specification model
npx vp test          # tokenize the corpus, parse it, assert scopes and diagnostics
npx vp check         # lint, format, type-check
npx vp run preview   # render the grammar through real theme palettes, to look at
npx vscode-test      # integration tests in a real VS Code
npx vp run test:web  # integration tests in the web extension host, headless (stable build)
npx vp run dev:web   # launch the web extension host in a browser, to eyeball it
npx vp run verify    # all of the above
```

Pressing <kbd>F5</kbd> runs the `build` task first, so the extension host always
loads the current sources. The extension host executes the bundles in `dist/`
rather than the TypeScript, so a launch without that rebuild looks exactly like
a code change having had no effect.

### Packages

| Package            | Contents                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `packages/grammar` | Generates and tests `syntaxes/gedcom.tmLanguage.json`                        |
| `packages/core`    | The parser: version detection, lexer, CST, cross-reference index, validation |

`packages/core/src` has **zero runtime dependencies and uses no Node builtins**,
so the same code runs in the extension host, in a browser worker on vscode.dev,
and in plain tests. Its entry point takes a `Uint8Array` rather than a string
because version and encoding detection is defined over bytes: the
[official algorithm](https://github.com/FamilySearch/GEDCOM/blob/main/version-detection/version-detection.md)
reads character width and byte order from the first two bytes, before any
decoding can happen.

### Two things to know before changing the grammar

**The grammar is generated.** Do not hand-edit `syntaxes/gedcom.tmLanguage.json`;
edit `packages/grammar/src/grammar.ts` and regenerate. The output is committed
because Linguist reads it directly and runs no build step.

**No rule may use `begin`/`end`.** GEDCOM is strictly line-oriented, so tokenizer
state must never survive a line boundary. This is enforced by a test that asserts
the rule stack returns to depth 1 after every line of every fixture. The grammar
this replaced violated it, which is why one unescaped `@` in a note used to
re-colour the remainder of the file — on Linguist's own `Royal92.ged` sample, 90%
of lines carried leaked state.

## GEDCOM standard

GEDCOM — **GE**nealogical **D**ata **COM**munication — was developed by the Family
History Department of The Church of Jesus Christ of Latter-day Saints to provide a
uniform format for exchanging genealogical data.

Three specifications are in circulation, and they are not interchangeable:

- **[FamilySearch GEDCOM 7](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)**
  (7.0.18, February 2025) — the living standard, and the only one with
  machine-readable [registries](https://github.com/familysearch/GEDCOM-registries).
- **[GEDCOM 5.5.5](https://www.gedcom.org/gedcom.html)** (2019) — a third-party
  strict maintenance release of 5.5.1. Unicode-only, no ANSEL.
- **[GEDCOM 5.5.1](https://www.gedcom.org/gedcom.html)** (1999) — still the most
  common format in the wild.

5.5.5 and 7.0 are divergent successors to 5.5.1 rather than successive versions;
5.5.1 files are generally not valid 7.0 files, and no migration path is defined
between 5.5.5 and 7.0.

## License

[Apache-2.0](LICENSE)
