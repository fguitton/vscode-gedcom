# Fixture corpus

Real GEDCOM files used to regression-test the TextMate grammar. Nothing here ships
in the extension — `.vscodeignore` excludes the whole directory.

Do not add TextMate grammar files (`.tmLanguage`, `.tmLanguage.json`) to this
repository, here or anywhere else. GitHub Linguist consumes this repo as a grammar
submodule and scans it for grammar files; a stray one could register scopes that
Linguist never intended to take from this project.

## Provenance

| Path | Source | License |
|------|--------|---------|
| `v5/*.ged`, `v7/*.ged` | [gedcom7code/test-files](https://github.com/gedcom7code/test-files) | Unlicense (public domain) |
| `v5/Royal92.ged` | [github-linguist/linguist](https://github.com/github-linguist/linguist/blob/main/samples/GEDCOM/Royal92.ged) `samples/GEDCOM/` | Linguist sample corpus |

`Royal92.ged` is the file GitHub itself uses as the GEDCOM language sample, which
makes it the single most important regression target: whatever Linguist renders for
GEDCOM on github.com is rendered by this grammar over that file.

## What the interesting fixtures exercise

| File | Why it matters |
|------|----------------|
| `v5/atsign.ged` | Bare, doubled and escape-form at-signs in note payloads. The shape that made the previous grammar treat the rest of the file as one pointer. |
| `v5/xref-case.ged` | Mixed-case xrefs, and xrefs containing **spaces** — legal under 5.5.1's `pointer_string`, illegal under GEDCOM 7's `tagchar`. |
| `v7/enum-ext.ged` | `SCHMA`-documented extension tags, extension records (`0 @3@ _LOC`), surname-first names. |
| `v5/date-all.ged`, `v7/date-all.ged` | Every date form each version admits, including the 5.5.1 `@#DJULIAN@` escape and GEDCOM 7's bare calendar keyword. |
| `char_utf16*.ged`, `char_ascii*.ged` | Byte-order marks and character widths. Decoded by `test/fixtures.ts` following the official version-detection algorithm. |
| `*/age-invalid.ged`, `*/date-dual-invalid.ged` | Deliberately malformed payloads. They must still *lex* cleanly — payload validity is the language server's problem, not the grammar's. |
