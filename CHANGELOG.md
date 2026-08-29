# Change Log

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.15.1]

### Fixed

- **Web Extension Host Browser Worker Bundling:** Switched to pure `fflate/browser` imports and explicitly inlined compression routines into browser client bundles (`tsdown.config.ts`), eliminating Node `worker_threads` and `createRequire('module')` shims from browser web worker environments.

## [0.15.0]

Full FamilySearch GEDCOM 7.0 Chapter 4 GEDZIP (`.gdz`) format support across all three tiers: in-memory archive reading & webview streaming, virtual `gdz://` FileSystemProvider with automatic repacking, dedicated Custom Editor archive viewer, and Explorer sidebar tree navigation.

### Added

- **Full GEDZIP (`.gdz`) format support (GEDCOM 7.0 Chapter 4 Specification).** Comprehensive cross-platform architecture for opening, exploring, editing, packaging, and unpacking GEDZIP archive packages:
  - **`@vscode-gedcom/core` GDZ Engine:** Fast, zero-dependency, web-worker-safe archive compression, decompression, and inspection powered by `fflate` (`isGdz`, `readGdz`, `packageGdz`, `extractGdz`, `findLocalMediaReferences`, `toDataUrl`, `splitGdzPath`, `joinGdzPath`).
  - **Virtual `FileSystemProvider` (`gdz://`):** Allows opening, browsing, and editing files inside `.gdz` archives. Saving changes to `gedcom.ged` inside an archive automatically repacks the `.gdz` container on disk.
  - **Custom Editor Provider (`GdzCustomEditorProvider`):** Opening any `.gdz` file provides a rich interactive archive inspector with 1-click dataset opening, tree visualization, archive statistics (`INDI` and `FAM` counts), file table, and image gallery previews.
  - **Explorer Sidebar Tree View (`GdzTreeDataProvider`):** Contributed a dedicated `GEDZIP Archives` view in the VS Code Explorer sidebar that automatically scans workspace archives and expands their internal directory and media structure.
  - **Workspace Explorer Mount:** Command `GEDCOM: Mount GEDZIP in Workspace Explorer` (`gedcom.mountGdz`) to mount any `.gdz` container directly as a top-level workspace folder in VS Code.
  - **In-Memory Webview Media Streaming:** Converts in-archive media assets to `data:` URLs for fast, zero-disk thumbnail rendering inside the Details panel and Custom Editor under a strict Content Security Policy.
  - **Packaging & Unpackaging Commands:**
    - `GEDCOM: Package File as GEDZIP (.gdz)` (`gedcom.packageGdz`): Automatically scans and bundles referenced media files with `gedcom.ged`.
    - `GEDCOM: Unpack GEDZIP Archive (.gdz)` (`gedcom.unpackGdz`): Extracts archive datasets and media to any target directory.
    - `GEDCOM: Open GEDZIP Archive` (`gedcom.openGdz`): Opens virtual `gedcom.ged` directly from the archive.
  - **Multi-Format E2E Test Fixtures & Test Suite:** Added `fixtures/archive/mixed-formats.gdz` containing GEDCOM 7, companion GEDCOM X JSON metadata, XML records, images, and documents, verified via `packages/core/test/e2e-gdz.test.ts`.

## [0.14.0]

Full GEDCOM X JSON & XML support, interactive multimedia image previews with local and remote source resolution, unified centralized language helpers, and cross-format navigation parity.

### Added

- **Comprehensive GEDCOM X JSON & XML support.** Full intelligence and interactive tooling for both GEDCOM X JSON (`.json`) and XML (`.xml`) genealogy files:
  - **Code Lenses:** Document summary lenses (individuals count, contributors), per-person _Show in Tree_ quick actions, and cross-reference count indicators.
  - **Unified Hovers:** Rich hover cards for individuals (lifespan, vital birth/death events), source citations, and contributors/agents.
  - **Cross-Record Navigation:** Go to Definition (<kbd>Ctrl+Click</kbd> / <kbd>F12</kbd>) and Find All References (<kbd>Shift+Alt+F12</kbd>) across record pointers and resource links (`resource="#..."`, `descriptionRef="#..."`).
  - **Clean End-of-Line Inlay Hints:** Unified pointer resolution (`HINT_INDENT`), relationship/gender coded values, and computed age at milestones (`Died age 70`, `Married age 25`).
  - **Full Panel Integration:** Interactive Tree Graph, 5-Generation Ancestor Fan Chart, Life Event Timeline, and Details Panel for GEDCOM X datasets.
  - **Non-GEDCOM Protection:** Automatic zero-overhead filtering ensuring non-genealogical JSON/XML files (e.g. `package.json`, `pom.xml`) are never affected.
- **Multimedia image previews for local and remote resources (Issue #8).** Full image preview rendering in the Details panel across all GEDCOM formats:
  - **Remote Web Images:** Secure HTTPS rendering with Content Security Policy (`img-src https:`).
  - **Local Relative & Absolute Paths:** Support for local image paths (`portrait.jpg`, `portrait.png`, `file://` URIs) and local absolute paths on Windows (`C:\...`) and POSIX (`/...`).
  - **Dynamic Security Roots:** Automatically registers media parent directories into `localResourceRoots` so local attachments can be viewed anywhere on disk.
  - **Dedicated Test Corpus & Visual Fixtures:** Installed high-resolution visual portraits (`fixtures/media/portrait.jpg`, `portrait.png`, `sample.jpg`, `sample.png`) and test files (`images.ged`, `images.json`, `images.xml`).

### Fixed

- **GEDCOM X XML source description & media parsing.** Corrected XML parser to extract `mediaType`, `resourceType`, and `about` attributes on `<sourceDescription>` and `descriptionRef` on `<source>`/`<media>` elements.
- **GEDCOM 7.0 multimedia structure compliance.** Nested `FORM` and `TITL` tags at level 2 under `1 FILE` in `0 @xref@ OBJE` records and details extractor to conform with GEDCOM 7.0 specification.
- **Centralized core inlay hint and tooltip helpers.** Extracted shared `inlay.ts` and `tooltip.ts` in `@vscode-gedcom/core` to guarantee 100% visual and functional parity across `.ged`, `.json`, and `.xml` formats.

## [0.13.0]

Comprehensive French internationalization, same-sex union support with gender and plural agreements, personal name underscore normalization, and dynamic graph label collision resolution.

### Added

- **Full French localization & internationalization architecture.** Comprehensive French
  language support across the extension, localized via VS Code L10N bundles and core i18n
  formatters:
  - **Tree view & graph edges:** Localized relationship labels (`Mariés en ...`, `Mariées en ...`,
    `Époux`, `Épouses`, `Père`, `Mère`, `Fils`, `Fille`, `Frère`, `Sœur`, `Fratrie`).
  - **Details panel:** Localized section titles (_Faits_, _Notes_, _Sources_, _Médias_, _Identifiants_,
    _Contenu_, _Auteur_, _Fichier_), record nouns (_Individu_, _Famille_), enums (_Masculin_, _Féminin_),
    and calendar date representations.
  - **Life event timeline:** Localized relative age labels (_Âge 32_) and chronological event titles
    (_Mariage avec ..._, _Naissance de la fille ..._, _Naissance du fils ..._).
  - **Kinship calculator:** Comprehensive French relationship titles (_Père_, _Époux_, _Demi-frère_,
    _Cousin issu de germains_, etc.).
- **Same-sex union support & dedicated test corpus.** Created a comprehensive GEDCOM 7.0
  fixture (`fixtures/v7/same-sex-unions.ged`) and test suite covering female/male same-sex
  marriages with dates, un-dated unions, non-binary partners (`1 SEX X`), blended/reconstituted
  families with half-siblings, and multi-generational fan chart traversal.
- **Tolerated same-sex family cardinality.** Updated structural validation so that `FAM` records
  with two `WIFE` or two `HUSB` tags are emitted as an informational notice (`severity: 'information'`)
  rather than a blocking error, while continuing to strictly reject $> 2$ spouses.

### Fixed

- **Personal name underscore normalization.** Underscores used to bind multi-part names
  in raw GEDCOM files (e.g. `Humphrey /De_Bohun/`, `Henry_IV`) are now automatically stripped
  and converted to clean spaces across Tree node labels, Details panels, Timeline events,
  Fan charts, QuickPick pickers, and editor hovers.
- **Tree graph label & node collision detection.** Added active bounding box collision
  detection and adaptive label positioning for non-adjacent spouse and same-column sibling
  connection edges, preventing marriage label plates from overlapping intermediate person boxes.
- **Directional tree traversal.** Upgraded tree graph traversal to rely on numerical generation
  step indicators (`step < 0` / `step > 0`) rather than language-specific string matching.

## [0.12.1]

Interactive relationship trail deselect button and keyboard shortcut, enriched documentation with feature showcases, and tree controls refinements.

### Added

- **Relationship path deselect button & shortcut.** Added a conditional "Clear Path"
  toolbar button in the Tree view and wired the <kbd>Esc</kbd> key to deselect active
  relationship trails, un-dimming all relatives and restoring the default tree view.
- **Enriched documentation & visual feature showcase.** Added screenshots and guides for
  kinship path highlighting, 5-generation circular ancestor fan charts, life event timelines,
  plausibility diagnostics, and automated quick fixes in the README.

## [0.12.0]

Relationship calculator with kinship path highlighting, 5-generation circular ancestor fan chart view, chronological life event timeline with computed ages, and panel lifecycle synchronization refinements.

### Added

- **Relationship calculator command (`GEDCOM: Find Relationship Between Individuals`).**
  Calculates exact consanguinity (blood) and affinity (marriage/in-law) relationships
  between any two people in the tree, computing cousin degrees, removals, common
  ancestors, niblings, grand-relations, and step-relations with complete path tracking.
- **Interactive kinship path highlighting & dynamic expansion.** **Show Path in Tree**
  dynamically expands tree traversal beyond default depth limits to display the full
  line of descent, highlighting connected relatives and intervening parent-child/spouse
  edges in golden glow while dimming unrelated individuals and auto-framing the path.
- **Circular ancestor fan chart view.** $240^\circ$ radial fan chart in the Tree panel
  rendering up to 5 generations of direct paternal and maternal ancestors with Ahnentafel
  numbering, standalone SVG vector export (`fan-chart-<xref>-<name>.svg`), smooth zoom/pan,
  and wedge path highlighting.
- **Chronological life event timeline.** Interactive vertical timeline in the Details
  panel displaying birth, baptism, residence, census, marriage, occupation, death, and
  burial events alongside computed ages at each milestone, with click-to-reveal navigation.
- **Unconditional panel registration & lifecycle synchronization.** Tree and Details
  views are unconditionally contributed in the dedicated `GEDCOM` view container,
  ensuring they always mount on startup. A bidirectional `ready` handshake eliminates
  webview race conditions when switching between non-GEDCOM and GEDCOM editor tabs.
- **Details panel context & navigation.** Displays contextual document file name when
  focus moves to other editor tabs, with a one-click header jump button to return to
  the file.

## [0.11.0]

Genealogical plausibility diagnostics with automated quick fixes, one-click GEDCOM 5.5.1 to 7.0 modernizer, tree graph SVG export with concrete theme baking, and refined tree panel controls.

### Added

- **Genealogical plausibility & anomaly diagnostics.** Detects chronological and
  biological contradictions: death before birth, implausible parent ages at child
  birth, post-mortem births, marriage outside lifespan, and unrecorded deaths for
  people born $> 120$ years ago.
- **Plausibility quick fixes.** Automated 💡 Quick Fix to swap birth and death dates,
  and to add missing `DEAT` records.
- **Contiguous orphan line batch repair.** Quick Fix detects consecutive lines
  missing level numbers from exporter defects (such as MyHeritage notes) and repairs
  the entire block in a single click.
- **One-click GEDCOM 5.5.1 $\rightarrow$ 7.0 modernizer command.** `GEDCOM: Upgrade File to GEDCOM 7.0`
  migrates versions, removes legacy `CHAR` headers, converts `CONC` to `CONT`,
  rewrites `RELA` to `ROLE`, collects custom `_TAG` extensions to synthesize a valid
  `HEAD.SCHMA` header block, and ensures standard `0 TRLR`.
- **Standalone tree SVG export.** Exports the active tree branch to a self-contained
  SVG vector file with baked theme colors, solid background, and context-aware
  default filenames (`tree-<xref>-<name>.svg`).
- **Refined tree toolbar.** Replaced text buttons with a themed `<select>` dropdown
  for branch traversal (`Both`, `Ancestors`, `Descendants`) and compact icon buttons
  for Zoom-to-Fit (`⛶`), 100% Recenter (`⊙`), and SVG Export (`⤓ SVG`).

## [0.10.0]

Workspace symbol search, snippets, automated quick fixes (Code Actions), document formatting, and multi-spouse layout optimization.

### Added

- **Workspace symbol search (`Ctrl+T` / `Cmd+T`).** Search across individuals by
  name and identifier, couples by partner names, sources by title, and custom
  `@XREF@` entities.
- **Snippets and record skeletons.** Contributed templates for `indi`, `fam`,
  `sour`, `repo`, `birt`, `marr`, `deat`, `buri`, `cens`, `occu`, `resi`, and `note`.
- **Code actions & Quick Fixes (`Ctrl+.` / 💡).** One-click repairs for missing
  headers/trailers, dangling pointers (`@VOID@` / skeleton creation), deprecated
  5.5.1 tags in GEDCOM 7 (`RELA` $\rightarrow$ `ROLE`, `CONC` $\rightarrow$ `CONT`),
  exporter quirks (`exporter-repair` continuation prefixing), leading whitespace,
  and blank lines.
- **Document formatting provider (`Shift+Alt+F`).** Normalizes level spacing,
  standardizes tag casing, removes illegal blank lines, and strips trailing whitespace.

### Changed

- **Multi-spouse compound units in graph layout.** Spouses across multiple marriages
  are kept contiguous in their generation column, reducing line crossings and
  improving visual flow without sacrificing stability.

## [0.9.2]

Details panel webview event isolation, disposal lifecycle fixes, and language server performance optimizations.

### Fixed

- **The Details panel cleared itself unexpectedly on vscode.dev.** The webview's
  message listener now specifically filters for internal empty events rather
  than clearing on unrelated host window `postMessage` traffic.
- **The Details webview provider retained stale references upon disposal.** The
  provider resets its internal view and last-shown state when disposed so it
  does not retain unmounted webviews.

### Performance

- **Semantic token computation avoided redundant full document line splits.**
  Document lines are pre-split once per tokenization run rather than repeatedly
  splitting the full text inside nested continuation line loops.
- **Code Lens resolution uses binary search.** Resolving visible lenses now
  locates records by line number in logarithmic time instead of scanning every
  record in the document.
- **Date year extraction streamlined.** `yearOf` extracts years in a single
  linear regex scan without backtracking lookahead.

## [0.9.1]

Files that are not GEDCOM at all, and panels that stay up while you look at
something else.

### Fixed

- **A file whose leading numbers are not levels took the whole analysis down.**
  Nesting is capped at 64 deep, past which the file is read at that depth and
  told so once: the tree is walked recursively everywhere, and 6,000 levels
  overflowed the stack — no diagnostics, no outline, and an empty panel.
- **The panels emptied themselves whenever the editor area went off screen**,
  which is what maximising them does. They hold the record until its file closes.
- A failure while drawing the tree is caught, logged and shown in the panel
  instead of leaving whatever was there and saying nothing.
- One request cannot take the server down with it, or take a feature down for
  every other file: each is answered or reported, and every document read is
  logged.
- The document is analysed once per version rather than once per panel — four
  passes over the file on every cursor move, a quarter of a second each on
  `Royal92.ged`.

### Changed

- `level` on a structure is where it sits in the tree rather than the number the
  line declared, which differ when a line is recovered or capped.

## [0.9.0]

Files as real programs write them: what the exporter got wrong, said in the
exporter's name, and what a reader can no longer see through it.

### Added

- Exporter profiles. The program named in `HEAD.SOUR` selects a table of known
  quirks; MyHeritage's literal line breaks inside payloads are read as the
  continuations it meant, each reported as an information diagnostic. Never
  silent, and never applied to a line that could itself be a GEDCOM line.
- The `HEAD` hover names the program that wrote the file and lists what it is
  known to get wrong, with a link to where each was reported.
- Continuations an exporter wrote without a level number are indented with the
  payload they continue, and coloured as payload rather than as an illegal line.
  The grammar can do neither: it sees one line at a time.
- The Text / HTML switch reaches citation transcriptions as well as notes, and
  markup that arrived escaped is decoded exactly as many times as it was encoded
  — MyHeritage escapes its citation text twice — before going through the same
  allowlist as any other markup.
- Dates in the Hebrew, Julian, French Republican and Thai calendars are converted
  to Gregorian beside the original: `15 Tishrei 5760 (Hebrew · 25 September 1999)`.
- French Republican years come from a vendored table of observed equinoxes at
  Paris rather than an arithmetic rule, which disagrees with it during the
  calendar's own lifetime — An XII began on 24 September 1803, not the 23rd.
- Thai Buddhist Era dates, written `@#DTHAI@`, which no GEDCOM version defines.
- **GEDCOM: Copy Diagnostics** puts the version, host, settings and recent
  activity on the clipboard, ready to paste into an issue. It carries nothing
  from the file — no names, no dates, not even the folder it sits in.
- **GEDCOM: Show Log** opens the extension's own commentary: activation, the
  context key, every Show Tree and what came of it. The language server writes to
  the same channel, so one place holds both sides.
- `fixtures/exporter/wikitree.ged`, which splits a multibyte character across a
  `CONC` boundary as WikiTree does.

### Changed

- A deviation a known exporter is responsible for is downgraded from error and
  says whose doing it is. Nothing is suppressed.
- Both exporter messages name the program they are about.
- The outline and the breadcrumb name a record after who or what it is and a
  substructure in English — `Denis R. Reid › Phone`, not `SUBM @S1@ › PHON`. The
  tag and the identifier move to the detail.
- An event asserted with a bare Y and nothing else reads "recorded, without a
  date" rather than showing the letter.

### Fixed

- 5.5.1 structures are named in English. The registry snapshot carries labels for
  GEDCOM 7 only, so every 5.5.1 tag was shown as a tag; 179 names are now borrowed
  from 7.0 where both versions agree, and the rest come from the table here.
- Coded values are checked in 5.5.1 files, which they never were: the registry
  snapshot carries enumerations for GEDCOM 7 only, so `2 QUAY 4` passed silently
  in most files in the wild.
- A citation URL is no longer truncated, which turned it into a link that went
  nowhere. Long media and page URLs are kept whole.
- Source citations show their confidence, the event they cite, and the
  transcription under `DATA.TEXT` — all of which were dropped.
- Escaped markup is read by whichever depth yields the most markup, so a payload
  carrying both plain and doubly-escaped tags renders both.
- **The tree emptied itself when the reader clicked anywhere else.** It follows
  the GEDCOM file on screen, and clears only when none is in view.
- Show Tree says so when the panel cannot be shown, and puts a hidden view back
  where it belongs rather than resolving silently ([#5]).
- Show Tree leaves the panel alone when it declines to open, and the tree redraws
  when `gedcom.graph.depth` or `gedcom.graph.includeReferences` changes.
- `gedcom.trace.server` produced nothing to look at on its own: the channel drops
  trace unless its log level is raised too. It now says so, once, in the log.

### Testing

- `CONT` and `CONC` interleaved within one payload, which nothing covered: a
  `CONC` continuing the empty line a `CONT` opened, and the trailing space that
  joins two words when kept and merges them when trimmed.
- The panel acknowledges each drawing, so a test can tell what it put on screen
  from what it was sent. Settings are asserted against the running editor.

## [0.8.1]

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
