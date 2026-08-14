# Change Log

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Code lens titles are computed on demand, per visible lens, instead of for every
  record on every edit.

## [0.8.0]

### Added

- `gedcom.virtualIndent.enabled` indents each line by its level, as a decoration
  that never touches the file ([#2]). `gedcom.virtualIndent.width` sets the
  columns per level.
- Dates are validated: a month that is not a month, or a day the month cannot
  have. Every calendar, both spellings of the calendar escape.

## [0.7.1]

### Fixed

- **Show Tree did nothing at all when no GEDCOM file was in front of you** ([#5]).
  The view is contributed behind `editorLangId == gedcom`, so there was no view
  to focus and `.focus` resolved silently. It now says so, and where the view
  exists but has not come up yet — activation, the context key and the click all
  racing on a cold editor — the container is opened directly rather than the
  result being assumed. An integration test covers the cold path, which every
  other test warms past.

### Changed

- The README lists every setting, with its default and what it does.
- `glob` is pinned through `overrides` to 13. Mocha pulled 10, which npm warns is
  unsupported; nothing else in the tree was on it, and no advisory was open.
- `@playwright/browser-chromium` is approved under npm's install-script allowlist,
  so `npm install` no longer stops to ask about it.

## [0.7.0]

### Added

- Notes holding markup can be rendered instead of read as characters, with a
  Text / HTML switch. `gedcom.details.noteFormat` sets the starting choice,
  default `text`; the switch lasts the session. Rendering copies the parsed tree
  through an allowlist of formatting tags — the only attribute kept anywhere is
  `href`, on `http(s)` only.
- `fixtures/notes/` — HTML in notes, split mid-URL by `CONC` in 5.5.1 and
  declared with `MIME` in 7.0. Both carry well-formed, unclosed and crossed
  markup, since no rule in either specification inspects any of it.

### Fixed

- **The toolbar button did not open the tree panel** ([#5]). The editor title bar
  passes the resource and its own `{groupId, editorIndex}` context; read as the
  code lens's `(uri, line)`, that revealed the editor at a nonsense position and
  never opened the panel.
- **An inline note was reported as a broken pointer** ([#2]). 5.5.1 defines
  `NOTE`, `SOUR`, `OBJE` and `REPO` as either a pointer or the content in place,
  and the registry models only the pointer form — so most exporters' notes were
  called malformed.

### Changed

- "Show Graph" is now **Show Tree**, the panel is **Tree**, and the code lens says
  **see in the tree**. Setting keys and command ids are unchanged.
- Records are counted in English: `3,010 individuals · 1,422 families`, not
  `3,010 INDI · 1,422 FAM`. Used by the lens, the header hover and the details
  panel alike.
- Dates are said in words, in every calendar GEDCOM defines. `ABT 3 NOV 1901`
  reads "About 3 November 1901"; a French Republican or Hebrew date keeps its own
  month names and is labelled with its calendar. Gregorian carries no label.
- The lens above a record leads with the name, then the sex in English and the
  years: `Victoria Hanover · Female · 1819–1901 · 2 parents · 1 spouse`.
- Inlay hints read as captions: `Died age 73`, `Male`.

### Testing

- The integration tests assert the panel **opens** and **follows the cursor**,
  not merely that a command did not throw. They also fail on any unhandled
  rejection in the extension host, and run against **Insiders** as an advisory CI
  job — where [#5] came from, and the one combination nothing covered.

[#2]: https://github.com/fguitton/vscode-gedcom/issues/2
[#5]: https://github.com/fguitton/vscode-gedcom/issues/5

## [0.6.0]

Files that indent themselves are read like any other, and the panels stop showing
the reader the file's own shorthand.

### Added

- **Indented files** are lexed, highlighted, folded and validated exactly as flat
  ones are, whatever they indent with. `detectIndentation` reports the habit and
  any line departing from it. A tab's width is the one thing a file cannot state,
  so where tabs and spaces mix it is solved by search.
- Seven `fixtures/style/` files: the same tree at three space widths, at tabs, and
  at tabs-then-spaces with three tab widths. A test asserts all seven parse to the
  _same_ tree — the level number states the hierarchy, the whitespace states
  nothing.
- **A sentence about what each tag is for, in hovers.** The vendored registry
  carries no prose, so a hover over `OCCU` answered "Text." Ninety structures now
  carry a gloss; across the corpus, hovers that said nothing went from several
  hundred to none.
- **Links and image previews in the details panel.** URLs anywhere in a field open
  in the browser; media identified as a picture gets a thumbnail.
  `gedcom.details.imagePreviews` turns previews off, and off rewrites the panel's
  content security policy rather than merely suppressing the `<img>` — so the
  panel is then unable to make the request. `https` only, even when on.

### Fixed

- A media object written inline was reported as a broken pointer. Only the
  payload-less form is exempt: `1 ASSO @I1@ df` is still wrong however many
  substructures follow it.
- A date's time of day was dropped from the details panel. `TIME` hangs under
  `DATE`, not beside it, in both versions.

### Changed

- **Names are read rather than copied.** The slashes in `/Family/ Personal` mark
  the surname; the panel shows the name without them, in the order the file wrote
  — that order is information — and lists the parts beneath. Where a person holds
  several names, each `TYPE` becomes its label.
- A structure carrying nothing says so, in italic, instead of reading "recorded".
- Enumerated payloads are shown in English: `Sex: Female`, not `Sex: F`.
- A media object is named by its own title, with the kind of file it is.

## [0.5.2]

Tooling and documentation only.

`0.5.1` was tagged and never shipped: the manifest was left at `0.5.0`, so the
release workflow's version guard refused it — which is what that guard is for.

### Fixed

- The release workflow could not be re-run: it skips the Marketplace without
  `VSCE_PAT` and says to run it again, but `gh release create` fails once the
  release exists. An existing release is now updated in place.
- `dist/preview/` no longer ships in the VSIX.
- The README badges were dead — shields.io retired its whole
  `visual-studio-marketplace` family. Replaced with badges that cannot rot.
  `vsmarketplacebadges.dev` works and was rejected: the Marketplace renders images
  only from an allowlist, so those badges would look right on GitHub and break on
  the listing itself.

### Changed

- Developer guidance moved to `CONTRIBUTING.md`; the README is the Marketplace
  listing.

### Testing

- **GitHub's rendering is checked against GitHub's rendering**, via
  [`starry-night`](https://github.com/wooorm/starry-night) coloured from
  `@primer/primitives`. It found two things the hand-written approximation hid:
  `markup.quote` and `entity.name.tag` are the same colour on github.com, and
  `variable.other` resolves to Primer's own foreground — so six semantic classes
  come out as four colours in light and five in dark.

## [0.5.0]

A GEDCOM file is mostly opaque identifiers and undocumented codes; everything here
removes a reason to leave the line you are reading.

### The graph panel draws the family, not the file

GEDCOM stores a marriage as a `FAM` record everyone points at. Drawn literally,
that put a nameless join between every pair of relatives and made a grandparent
four hops from a grandchild.

- **Families are collapsed** — nodes are people, edges are relationships derived
  by joining through `FAM` and discarding it.
- **Columns are generations, not hop counts**: ancestors left, descendants right.
- **Couples sit together on a marriage bar and every child descends from one point
  on it**, which makes crossings impossible rather than merely fewer.
- **Sibling groups hang beneath their parents, oldest first.** Nothing in the
  ordering consults the current view — that is what stops a column reshuffling
  every time the selection moves. This replaced a barycentre pass, which reads
  well on any one drawing and produces a different drawing every time.

  Over 300 neighbourhoods of `Royal92.ged`: **68% drawn with no crossings, 87%
  with two or fewer, ninetieth percentile three** — against 54% and fourteen.

- Marriages are shown with their year; boxes carry dates (`1901–1975`); a family
  is drawn as itself only when it is the record under the cursor.
- **Ancestors / Descendants / Both** buttons. Sources, notes and media are left
  out unless `gedcom.graph.includeReferences` asks.

### The details panel

- **Selecting a person shows what they contain** — occupation, residence, places,
  notes, citations — composed generically from the registry, so an unanticipated
  tag appears rather than being dropped. Every field jumps to its line.
- **With nothing selected it describes the file**, including a submitter the
  header never points at, as PAF-era files carry.
- **Clicking a box selects rather than navigates**; navigation is its own button.
- `CONT` text is shown whole. `Royal92.ged` records its provenance as a
  twenty-eight line posting and only the first line was reaching the panel.

### Added

- **Inlay hints**: what a pointer names, what a coded value means, and how old the
  subject was, with the verb of the event. Each kind has its own setting.
- **Code lens** above each record, and a dataset summary above `HEAD`.
- **Document links** on `WWW`, `EMAIL` and URL-valued `FILE`.
- **Per-verb hovers**, written against the rule that a hover must answer the
  question the line provokes: the weekday of an exact date, an age cross-checked
  against the recorded dates, jurisdictions from `HEAD.PLAC.FORM`, children
  claimed against children recorded, and a migration note for removed tags.
- **The detected version in the status bar**, flagged when inferred.
- **Payload shapes checked in the grammar**, covering only tags whose shape is
  fixed in every context and both generations.

### Fixed

- **A pointer payload with anything after it was silently accepted.**
  `1 ASSO @I1@ df` parsed as text and was never indexed.
- **Vocabulary diagnostics never said what they judged against.** Every such
  message now names the version, says whether it was declared or inferred, and
  links to the specification.
- **The extension could not load in the web host at all.** The worker host refuses
  ESM, and `"type": "module"` made the browser bundle ESM. Renamed `.cjs`; the
  server stays `.js`, being loaded by URL where the MIME type matters.
- Hovers showed the registry's internal type URIs.

### Changed

- Dependencies at latest, with two enforced exceptions: `@types/vscode` stays at
  `~1.91.0` to match `engines.vscode`, and `serialize-javascript` and `diff` are
  pinned through `overrides`.
- `devEngines.packageManager` takes a range; pinned to one patch version it broke
  `npm ci` with `EBADDEVENGINES`.

## [0.4.0]

### Added

- **Graph panel** following pointers in both directions, with a deterministic
  layout in `packages/core` — a force-directed one settles somewhere different
  every run, which is wrong for a panel that redraws as the cursor moves.
- **Colour preview** (`vp run preview`) through Dark+, Light+ and an
  approximation of PrettyLights.
- **Integration tests** in a real VS Code.

### Fixed

- **The extension could not activate at all**: `"type": "module"` made Node read
  the CommonJS bundle as ESM. No unit test could have caught it — nothing but VS
  Code loads the bundle — and the first integration run found it immediately.
- **The outline was empty**: `Number.MAX_SAFE_INTEGER` as a range end exceeds
  LSP's `uinteger` maximum, so every symbol failed protocol validation.

## [0.3.0]

The first release with runtime code: a language server in whichever host is
active, including the web worker host.

### Added

- **Go to definition**, **find references**, **document highlights**, **rename**
  across every pointer at once, **outline**, **folding by level number**,
  **completion**, **diagnostics** and **semantic tokens**.
- **Hover** resolving a pointer to a summary of the record it names.

### Infrastructure

- Bundled with tsdown into four outputs; the browser server is an IIFE, being
  loaded as a nested worker by URL where imports are unavailable.
- A test asserts `packages/core/src` imports nothing and touches no Node globals.

## [0.2.0]

Adds `packages/core`, the parser every later feature is a projection of. Nothing
user-visible yet.

### Added

- **Version and encoding detection** implementing the
  [official algorithm](https://github.com/FamilySearch/GEDCOM/blob/main/version-detection/version-detection.md)
  over bytes, and **inference** for files with no `GEDC` — not rare, since
  `Royal92.ged` is one.
- **Lexer** with LSP-ready spans, **tree builder** with error recovery that never
  throws, **CONT/CONC folding**, **cross-reference index**, and
  **registry-driven validation** honouring `HEAD.SCHMA`.
- **Embedded specification model** generated from the pinned registry snapshot.

### Notes

- Zero runtime dependencies and no Node builtins, so it runs unchanged in a
  browser worker. The entry point takes bytes, because detection precedes
  decoding.
- Strict for GEDCOM 7, lenient for 5.5.1: two decades of exporters produced files
  that violate the specification in ways every consumer tolerates.

## [0.1.0]

First release of the rewritten grammar; the previous one mis-tokenized every
generation.

### Fixed

- **Tokenizer state no longer escapes a line.** The old `begin`/`end` pairs leaked
  state on 27,671 of the 30,682 lines of `Royal92.ged`, which is why one
  unescaped `@` re-coloured the rest of a file.
- A bare `@` in text is no longer a pointer; extension tags are recognised;
  definitions are distinguished from references; 5.5.1 identifiers may contain
  spaces; scope names follow TextMate convention.

### Added

- `CONT`/`CONC`, dates across every calendar the spec defines, delimited
  surnames, both at-sign conventions, `@VOID@`, CR-only endings and a BOM.

### Changed

- The grammar is **generated** from a pinned registry snapshot rather than
  hand-maintained.

## [0.0.4] and earlier

Initial experiment: basic syntax highlighting for GEDCOM 5.5.1.
