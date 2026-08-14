# Change Log

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **A note holding markup can be rendered instead of read as characters** ([#2]).
  Notes with HTML in them get a Text / HTML switch; the choice applies to the
  whole panel and lasts the session, and `gedcom.details.noteFormat` decides
  where the session starts. It defaults to `text`, because what the file contains
  is the honest default.

  The switch appears only where there is markup to render — declared by `MIME` in
  7.0, recognised by a tag in 5.5.1, and never on `5 < 7`, which is arithmetic.

  Rendering copies the parsed tree through a fixed allowlist of formatting tags
  rather than stripping what looks dangerous: the copy is built by tag name, so
  the only attribute that exists on it anywhere is `href`, and only on `http(s)`.
  `script`, `style`, `iframe`, `object`, `form` and `svg` are dropped with their
  contents. A GEDCOM file is untrusted input, and the panel's content security
  policy — no script without a nonce, no remote loads — is the second line, not
  the first.

### Fixed

- **An inline note was reported as a broken pointer** ([#2]). GEDCOM 5.5.1 defines
  `NOTE`, `SOUR`, `OBJE` and `REPO` twice over — once pointing at a record, once
  carrying the content in place — and the registry we generate from models only
  the pointer form. So `1 NOTE He was an accountant` was called malformed, which
  is what most exporters actually write: MyHeritage, Ancestry and PAF files are
  full of inline notes. Found by building the fixture for [#2].

- **The toolbar button did not open the panel** ([#5]). A menu never invokes a
  command bare: the editor title bar passes the editor's resource and then its
  own `{groupId, editorIndex}` context, while the code lens passes a URI string
  and a line number. Read as the latter, the menu's context sent an object where
  a line number belonged, and the editor was revealed at a nonsense position —
  the scrolling the reporter saw. Revealing can also no longer take the panel
  down with it.

### Changed

- **Records are counted in English.** The lens above the header read
  `3,010 INDI · 1,422 FAM · 1 SUBM`, which is the file talking to itself; it now
  reads `3,010 individuals · 1,422 families · 1 submitter`. The same wording is
  used by the header hover and the details panel's contents, all three from one
  table, and the label agrees in number with the count beside it. A record kind
  nobody anticipated still shows its tag rather than an invented plural.

- **"Show Graph" is now "Show Tree", and the code lens says "see in the tree".**
  The panel is called Tree. It draws a family, and genealogy has a word for that.
  Setting keys and command identifiers are unchanged, so nothing anybody has
  configured or bound a key to breaks.

### Testing

- The integration tests assert that the panel **opens** and that it **follows the
  cursor**, rather than only that a command did not throw. A command that quietly
  opens nothing throws nothing either, which is how [#5] shipped — the first
  version of these tests passed against the broken code, because an earlier test
  had already opened the panel and left it open.
- The integration run now **fails on an unhandled rejection or uncaught
  exception** anywhere in the extension host. The tests share a process with the
  extension, so a promise we drop surfaces there; nothing was watching before, and
  a dropped promise means a feature quietly does nothing with no trace but a line
  in a log nobody has open.
- The same suite now also runs against **Insiders** — `vp run test:vscode:insiders`
  locally, an _Extension (desktop, Insiders)_ launch configuration for F5, and an
  advisory CI job. [#5] came from Insiders on Linux, which was the one combination
  nothing here had ever run against.

- Two `fixtures/notes/` files for markup inside notes: the 5.5.1 shape reported in
  [#2], where HTML is split mid-URL across `CONC` lines, and the 7.0 equivalent,
  where markup is declared with `MIME` and `CONC` no longer exists. Both carry
  well-formed, unclosed and crossed markup side by side, since no rule in either
  specification inspects any of it.

[#2]: https://github.com/fguitton/vscode-gedcom/issues/2
[#5]: https://github.com/fguitton/vscode-gedcom/issues/5

## [0.6.0]

Two themes. A GEDCOM file is allowed to indent itself, and files in the wild do —
so those are now read, highlighted and folded like any other, whatever they indent
with. And the panels stop showing the reader the file's own shorthand: slashes
around a surname, `F` for a sex, a URL that cannot be clicked, a hover that
answers "Text."

### Added

- **Indented files are read as first-class.** The specification puts the level
  number first on the line with nothing before it, but plenty of exporters
  indent anyway to show the hierarchy, and such a file is now lexed,
  highlighted, folded and validated exactly as a flat one is. `detectIndentation`
  reports the habit — spaces, tabs or both, the width per level, and any line
  that departs from it.

  A tab's width is the only thing a file cannot state. Where tabs and spaces are
  mixed it is solved by search over the widths anything has ever defaulted to,
  because the direct calculation needs a space-only line at the same level to
  measure against and a file whose first levels are tabs never provides one.

- Seven `fixtures/style/` files carrying the same family tree at one, two and
  four spaces per level, at tabs, and at tabs-then-spaces with the tab standing
  for two, four and eight columns. A test asserts all seven parse to the _same_
  tree, which is the load-bearing claim: the level number states the hierarchy
  and the whitespace states nothing.

- **A sentence about what each tag is for, in hovers.** The registry we vendor is
  a machine's view of the format — tags, payload types, cardinalities, labels —
  and carries no prose, so a hover over `OCCU` answered with "Text.", which the
  reader could see for themselves.
  Roughly ninety structures now carry a written gloss, and the payload line is
  dropped where the gloss has already said what belongs there. Across the fixture
  corpus this takes the hovers that said nothing from several hundred to none.

- **Links and image previews in the details panel.** A URL anywhere in a field —
  a media object's `FILE`, a `WWW`, an address written into a note — is now a
  link that opens in the browser, and media the file identifies as a picture is
  shown as a thumbnail beneath its row.

  `http` and `https` only. A `FILE` payload is free text from a document the
  reader may merely have been sent, and `javascript:`, `file:` and `vscode:` URIs
  would otherwise be handed to the machine by a click; the scheme is checked in
  the extension host rather than trusted from the panel.

  Previews are on by default and `gedcom.details.imagePreviews` turns them off.
  Off rewrites the panel's content security policy rather than merely suppressing
  the `<img>`, so the panel is then unable to make a request rather than
  disinclined to — the point of the setting is that a photograph hosted by a
  genealogy site does not get to learn that the file is being read, and from
  where. Even on, only `https` is permitted.

### Fixed

- **A media object written inline was reported as a broken pointer.** GEDCOM
  5.5.1 lets `OBJE`, among others, be written either as a pointer or with the
  record's substructures in place of the payload, and the second form is common
  in real files. Only the payload-less form is exempt: `1 ASSO @I1@ df` is still
  wrong however many substructures follow it.

- **A date's time of day was dropped from the details panel.** `TIME` hangs under
  `DATE` rather than beside it, in 5.5.1 and 7.0 alike, and the panel read only
  the date — so a change record, whose entire purpose is to say when, showed
  `14 FEB 1998` and threw away `09:22:41`. The parse tree was right throughout;
  only the reading of it was wrong.

### Changed

- **A name is read rather than copied.** The slashes in `/Family/ Personal` are
  how GEDCOM marks the surname, not punctuation, and the details panel was
  printing them. It now shows the name without them, in the order the file wrote
  — that order is itself information, since the format exists to carry names from
  cultures that write the surname first — and lists the parts beneath, from the
  `GIVN` and `SURN` substructures where the file states them and from its own
  reading of the string where it does not.

  Where a person holds several names, the `TYPE` beneath each becomes its label,
  so two rows are no longer both called "Name".

- **A structure carrying nothing says so.** `1 _MAYBE` with no payload and nothing
  beneath it used to render as "recorded", a word the file never said. It is now
  marked as having no value, in italic and dimmed, so that a tag someone wrote and
  left blank is visible as exactly that.

- **Coded values are shown in English.** The details panel expands an enumerated
  payload to its meaning — `Sex: Female`, not `Sex: F` — for every enumeration
  the extension models, not only `SEX`. Inlay hints capitalise the same labels,
  since a hint is a caption beside the line rather than a clause continuing it.

- The details panel names a media object by its own title rather than by its tag,
  and says what kind of file it is — read from the `FORM` where the file writes
  one and from the path's extension where it does not. A residence with an
  address but no place now shows the address instead of the word "recorded".

## [0.5.2]

Tooling and documentation only — nothing in the extension itself changed.

`0.5.1` was tagged and never shipped: the manifest was left at `0.5.0`, so the
release workflow's version guard refused it, which is precisely what that guard
is for.

### Fixed

- **The release workflow could not be re-run.** It skips the Marketplace when
  `VSCE_PAT` is absent and tells you to add the secret and run it again — but
  `gh release create` fails outright once the release exists, so the advice was
  impossible to follow. An existing release is now updated in place.
- `dist/preview/` no longer ships in the VSIX. It only exists once somebody has
  run `vp run preview`, so the extension gained 40 kB of developer artifact on
  some machines and not others.
- **The README badges were dead.** shields.io has retired its entire
  `visual-studio-marketplace` family — version, installs, downloads and rating
  all answer "retired badge". They are replaced by a static Marketplace link
  plus release, build and licence, none of which can rot.

  The obvious substitute, `vsmarketplacebadges.dev`, works and was rejected: the
  Marketplace renders images only from an allowlist of hosts, so those badges
  would have looked right on GitHub and broken on the listing itself. Losing
  version, installs and rating costs nothing there, since the Marketplace page
  already shows all three.

### Changed

- Developer guidance moved from `README.md` to `CONTRIBUTING.md`. The README is
  the Marketplace listing, so build instructions and package layout were being
  shown to every prospective user.

### Testing

- **GitHub's rendering is now checked against GitHub's rendering.** The Primer
  panel in `vp run preview` was a palette written from memory, which made the
  central claim of the colour design — that the semantic classes stay distinct
  where the palette is narrowest — one nobody could verify. It now runs the
  committed grammar through [`starry-night`](https://github.com/wooorm/starry-night),
  the open reimplementation of GitHub's highlighter, coloured from the tokens
  `@primer/primitives` publishes.

  It found two things the approximation was hiding. `markup.quote` and
  `entity.name.tag` both resolve to `pl-ent`, so **a citation and a name are the
  same colour on github.com**; and `variable.other` resolves to `pl-smi`, whose
  colour is Primer's own foreground, so **linkage tags are indistinguishable
  from ordinary text there**. Six semantic classes come out as four colours in
  light and five in dark, not six. All of it is recorded in
  `packages/grammar/test/prettylights.test.ts` rather than assumed away.

  It also confirms the new payload-shape rules arrive as `pl-ii`, the class
  GitHub paints as invalid, rather than as ordinary text.

## [0.5.0]

The theme of this release is that a GEDCOM file is mostly opaque identifiers and
undocumented codes, and every feature below removes a reason to leave the line
you are reading.

### The graph panel now draws the family, not the file

GEDCOM stores a marriage as a `FAM` record that both spouses and every child
point at. Drawn literally that put a nameless join record between every pair of
relatives, made a grandparent four hops from a grandchild, and filled the third
column with boxes that answered no question anyone had asked.

- **Families are collapsed.** Nodes are people; edges are the relationships
  between them, derived by joining through the `FAM` records and then discarding
  them. A spouse and a child are now one hop away, not two.
- **Columns are generations, not hop counts.** Laid out by hops, a sibling and a
  grandparent shared a column because both are two steps from the focus — two
  generations side by side, saying something false about the family. Ancestors
  now run left of the focus and descendants right, the direction a family tree
  is read in.
- **Couples sit together, joined by a marriage bar, and every child descends
  from one point on it.** Two parents fanning independently to four children
  makes crossings unavoidable; one line per child from the marriage makes them
  impossible.
- **Sibling groups hang beneath their parents, and siblings run oldest first
  within the group.** Nothing in the ordering consults the current view, which
  is what stops a column rearranging itself every time the selection moves —
  a reader clicking along a row of relatives was watching the row reshuffle
  under them.

  This replaced a barycentre pass that ordered each column against its
  neighbours. That reads well on any one drawing and produces a different
  drawing every time, because the arrangement is computed from whoever happens
  to be on screen. Ordering by birth alone held still but tangled. Neither trade
  was necessary: hanging each family beneath its parents makes the two columns
  agree by construction rather than by search.

  Measured over 300 neighbourhoods of Linguist's `Royal92.ged`: **68% are drawn
  with no crossings at all, 87% with two or fewer, and the ninetieth percentile
  is three** — against 54%, and a ninetieth percentile of fourteen, before any
  of this. Tests hold both the crossing figures and the stability ones.

- **Marriages are shown**, labelled with their year, alongside parent and child
  links. Siblings are drawn only where a family records no parents, since
  otherwise they are already two hops apart through one.
- **Boxes carry dates** — `1901–1975`, or `b. 1930` where only one is known.
  A tree full of people sharing a name is unreadable without them. Where the
  file records none the box shows the name alone: "Individual" under every name
  is a label with no information in it, and a row of them reads as though
  something failed to load.
- **A family is still shown as itself when it is the record under the cursor**,
  with its members around it and their roles named. Collapsing is right for
  families travelled _through_ and wrong for the one being looked at.
- **Ancestors / Descendants / Both** buttons, because tracing a line back is a
  different task from following it forward, and each is half the graph.
- Sources, notes and media are left out unless `gedcom.graph.includeReferences`
  asks for them: a well-sourced person cites dozens, and they crowd out the
  family the panel exists to show.
- **A family is never drawn as a box**, not even when it is the record under the
  cursor. It is a join, not a person: no name, no dates, nothing to say that its
  members do not say better. Putting the cursor in one shows that family — the
  couple and their children — and highlights all of them.
- Edges run left to right whichever way the pointer is written, and labels are
  placed with a backing plate, nudged apart where two would collide. The gutter
  between columns was widened so a label such as `Married 1874` fits in it, and
  labels are drawn **after** the boxes: painted before them, a marriage year
  ended up half hidden behind the spouse below it.
- Relationships that cross no generation — siblings, citations, and a couple —
  are routed down the side of their column. Drawn as a left-to-right curve such
  an edge doubled back on itself and dropped its label behind a box.

### The details panel

A second view in the same **GEDCOM** panel, for everything the graph has to
discard in order to stay readable.

- **Selecting a person shows what they actually contain**: occupation,
  residence, the place they were born, notes, citations, identifiers — composed
  generically from the registry, so a tag nobody anticipated appears rather than
  being dropped silently. Every field jumps to its line when clicked.
- **With nothing selected it describes the file**: the program that wrote it,
  the character set, the counts, and the submitter with their address and notes.
  None of that is a person or a family, and drawn into the graph the submitter
  became a box with no generation and no relationships. An unreferenced `SUBM`
  is found too — PAF-era files carry one that the header never points at, and
  Linguist's own `Royal92.ged` is one of them.
- **Clicking a box in the graph now selects rather than navigates.** Reading down
  a line of descent means looking at a dozen people in turn, and jumping the
  editor to each one loses the reader's place in the file for no benefit.
  Navigation is its own gesture, on a button that appears on the box.
- Text written across `CONT` lines is shown whole — monospace, wrapped, in a
  block of its own — whether the record is reached as the file's submitter or
  selected in its own right. `Royal92.ged` records the file's provenance as a
  twenty-eight line posting from 1992, and only its first line was reaching the
  panel; its three-line address fared no better. The parser's reassembly was
  never at fault, and a test now proves it: this layer was discarding the rest.
- A short list of **vendor tags** the registry has never covered are named in
  English — `COMM` is PAF's comment field, and it is what carries that
  provenance note. The list stays short deliberately: a confidently wrong label
  is worse than a bare tag.
- A record that is neither a person nor a family no longer appears in the graph
  as a lone box with no generation and no relationships. The panel says where to
  find its contents instead.
- The graph scrolls the selection into view when the neighbourhood is larger
  than the panel, on whichever axis actually overflows.
- Children descend from the parent whose line is being traced rather than from
  the midpoint between the couple. The midpoint is nobody — it floats in the gap
  between two boxes, and a reader following a descent cannot tell which of the
  two it belongs to.

### Added

- **Inlay hints**, off the back of that: what each pointer names
  (`1 FAMS @F1@` → `John Smith + Jane Doe`), what each coded value means
  (`1 SEX M` → `male`, `2 QUAY 3` → `primary`), a language tag's language, and how
  old the subject was at an event, computed against their own `BIRT` date. Each
  kind has its own setting, because the resolved names are indispensable in an
  unfamiliar file and noise in your own. An age carries the verb of its event —
  `died age 73`, `married age 24` — and every hint is set apart from the payload
  so it does not read as though the file itself said `1 SEX M male`.
- **Code lens** above each record: its shape in the tree, a clickable reference
  count that peeks every pointer to it, and a link into the graph panel. Above
  `HEAD`, the dataset summary the header does not carry — record counts and the
  span of years the file covers.
- **Document links** on `WWW`, `EMAIL` and URL-valued `FILE` payloads.
- **Per-verb hovers.** The rule they are written against is that a hover must
  answer the question the line provokes rather than restate the tag:
  - `DATE` — the weekday for an exact date, what a qualified date is claiming,
    and how old the subject was; under `CHAN` or `CREA`, how long ago instead,
    because whether a record is maintained is the actual question there.
  - `AGE` — the notation in words, **cross-checked against the recorded dates**.
    An age that disagrees with the file's own birth and event dates is flagged.
    Nothing else in the format checks the two against each other.
  - `PLAC` — the jurisdictions labelled from `HEAD.PLAC.FORM`, which almost no
    tool surfaces, plus coordinates from a `MAP` and a link to a map service.
  - `NAME` — split into given name, surname and suffix on the slashes, with a
    note when no surname is marked.
  - `NCHI` — how many children are claimed against how many are recorded, which
    is the research question rather than a restatement.
  - Enumerated payloads across `QUAY`, `PEDI`, `RESN`, `SEX`, `FAMC.STAT`,
    `NAME.TYPE`, `MEDI`, `ROLE`, `FAMC.ADOP` and the LDS ordinance statuses. When
    a value is outside its set, the alternatives are listed.
  - `LANG` resolved through BCP 47, `FORM` through media types in both the modern
    and 5.5.1 spellings, and the identifier families (`REFN`, `UID`, `EXID`,
    `RIN`, `AFN`, `RFN`) distinguished from each other.
  - A **migration note** on any tag the file's version removed, carrying the
    replacement — `ROMN` says to use `TRAN`.
- Cardinality stated in words: "Required, exactly one" rather than `{1:1}`.
- **The detected version, in the status bar.** It governs how every line in the
  file is read and is frequently _guessed_ rather than declared, so a reader who
  disagrees with the guess needs to see it before anything else makes sense. An
  inferred version is flagged with the warning background; the tooltip explains
  how it was arrived at and what the file contains.
- **Payload shapes checked in the grammar**, so a wrong value is coloured as
  wrong while it is being typed rather than only appearing as a squiggle:
  - a pointer-only tag given anything but a pointer (`1 ASSO @I1@ df`),
  - `SEX`, `QUAY`, `PEDI` and `RESN` given a value outside their set,
  - `NCHI`, `NMR` and the other counts given something that is not a number,
  - `AGE` and `TIME` given something that does not fit their notation.

  Each rule covers only tags whose payload shape is fixed in _every_ context and
  in both generations, and extension values are always let through. `SOUR` is a
  pointer under `INDI` and free text under `HEAD`, so it is not checked; `MEDI`
  is not, because 5.5.1 wrote its values in lower case and 7.0 in upper. A scan
  of the whole fixture corpus finds no line these rules fire on.

- **English names everywhere a tag was shown raw**: hover titles lead with the
  name and keep the tag alongside, pointer targets read "Points at an
  **Individual** record", completion details carry the name, and misplacement
  diagnostics name both structures. Twelve 5.5.1-era tags the registry labels
  nowhere are named here.

### Fixed

- **A pointer payload with anything after it was silently accepted.**
  `1 ASSO @I1@ df` parsed as text, was never indexed as a reference, and drew no
  diagnostic — the payload simply stopped being a pointer and nothing said so.
  Every structure the registry types as a pointer now requires its payload to be
  exactly `@xref@`, at every strictness, because it is wrong under any reading of
  any version.
- **Vocabulary diagnostics never said what they were judging against.** "Not a
  tag in this version of GEDCOM" asked the reader to take on trust both which
  version that was and how it had been decided — and when the answer is "we
  guessed from the tags in use", that is exactly what they need to know, because
  the right fix may be to correct the header rather than the line. Every such
  message now names the version, says whether it was declared, inferred or
  defaulted, and links to the specification.
- Hovers on `CHAN` copied the date from two lines below instead of qualifying it.
  Events read as sentences now, and maintenance dates say how long ago.
- **The extension could not load in the web extension host at all** — the same
  class of failure as 0.4.0's, in the other host, and found the same way: by
  writing the test that could see it. The worker host decides a module's kind
  with

  ```js
  path.endsWith('.mjs') || (extension.type === 'module' && !path.endsWith('.cjs'));
  ```

  and then refuses ESM outright, because it supports none. This repository is
  `"type": "module"`, so `dist/browser/extension.js` was read as ESM and threw
  before activation. The browser entry is now `.cjs`, matching the Node one. The
  server bundle stays `.js`: it is passed to `new Worker()` by URL, and a worker
  script must be served with a JavaScript MIME type.

- **Hovers showed the registry's internal type URIs.** A structure taking plain
  text was described as `XMLSchema#string` and a date as `type-DATE_VALUE`. Every
  payload type is now given as a description with an example where one helps, and
  a test iterates the whole registry so a newly-added type cannot slip through
  undescribed.
- `relativeTime` counted two calendar years spanning a leap year as one, because
  730 days divided by a mean year length floors to 1. It now counts calendar
  years and months.
- The age on an event hover named the event by its tag rather than its label,
  reading `CENS at 9 years old`. The label is keyed by the registry slug, and the
  slug for `CENS` inside an `INDI` is `INDI-CENS`.

### Testing

- **Integration tests in the web extension host**, headless via
  `@vscode/test-web` (`vp run test:web`), covering activation in the worker, the
  language server answering from a nested worker, and the graph panel resolving
  under the browser content security policy. This closes the last host that
  shipped without automated coverage — and found the activation bug above on its
  first run.
- Tests for every new module, including one that walks the whole registry and
  fails if any payload type reaches a reader undescribed, and one that scans the
  entire fixture corpus for a line the new grammar rules wrongly reject.
- The web harness pins `--quality=stable`. `@vscode/test-web` otherwise fetches
  whichever Insiders build is newest that day, so the same commit passes or fails
  depending on when it runs — and a broken Insiders build hangs before invoking
  any test module, printing nothing at all. Each web test is also raced against
  a clock, because a runner that hangs silently is the worst failure mode there
  is: it looks exactly like an environment problem and names no line.

### Changed

- **Dependencies.** Every package is at its latest published version, with two
  deliberate exceptions, both now enforced by tests rather than left to memory:
  - `@types/vscode` stays at `~1.91.0`, matching `engines.vscode`. It decides
    which APIs the compiler believes exist, so raising it alone would compile
    calls to APIs missing from the oldest editor the extension claims to run on
    — a failure that lands on a user at runtime. The published types are twenty
    releases ahead; nothing here needs them.
  - `serialize-javascript` and `diff` are pinned through `overrides` to versions
    the advisories are fixed in. Both reach the repository only through
    `@vscode/test-cli` → `mocha`, neither ships in the extension, and neither
    could be fixed by an upgrade — which is why the security job failed on every
    run. `npm audit` is now clean. Both replacements were checked against the
    code that uses them, including mocha's failure-diff rendering, which a green
    suite never exercises.
- `devEngines.packageManager` takes a range (`>=11`) and warns rather than
  failing. It pinned npm to one exact patch version, which no CI runner happens
  to have, so `npm ci` aborted with `EBADDEVENGINES` before doing anything. The
  real requirement was always "a modern npm".
- `vp run build` is the build task. It was `bundle`, which nobody guesses.
- <kbd>F5</kbd> now runs it first. The extension host loads the bundles in
  `dist/`, so launching without a rebuild looked exactly like a code change
  having had no effect.

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
