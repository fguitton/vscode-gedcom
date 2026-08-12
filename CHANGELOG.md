# Change Log

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.4.0]

### Added

- **Graph panel** showing the neighbourhood of the record at the cursor. It
  follows pointers in both directions — a person connects to their family whether
  the file writes `INDI.FAMS` or `FAM.HUSB`, and a reader does not care which.
  Clicking a node reveals that record; moving the cursor recentres the graph.
  Depth is configurable via `gedcom.graph.depth`, and the neighbourhood is capped
  so a well-connected record cannot flood the panel.
- Layout lives in `packages/core` and is deterministic by design. A force-directed
  layout would look livelier and settle somewhere different every time it ran,
  which is the wrong trade for a panel that redraws as the cursor moves.
- The panel styles itself entirely from VS Code's theme variables, so it matches
  whatever theme is in use, high-contrast included. No dependency on the
  deprecated Webview UI Toolkit.
- **Colour preview** (`vp run preview`) rendering the grammar through Dark+,
  Light+ and an approximation of GitHub's PrettyLights palette, plus a test
  asserting every semantic class resolves to a distinct colour in each. The
  Primer panel is the one that matters: it has the fewest buckets, so two classes
  colliding there would be invisible on github.com.
- **Integration tests** in a real VS Code via `@vscode/test-cli`.

### Fixed

- **The extension could not activate at all.** The repository is `"type": "module"`,
  so Node read the CommonJS bundle as ESM and threw
  `ReferenceError: exports is not defined in ES module scope`. Node outputs are now
  named `.cjs`, which overrides the package type. No unit test could have caught
  this — nothing but VS Code ever loads the bundle — and the first integration
  test run found it immediately.
- **The outline was empty.** Document symbols used `Number.MAX_SAFE_INTEGER` as a
  range end, which exceeds LSP's `uinteger` maximum; every symbol failed protocol
  validation and the client then misread the response as `SymbolInformation`.

## [0.3.0]

The first release with runtime code. A language server now runs in whichever
extension host is active, including the web worker host on vscode.dev.

### Added

- **Go to definition** on any pointer, **find references** from either end, and
  **document highlights** distinguishing a declaration from its uses.
- **Rename** a cross-reference identifier and every pointer to it at once.
- **Hover**: specification labels from the registry, payload types, and — over a
  pointer — a summary of the record it names rather than a restatement of the
  tag. Families resolve their spouse pointers, so a hover reads
  `John Smith + Jane Doe` instead of `@I1@ + @I2@`.
- **Outline and breadcrumbs** with records at the top level, each labelled by
  name, title or spouses.
- **Folding by level number.** GEDCOM lines all start at column zero, so VS
  Code's indentation-based folding does nothing for them.
- **Completion** of tags valid in the enclosing structure, annotated with their
  cardinality, and of record identifiers once a tag has been typed.
- **Diagnostics** from the parser, with a `gedcom.validation.strictness` setting.
- **Semantic tokens** carrying what a regular expression cannot know: whether a
  tag is valid _in this position_, and whether a pointer resolves.

### Infrastructure

- Bundled with tsdown into four outputs. Both hosts get CommonJS with `vscode`
  external; the browser server is an IIFE because it is loaded as a nested worker
  by URL, where module imports and `importScripts` are both unavailable.
- `engines.vscode` raised to `^1.91.0`, the floor for `vscode-languageclient` 10.
- A test asserts `packages/core/src` imports nothing and touches no Node globals,
  enforcing the portability the web build depends on.

## [0.2.0]

Adds `packages/core`, the GEDCOM parser every later feature is a projection of.
Nothing user-visible changes yet — no runtime code ships in the extension until
the language server lands in 0.3.0.

### Added

- **Version and encoding detection** implementing the
  [official algorithm](https://github.com/FamilySearch/GEDCOM/blob/main/version-detection/version-detection.md):
  character width and byte order from the first two bytes, then a byte scan for
  `1 GEDC` / `2 VERS `, then a longest match over the version table. Covers 7.0,
  5.5.5, 5.5.1, 5.5, 5.6, 5.4, 5.3, 5.0, 4.x, the 3.0 fallback and the PAF-era
  `1 SYST` form.
- **Version inference** for files with no `GEDC` structure, which detection
  formally cannot identify. These are not rare: Linguist's own `Royal92.ged` is a
  1992 PAF export with no `GEDC` at all.
- **Lexer** producing line-and-column spans that map onto LSP positions directly.
- **Tree builder** with error recovery. It never throws and never abandons a
  document: a skipped level is reattached at the deepest available depth, and
  every deviation becomes a diagnostic.
- **CONT/CONC folding**, preserving a payload's significant leading whitespace.
- **Cross-reference index** — definitions, references, duplicate and dangling
  detection — with go-to-definition and find-references resolution.
- **Registry-driven validation**: unknown tags, tags misplaced in context,
  cardinality, enumerated values including comma-separated `List#Enum` payloads,
  and pointer target types. `HEAD.SCHMA` declarations are honoured.
- **Embedded specification model**, generated from the pinned registry snapshot
  into `packages/core/src/spec/model.generated.ts` — 180 structures for 7.x and
  195 for 5.5.1, with substructure contexts, cardinalities, payload types,
  enumerations and labels.

### Notes on behaviour

- `packages/core/src` has zero runtime dependencies and uses no Node builtins, so
  it runs unchanged in a browser worker. The entry point takes a `Uint8Array`
  because detection is defined over bytes, before decoding is possible.
- Validation is **strict for GEDCOM 7 and lenient for 5.5.1**, and an
  unidentifiable file is treated leniently. Two decades of exporters produced
  5.5.1 files that violate the specification in ways every consumer tolerates.
- Extension structures are never validated internally. An extension may carry any
  substructures unless it documents otherwise, so an unresolved structure makes
  its whole subtree unchecked rather than checking it against the wrong context.

### Fixed

- `fix(grammar)`: cross-reference identifiers outside ASCII were tokenized as
  `invalid.illegal.line`, discarding the whole record. No specification permits
  them, but files in the wild contain them, and the grammar must not be stricter
  than the parser.

### Testing

- Fixtures covering a dozen writing systems, combining marks and characters
  outside the basic multilingual plane, in UTF-8 and in UTF-16 in both byte
  orders; plus non-ASCII cross-reference identifiers.
- Fixtures for every conformant line terminator — CRLF, lone CR, lone LF — and
  one mixing all three, with `.gitattributes` marking `fixtures/**` as `-text` so
  they survive checkout, and a test that fails if they ever stop doing so.

## [0.1.0]

First release of the rewritten grammar. The previous grammar mis-tokenized every
GEDCOM generation, including 5.5.1, and is replaced wholesale.

### Fixed

- **Tokenizer state no longer escapes a line.** Every rule is now a single-line
  `match`; no rule uses `begin`/`end`. The previous grammar's `begin`/`end` pairs
  leaked state on 27,671 of the 30,682 lines of Linguist's own `Royal92.ged`
  sample, starting at line 1, which is why one unescaped `@` in a note re-coloured
  the remainder of a file.
- **A bare `@` in text is no longer treated as a pointer.** Payloads are only read
  as pointers when the payload is exactly a cross-reference.
- **Extension tags are recognised.** The tag pattern was `[A-Z]*`, which excluded
  `_`-prefixed tags such as `_UID` and could match the empty string.
- **Cross-reference definitions are distinguished from references**, so a theme can
  tell `0 @I1@ INDI` from `1 FAMS @F1@`.
- **5.5.1 cross-references containing spaces** are accepted, per that version's
  `pointer_string` production.
- **Scope names follow TextMate convention.** `text.gedcom` (a root scope reserved
  for document grammars), `storage.type` for pointers and `string.regexp` for
  surnames are all gone.

### Added

- `CONT`/`CONC` continuations, preserving the payload's significant leading
  whitespace.
- Date payloads: months across every calendar the spec defines, numeric components,
  range and approximation keywords, epochs, GEDCOM 7's bare calendar keyword and
  5.5.1's `@#DJULIAN@` escape form.
- Personal names with a delimited `/surname/` component.
- At-sign escape handling for both the 5.5.1 and GEDCOM 7 conventions.
- `@VOID@` as a language constant.
- Support for CR-only line endings and a leading byte-order mark.
- `.gedcom` added alongside `.ged`, and a `firstLine` pattern so extensionless
  GEDCOM files are detected.

### Changed

- The grammar is now **generated** from a pinned snapshot of the
  [FamilySearch GEDCOM registries](https://github.com/familysearch/GEDCOM-registries)
  rather than hand-maintained: 154 known tags, 141 from 7.x and 135 from 5.5.1.
- `engines.vscode` raised from `^1.44.0` to `^1.90.0`.
- Declared `untrustedWorkspaces` and `virtualWorkspaces` support — the extension is
  purely declarative and executes nothing.
- Dropped the `preview` flag.
- Replaced the dead README badges; `vsmarketplacebadge.apphb.com` and `david-dm.org`
  are both defunct.

### Infrastructure

- Vite+ monorepo with a `packages/grammar` workspace.
- Fixture corpus from [gedcom7code/test-files](https://github.com/gedcom7code/test-files)
  and Linguist's `Royal92.ged`, tokenized through `vscode-textmate` — the same
  engine VS Code uses.
- CI verifies the committed grammar is not stale relative to the registry.

## [0.0.4] and earlier

Initial experiment: basic syntax highlighting for GEDCOM 5.5.1.
