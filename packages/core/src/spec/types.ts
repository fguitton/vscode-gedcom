/**
 * Shape of the generated specification model.
 *
 * Keys are registry slugs — a structure URI with its version prefix removed, so
 * `https://gedcom.io/terms/v7/record-INDI` becomes `record-INDI`. A slug is not
 * a tag: structures are context-qualified, so `ADOP-FAMC` is the slug of the
 * `FAMC` structure that appears under `ADOP`.
 */

export interface PayloadSpec {
  /** Payload data type, or `pointer`. */
  readonly type: string;
  /** For pointers, the slug of the record type the pointer must target. */
  readonly to?: string;
}

export interface SubstructureSpec {
  /** Slug of the substructure. */
  readonly s: string;
  /** Cardinality in the spec's `{min:max}` notation, e.g. `{0:M}`. */
  readonly c: string;
}

export interface SpecModel {
  /** Slug to the tag it is written with. */
  readonly tags: Record<string, string>;
  /**
   * Superstructure slug to the substructures allowed inside it, keyed by tag.
   * The empty-string key holds the records permitted at level 0.
   */
  readonly subs: Record<string, Record<string, SubstructureSpec>>;
  readonly payloads: Record<string, PayloadSpec>;
  /** Human-readable names, for hovers. */
  readonly labels: Record<string, string>;
  /** Slug to the enumerated values its payload admits. */
  readonly enums: Record<string, readonly string[]>;
  readonly calendars: Record<
    string,
    { readonly months: readonly string[]; readonly epochs: readonly string[] }
  >;
}

export interface Cardinality {
  readonly min: number;
  /** `Infinity` for the spec's `M`. */
  readonly max: number;
}

export function parseCardinality(text: string): Cardinality {
  const match = /^\{(\d+):(\d+|M)\}$/.exec(text);
  if (!match) return { min: 0, max: Infinity };
  return {
    min: Number(match[1]),
    max: match[2] === 'M' ? Infinity : Number(match[2]),
  };
}
