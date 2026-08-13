/**
 * Payload type descriptions.
 *
 * The registry names types with its own URIs, and the whole point of this module
 * is that none of them ever reach a reader. The exhaustive test below is the one
 * that matters: it fails the moment the registry gains a type nobody described,
 * rather than waiting for someone to notice `XMLSchema#string` in a tooltip.
 */

import { describe, expect, it } from 'vitest';

import { describePayloadType } from '../src/payload.ts';
import { MODELS } from '../src/spec/model.generated.ts';

/** Every payload type either model actually uses. */
const ALL_TYPES = [
  ...new Set(
    Object.values(MODELS).flatMap((model) =>
      Object.values(model.payloads).map((payload) => payload.type),
    ),
  ),
].sort();

describe('describePayloadType', () => {
  it('describes every type the registry uses', () => {
    expect(ALL_TYPES.length).toBeGreaterThan(40);

    const leaked = ALL_TYPES.filter((type) => {
      const { summary } = describePayloadType(type);
      // A description that still contains the machine spelling has not described
      // anything — these are exactly the strings that were reaching tooltips.
      return (
        summary.includes('#') ||
        summary.includes('_') ||
        summary.includes('type-') ||
        summary.includes('XMLSchema') ||
        summary.includes('://')
      );
    });

    expect(leaked).toEqual([]);
  });

  it('starts every description with a capital letter', () => {
    const lowercase = ALL_TYPES.filter((type) => {
      const first = describePayloadType(type).summary.charAt(0);
      return first !== first.toUpperCase();
    });

    expect(lowercase).toEqual([]);
  });

  it('reads plain text as text rather than as a schema URI', () => {
    expect(describePayloadType('XMLSchema#string')).toEqual({ summary: 'Text' });
  });

  it('gives an example where the shape is not guessable', () => {
    expect(describePayloadType('type-Age').example).toBe('20y 6m 2d');
    expect(describePayloadType('type-Latitude').example).toBe('N51.5074');
    expect(describePayloadType('XMLSchema#Language').example).toBe('en-GB');
  });

  it('explains the Y-or-nothing payload, which nobody guesses', () => {
    const description = describePayloadType('Y|<NULL>');
    expect(description.summary).toContain('`Y`');
    expect(description.summary).toMatch(/took place/);
  });

  it('falls back to a readable form for an unmapped type', () => {
    expect(describePayloadType('type-CHILD_LINKAGE_STATUS').summary).toBe('Child linkage status');
  });

  it('treats every 5.5.1 name piece as text', () => {
    expect(describePayloadType('type-NAME_PIECE_GIVEN').summary).toBe('Text');
    expect(describePayloadType('type-NAME_PIECE_SURNAME_PREFIX').summary).toBe('Text');
  });
});
