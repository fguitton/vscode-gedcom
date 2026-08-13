# vscode-gedcom

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/florianguitton.vscode-gedcom?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/florianguitton.vscode-gedcom)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/florianguitton.vscode-gedcom)](https://marketplace.visualstudio.com/items?itemName=florianguitton.vscode-gedcom)
[![License](https://img.shields.io/github/license/fguitton/vscode-gedcom)](https://github.com/fguitton/vscode-gedcom/blob/master/LICENSE)

GEDCOM language support for Visual Studio Code — syntax highlighting, validation,
navigation and a family graph, for GEDCOM 5.5.1, GEDCOM 5.5.5 and FamilySearch
GEDCOM 7.

This grammar is also the one GitHub uses. The repository is vendored into
[GitHub Linguist](https://github.com/github-linguist/linguist) as
`vendor/grammars/vscode-gedcom`, so it renders every `.ged` file on github.com.

## Features

A GEDCOM file is mostly opaque identifiers and undocumented codes. Everything
here exists to remove a reason to leave the line you are reading.

### Reading a file

- **Inlay hints** put the answer at the end of the line: what a pointer names
  (`1 FAMS @F1@` → `John Smith + Jane Doe`), what a coded value means
  (`1 SEX M` → `male`, `2 QUAY 3` → `primary`), and how old somebody was at an
  event (`died age 73`), computed against their own birth date.
- **Hovers** answer the question the line provokes rather than restating the tag:
  the weekday of an exact date, what an approximate one is claiming, how many
  children a family records against how many it claims, what a place's
  jurisdictions are according to `HEAD.PLAC.FORM`, and — for a removed tag —
  what to write instead.
- **Code lens** above each record: its shape in the tree, a clickable reference
  count, and a link into the graph.
- **A graph panel** drawing the family rather than the file. GEDCOM stores a
  marriage as a `FAM` record that everyone points at; the panel joins those out,
  so nodes are people, columns are generations, couples are joined by a marriage
  bar and their children descend from it. Clicking a box selects that person;
  a button on it goes to their record.
- **A details panel** beside it, carrying what the graph has to discard to stay
  readable: occupations, places, notes, citations. With nothing selected it
  describes the file itself — who submitted it, what wrote it, what is in it.
- **Go to definition, find references, rename** across every pointer at once,
  **outline**, **completion**, and **folding by level number** — GEDCOM lines all
  start at column zero, so indentation-based folding does nothing for them.

### Checking a file

- **Diagnostics** driven by the FamilySearch registry: unknown tags, tags
  misplaced in context, cardinality, enumerated values, pointer targets, dangling
  and duplicate identifiers. Every vocabulary message names the version it judged
  against, says whether that version was declared or guessed, and links to the
  specification.
- **The detected version in the status bar**, flagged when it was inferred rather
  than declared — it governs how every line in the file is read.
- Validation is **strict for GEDCOM 7 and lenient for 5.5.x**, because two
  decades of exporters produced 5.5.1 files that violate the specification in
  ways every consumer tolerates. `gedcom.validation.strictness` overrides it.

### Syntax highlighting

Deliberately version-agnostic: all three generations share one line syntax, and a
lexer cannot know which version a file claims until it has read `HEAD.GEDC.VERS`.
Levels, tags and payloads; cross-reference definitions styled apart from
references; extension tags apart from unrecognised ones; continuations preserving
significant leading whitespace; dates across every calendar the specification
defines; personal names with the surname delimited; and both at-sign escape
conventions.

The grammar also marks a payload whose shape its tag fixes — a pointer-only tag
given something that is not a pointer, an enumeration given a value outside its
set — so a mistake is coloured wrong as it is typed. Anything needing the
structure tree is the language server's job instead, because no regular
expression can answer it.

This extension runs in the desktop editor and unchanged on `vscode.dev` and
`github.dev`, where the language server runs in a web worker.

## Installation

Search for **GEDCOM Language** in the Extensions view, or run:

```
ext install florianguitton.vscode-gedcom
```

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

## Contributing

Bug reports and pull requests are welcome at
[github.com/fguitton/vscode-gedcom](https://github.com/fguitton/vscode-gedcom).
See [CONTRIBUTING.md](https://github.com/fguitton/vscode-gedcom/blob/master/CONTRIBUTING.md)
for how the repository is laid out and how to build and test it.

## License

[Apache-2.0](LICENSE)
