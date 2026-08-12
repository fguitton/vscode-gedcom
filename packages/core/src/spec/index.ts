/**
 * Accessors over the generated specification model.
 *
 * Resolving a structure means walking the tree from the root: a tag alone is
 * ambiguous, because `DATE` under `BIRT` and `DATE` under `CHAN` are different
 * structures with different payloads and different substructures. Every lookup
 * here is therefore keyed by the enclosing structure's slug.
 */

import type { GedcomVersion } from '../detect.ts';
import { MODELS } from './model.generated.ts';
import { parseCardinality, type Cardinality, type PayloadSpec, type SpecModel } from './types.ts';

export type { Cardinality, PayloadSpec, SpecModel } from './types.ts';
export { parseCardinality } from './types.ts';

/** Versions the model covers. Others fall back to the nearest modelled one. */
export type ModelledVersion = '7.0' | '5.5.1';

/**
 * Maps a detected version onto the closest modelled vocabulary.
 * 5.5.5 added no tags over 5.5.1, so it shares that model; the differences
 * between them are all in serialization rules, not vocabulary.
 */
export function modelledVersion(version: GedcomVersion | null): ModelledVersion {
  switch (version) {
    case '7.0':
      return '7.0';
    case '5.5.5':
    case '5.5.1':
    case '5.5 EL':
    case '5.5':
    case '5.6':
    case '5.4':
    case '5.3':
    case '5.0':
    case '4.0':
    case '3.0':
    case 'PAF':
      return '5.5.1';
    default:
      // An unidentifiable file falls back to the older, leniently-checked
      // vocabulary. Guessing 7.0 and validating strictly would flood a file we
      // could not even identify with errors — see inferVersion for why such
      // files are common enough to matter.
      return '5.5.1';
  }
}

export function modelFor(version: GedcomVersion | null): SpecModel {
  return MODELS[modelledVersion(version)]!;
}

/** The records permitted at level 0, keyed by tag. */
export function recordsOf(model: SpecModel): Record<string, { s: string; c: string }> {
  return model.subs[''] ?? {};
}

/** Resolves a tag within an enclosing structure, or null if not permitted there. */
export function resolveSubstructure(
  model: SpecModel,
  parentSlug: string | null,
  tag: string,
): { slug: string; cardinality: Cardinality } | null {
  const context = model.subs[parentSlug ?? ''];
  const entry = context?.[tag];
  if (!entry) return null;
  return { slug: entry.s, cardinality: parseCardinality(entry.c) };
}

/** True when the tag appears anywhere in the vocabulary, in any context. */
export function isKnownTag(model: SpecModel, tag: string): boolean {
  return Object.values(model.tags).includes(tag);
}

export function payloadOf(model: SpecModel, slug: string): PayloadSpec | undefined {
  return model.payloads[slug];
}

export function enumValuesOf(model: SpecModel, slug: string): readonly string[] | undefined {
  return model.enums[slug];
}

/**
 * Human-readable name for a structure.
 *
 * Only the 7.x registry carries labels, so a 5.5.1 structure falls back to the
 * 7.x label for a structure of the same slug where one exists — the vocabularies
 * overlap heavily and a shared slug means a shared meaning.
 */
export function labelOf(model: SpecModel, slug: string): string | undefined {
  return model.labels[slug] ?? MODELS['7.0']?.labels[slug];
}

/** Tags allowed directly inside a structure, for completion. */
export function completionsFor(model: SpecModel, parentSlug: string | null): string[] {
  return Object.keys(model.subs[parentSlug ?? ''] ?? {}).sort();
}

export function isExtensionTag(tag: string): boolean {
  return tag.startsWith('_');
}
