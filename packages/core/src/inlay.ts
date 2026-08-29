/**
 * Shared Inlay Hint generators and formatters across all file formats (.ged, JSON, XML).
 */

import type { Structure } from './cst.ts';
import type { Analysis } from './index.ts';
import { formatAgeAtEvent } from './age.ts';
import { lifespan } from './relations.ts';
import { summarizeRecord } from './summary.ts';

/** Non-breaking 3-space indent used to set apart inlay hints from line payload. */
export const HINT_INDENT = '\u00A0\u00A0\u00A0';

/**
 * Normalizes and formats coded values (such as gender and relationship types)
 * across GEDCOM tags, GEDCOM X URIs, and string enumerations.
 */
export function formatValueHint(valueOrUri: string): string | undefined {
  const clean = valueOrUri.trim();
  if (!clean) return undefined;

  const lower = clean.toLowerCase();

  // Gender
  if (lower === 'f' || lower.endsWith('/female') || lower === 'female') {
    return 'Female';
  }
  if (lower === 'm' || lower.endsWith('/male') || lower === 'male') {
    return 'Male';
  }
  if (lower === 'u' || lower.endsWith('/unknown') || lower === 'unknown') {
    return 'Unknown';
  }

  // Relationship types
  if (lower.endsWith('/couple') || lower === 'couple') {
    return 'Couple';
  }
  if (lower.endsWith('/parentchild') || lower === 'parentchild') {
    return 'Parent-Child';
  }
  if (lower.endsWith('/adoptiveparent') || lower === 'adoptiveparent') {
    return 'Adoptive Parent';
  }

  return undefined;
}

/**
 * Formats an event age inlay hint (e.g. "Died age 71", "Married age 25").
 */
export function formatAgeHint(
  birthDate: string,
  eventDate: string,
  eventTagOrType: string,
): { label: string; tooltip: string } | undefined {
  return formatAgeAtEvent(birthDate, eventDate, eventTagOrType);
}

/**
 * Formats a pointer target summary for inlay hints (e.g. "John Smith (1850–1920)").
 */
export function formatPointerHint(
  analysis: Analysis,
  targetOrXref: Structure | string,
): string | undefined {
  const target =
    typeof targetOrXref === 'string'
      ? analysis.xrefs.definitions.get(targetOrXref.replace(/^#/, ''))
      : targetOrXref;
  if (!target) return undefined;

  const name = summarizeRecord(target, analysis);
  const xref = target.xref;
  const span = xref ? lifespan(analysis, xref) : undefined;

  if (target.tag === 'INDI') {
    return span ? `${name} (${span})` : name;
  }
  return name;
}
