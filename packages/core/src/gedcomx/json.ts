/**
 * GEDCOM X JSON serialization and deserialization.
 */

import type { Gedcomx, Person, Relationship } from './types.ts';

/**
 * Parses a GEDCOM X JSON string into a structured Gedcomx document.
 * Tolerates root object being a single Person or Relationship by normalizing to Gedcomx.
 */
export function parseGedcomXJson(text: string): Gedcomx {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON: root must be an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Check if root is already a Gedcomx document
  if (
    'persons' in obj ||
    'relationships' in obj ||
    'sourceDescriptions' in obj ||
    'attribution' in obj
  ) {
    return obj as unknown as Gedcomx;
  }

  // If root is a single Person
  if ('gender' in obj || 'names' in obj || 'facts' in obj) {
    return {
      persons: [obj as unknown as Person],
    };
  }

  // If root is a single Relationship
  if ('person1' in obj && 'person2' in obj) {
    return {
      relationships: [obj as unknown as Relationship],
    };
  }

  return obj as unknown as Gedcomx;
}

/**
 * Serializes a Gedcomx document to a standard JSON string.
 */
export function toGedcomXJson(gedcomx: Gedcomx, pretty = true): string {
  return JSON.stringify(gedcomx, null, pretty ? 2 : undefined);
}
