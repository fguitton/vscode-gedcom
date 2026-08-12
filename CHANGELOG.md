# Change Log

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

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
