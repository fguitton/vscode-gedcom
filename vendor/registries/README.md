# Pinned specification snapshot

The grammar's vocabulary is generated from these files rather than transcribed by
hand, so the tag lists cannot drift from the standard. Regenerate the grammar with
`vp run grammar` after refreshing anything here.

## Contents

| File | Source | Used for |
|------|--------|----------|
| `substructures.tsv` | [familysearch/GEDCOM-registries](https://github.com/familysearch/GEDCOM-registries) `generated_files/` | Authoritative tag list per version. Columns: superstructure URI, **tag**, structure URI. |
| `payloads.tsv` | same | Payload types, including `pointer` targets. Reserved for the language server. |
| `cardinalities.tsv` | same | Occurrence rules. Reserved for the language server. |
| `enumerations.tsv` | same | Enumerated payload values. Reserved for the language server. |
| `g7validation.json` | same | Full GEDCOM 7 structure graph, keyed by URI: substructures with cardinality, payload types, tags, localized labels, enumeration sets, calendars and months. |
| `manifest-5.5.1.tsv`, `manifest-7.0.tsv`, `manifest-7.1.tsv` | same, `manifest/standard/` | Which registry entries belong to which specification version. |
| `version-detection.md` | [FamilySearch/GEDCOM](https://github.com/FamilySearch/GEDCOM/blob/main/version-detection/version-detection.md) | The official version-detection algorithm. |

## Reading the tag list

Take tags from the `tag` column of `substructures.tsv`, never from the URI slug.
Structure URIs are context-qualified, so `ADOP-FAMC` carries the tag `FAMC` and
`DATE-exact` carries `DATE`. Deriving from the slug is wrong for those.

## Version detection is a byte-level pre-pass

`version-detection.md` matters more than it looks. Version detection is **not** a
query against a parsed tree — it runs over raw bytes, before decoding:

1. The first two bytes give character width and byte order, because a GEDCOM stream
   always starts with `0`: `FF FE` or `30 00` means UTF-16LE, `FE FF` or `00 30`
   means UTF-16BE, anything else is single-byte.
2. Scan for `1 GEDC`, then `2 VERS `, then read the next `5 × width` bytes.
3. Longest-match the version table, which covers 7.0, 5.5.5, 5.5.1, 5.5, 5.6, 5.4,
   5.3, 5.0 and 4.x, falling back to 3.0.
4. A file matching `1 SYST` instead is a PAF-era file needing different rules.

So the parser's entry point must take a `Uint8Array`, not a `string` — detection
yields both the version *and* the encoding, and the encoding is needed before any
text exists. Note that the algorithm recognises 5.5.5 explicitly, even though 5.5.5
is a third-party specification rather than a FamilySearch one.

## Note on 5.5.5

GEDCOM 5.5.5 and GEDCOM 7.0 are divergent successors to 5.5.1, not successive
versions, and no migration path is defined between them. 5.5.5 added no new tags
over 5.5.1, so the grammar treats the two identically; the differences are all in
validation, which belongs to the language server.
