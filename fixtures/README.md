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
| `unicode/*.ged` | Authored for this repository | Apache-2.0 |
| `line-endings/*.ged` | Authored for this repository | Apache-2.0 |
| `notes/*.ged`, `style/*.ged` | Authored for this repository | Apache-2.0 |

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
| `char_utf16*.ged`, `char_ascii*.ged` | Byte-order marks and character widths. Decoded by `test/fixtures.ts` following the official version-detection algorithm. Note the `v7/char_utf16*` files are *not* UTF-16: GEDCOM 7 is UTF-8 only, and they discuss UTF-16 in a note payload. |
| `*/age-invalid.ged`, `*/date-dual-invalid.ged` | Deliberately malformed payloads. They must still *lex* cleanly — payload validity is the language server's problem, not the grammar's. |
| `v5/xref-case.ged` | Mixed-case and space-bearing identifiers, including one reference that differs from its definition only in case and so deliberately does **not** resolve. |
| `unicode/names-multiscript.ged` | Names, places and notes across a dozen writing systems, including combining marks and characters outside the basic multilingual plane. |
| `unicode/utf16{le,be}-multiscript.ged` | The same content as UTF-16 with a byte-order mark, in both orders. |
| `unicode/xref-nonlatin.ged` | Cross-reference identifiers outside ASCII. No specification permits these; files in the wild contain them, and losing a record over one is worse than accepting it. |
| `notes/html-5.5.1.ged` | A note holding HTML, split mid-URL by `CONC` — the shape reported in issue #2. Well-formed, unclosed and crossed markup side by side, because no GEDCOM rule inspects any of it. |
| `notes/html-7.0.ged` | The same ground in 7.0, where markup is declared with `MIME` and `CONC` no longer exists. |
| `style/indent-*.ged` | The same tree indented seven ways — spaces at three widths, tabs, and tabs-then-spaces at three tab widths. All seven must parse to one tree. |
| `line-endings/{lf,crlf,cr,mixed}.ged` | The same document under each conformant terminator, plus one mixing all three. See the note below. |

## These files must not be normalised

`.gitattributes` marks `fixtures/**` as `-text`, so git performs no line-ending
conversion on checkin or checkout. That matters more than it looks:

- GEDCOM's terminator production is `EOL = %x0D [%x0A] / %x0A`, so CRLF, lone CR
  and lone LF are all conformant. `line-endings/` contains one file per form
  precisely so the parser is proven to accept each; normalising them to LF would
  leave four identical files testing nothing.
- The UTF-16 fixtures would be corrupted outright by any text conversion.

`git check-attr eol` still reports `lf` for these paths, inherited from the
repository-wide rule. That is misleading — with `text` unset, git converts
nothing. `packages/core/test/line-endings.test.ts` asserts the bytes really do
survive a fresh checkout, so losing the rule fails CI instead of quietly
flattening the corpus.
