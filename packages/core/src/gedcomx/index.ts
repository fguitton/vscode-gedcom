/**
 * GEDCOM X module.
 *
 * Provides full support for GEDCOM X JSON & XML formats used by the FamilySearch API:
 * parsing, serialization, and high-fidelity bidirectional conversion to/from GEDCOM 7.0.
 */

export * from './types.ts';
export * from './detect.ts';
export * from './json.ts';
export * from './xml.ts';
export * from './to-gedcom7.ts';
export * from './from-gedcom.ts';
export * from './spans.ts';
export * from './navigation.ts';
