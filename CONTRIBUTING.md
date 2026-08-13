# Contributing

## Getting set up

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

## Packages

| Package            | Contents                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `packages/grammar` | Generates and tests `syntaxes/gedcom.tmLanguage.json`                        |
| `packages/core`    | The parser: version detection, lexer, CST, cross-reference index, validation |
| `packages/server`  | The language server, as pure functions over an analysis                      |
| `packages/client`  | The extension: language client, graph panel, status bar                      |

`packages/core/src` has **zero runtime dependencies and uses no Node builtins**,
so the same code runs in the extension host, in a browser worker on vscode.dev,
and in plain tests. Its entry point takes a `Uint8Array` rather than a string
because version and encoding detection is defined over bytes: the
[official algorithm](https://github.com/FamilySearch/GEDCOM/blob/main/version-detection/version-detection.md)
reads character width and byte order from the first two bytes, before any
decoding can happen.

That portability is enforced rather than trusted — `packages/core/test/portability.test.ts`
checks the real invariant instead of relying on a `lib` list.

## Two things to know before changing the grammar

**The grammar is generated.** Do not hand-edit `syntaxes/gedcom.tmLanguage.json`;
edit `packages/grammar/src/grammar.ts` and regenerate. The output is committed
because Linguist reads it directly and runs no build step.

**No rule may use `begin`/`end`.** GEDCOM is strictly line-oriented, so tokenizer
state must never survive a line boundary. This is enforced by a test that asserts
the rule stack returns to depth 1 after every line of every fixture. The grammar
this replaced violated it, which is why one unescaped `@` in a note used to
re-colour the remainder of the file — on Linguist's own `Royal92.ged` sample, 90%
of lines carried leaked state.

## Testing

Four layers, and each exists because the one below it cannot see a particular
class of failure:

- **Unit tests** over the grammar, parser and language features.
- **Integration tests in a real VS Code** (`npx vscode-test`). These catch what
  only a running extension host can: that the manifest wires up and the bundles
  actually load. Two release-costing activation bugs were found here and nowhere
  else.
- **Integration tests in the web extension host** (`npx vp run test:web`). The
  other host: a web worker with no Node builtins, the language server in a
  _nested_ worker loaded by URL, and the panels under a stricter content
  security policy.
- **Measured properties** rather than assertions, where the thing being tested
  is a matter of degree — how tangled the graph is, and whether it holds still
  when the selection moves. See `packages/core/test/graph-crossings.test.ts` and
  `graph-stability.test.ts`, which record the current figures and the reasoning
  behind them.

`--quality=stable` on the web harness is not incidental. The default is
`insiders`, which downloads whichever build is newest that day, so the same
commit passes or fails depending on when it runs — and a broken Insiders build
hangs the harness before it invokes any test module, printing nothing at all.

## Releasing

Bump `version` in `package.json`, write the `## [x.y.z]` section in
`CHANGELOG.md`, then tag:

```bash
git tag -a v0.5.0 -m "0.5.0" && git push origin v0.5.0
```

The tag triggers `.github/workflows/release.yml`, which refuses to proceed
unless the tag, the manifest and the changelog agree, runs the whole gate again
against the tagged commit, attaches the VSIX to a GitHub Release with the
changelog entry as its notes, and publishes to the Marketplace. It is safe to
re-run: an existing release is updated rather than treated as an error.

Publishing needs a `VSCE_PAT` repository secret — an Azure DevOps personal access
token for the `florianguitton` publisher, created at [dev.azure.com](https://dev.azure.com)
under User settings → Personal Access Tokens with **All accessible organizations**
and the **Marketplace → Manage** scope. A token scoped to a single organisation
fails with an unhelpful 401.

Without the secret the release is still made and the VSIX attached; only the
Marketplace upload is skipped, so a missing token costs a re-run rather than a
bad release.

## A note on the README badges

`README.md` _is_ the Marketplace listing, and the Marketplace renders images only
from an allowlist of hosts — `img.shields.io` is on it; most badge services are
not, and an image from anywhere else shows as broken on the listing while
looking fine on GitHub.

Badges here have now rotted twice: `vsmarketplacebadge.apphb.com` and
`david-dm.org` went away, and shields.io has since **retired its entire
`visual-studio-marketplace` family** — version, installs, downloads and rating
all answer "retired badge". The obvious replacement, `vsmarketplacebadges.dev`,
works but is not on the Marketplace allowlist.

So the badges are deliberately ones that cannot rot: a static Marketplace link,
and release, build and licence from shields' GitHub endpoints. Version, installs
and rating are no loss on the listing itself — the Marketplace page already
displays all three in its own header.

## Updating GitHub's rendering

This repository is vendored into
[Linguist](https://github.com/github-linguist/linguist) as
`vendor/grammars/vscode-gedcom`, and github.com renders `.ged` files with
whatever grammar Linguist last vendored. A grammar change therefore reaches
GitHub only through a pull request there that bumps the submodule.

`vp run preview` renders the grammar four ways: Dark+ and Light+ for VS Code,
and **GitHub's real rendering** in light and dark.

The GitHub panels are not an approximation. github.com highlights server-side
and sends HTML already marked up with PrettyLights classes — `pl-k`, `pl-s`,
`pl-ent` — which Primer's CSS colours; the highlighter itself has never been
open source. But both halves are obtainable:

- [`@wooorm/starry-night`](https://github.com/wooorm/starry-night) is an open
  reimplementation of it, built on the same `vscode-textmate` and
  `vscode-oniguruma` this repository already uses. It takes the committed
  grammar as it stands.
- `@primer/primitives` publishes the palette, and starry-night ships the rules
  mapping each class to a colour from it.

`packages/grammar/test/prettylights.test.ts` asserts against that rather than
against a palette written from memory — which matters, because Primer separates
far fewer buckets than a VS Code theme and the collapses only show up there. It
records exactly which semantic classes GitHub cannot tell apart.

This is still a reimplementation and could drift from GitHub's service. There is
no way to preview a branch's grammar on github.com itself; the rendering only
changes once a Linguist pull request bumps the submodule.

`scopeName` must stay `source.gedcom` and the language id `459577965`. Both are
fixed by Linguist's `grammars.yml` and `languages.yml`, and changing either
breaks detection.
