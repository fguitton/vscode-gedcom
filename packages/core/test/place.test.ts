/**
 * Places, coordinates and the place form.
 *
 * The header declares what the jurisdictions in a place payload are, and almost
 * no tool surfaces it. Pairing the two is the whole value here.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import {
  coordinatesOf,
  describePlace,
  formatCoordinate,
  parseCoordinate,
  placeFormOf,
  placeParts,
  signedDegrees,
} from '../src/place.ts';
import { bytes } from './corpus.ts';

const FILE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 PLAC',
  '2 FORM City, County, State, Country',
  '0 @I1@ INDI',
  '1 BIRT',
  '2 PLAC Chelsea, Middlesex, , England',
  '3 MAP',
  '4 LATI N51.4875',
  '4 LONG W0.1687',
  '1 DEAT',
  '2 PLAC Perth',
  '3 PLAC_FORM_UNUSED x',
  '0 TRLR',
  '',
].join('\n');

const analysis = analyze(bytes(FILE));

const structureAtLine = (line: number) =>
  analysis.document.structures.find((s) => s.span.line === line)!;

describe('placeParts', () => {
  it('splits on commas and trims', () => {
    expect(placeParts('Chelsea, Middlesex, England')).toEqual(['Chelsea', 'Middlesex', 'England']);
  });

  it('keeps empty components, which mean "unknown at this level"', () => {
    expect(placeParts('Chelsea, , England')).toEqual(['Chelsea', '', 'England']);
  });
});

describe('describePlace', () => {
  it('labels each level from the form', () => {
    expect(describePlace('Chelsea, Middlesex, England', 'City, County, Country')).toEqual([
      { name: 'Chelsea', label: 'City' },
      { name: 'Middlesex', label: 'County' },
      { name: 'England', label: 'Country' },
    ]);
  });

  it('drops empty levels rather than showing blanks back', () => {
    const levels = describePlace('Chelsea, , England', 'City, County, Country');
    expect(levels.map((level) => level.name)).toEqual(['Chelsea', 'England']);
    // The label follows the position in the payload, so England keeps Country.
    expect(levels[1]?.label).toBe('Country');
  });

  it('works without a form', () => {
    expect(describePlace('Chelsea, England')).toEqual([{ name: 'Chelsea' }, { name: 'England' }]);
  });
});

describe('placeFormOf', () => {
  it('inherits the form declared in the header', () => {
    const place = structureAtLine(7);
    expect(place.tag).toBe('PLAC');
    expect(placeFormOf(analysis.document, place)).toBe('City, County, State, Country');
  });

  it('has no form when the header declares none', () => {
    const bare = analyze(bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n'));
    expect(placeFormOf(bare.document)).toBeUndefined();
  });
});

describe('parseCoordinate', () => {
  it('reads each hemisphere', () => {
    expect(parseCoordinate('N51.5074')).toEqual({ degrees: 51.5074, hemisphere: 'N' });
    expect(parseCoordinate('W0.1278')).toEqual({ degrees: 0.1278, hemisphere: 'W' });
  });

  it('rejects degrees beyond the hemisphere limit', () => {
    expect(parseCoordinate('N91')).toBeUndefined();
    expect(parseCoordinate('E181')).toBeUndefined();
    expect(parseCoordinate('E180')).toEqual({ degrees: 180, hemisphere: 'E' });
  });

  it('rejects anything that is not a coordinate', () => {
    expect(parseCoordinate('51.5074')).toBeUndefined();
    expect(parseCoordinate('North 51')).toBeUndefined();
  });
});

describe('signedDegrees', () => {
  it('makes south and west negative, as every mapping service expects', () => {
    expect(signedDegrees({ degrees: 51.5, hemisphere: 'N' })).toBe(51.5);
    expect(signedDegrees({ degrees: 51.5, hemisphere: 'S' })).toBe(-51.5);
    expect(signedDegrees({ degrees: 0.13, hemisphere: 'W' })).toBe(-0.13);
  });
});

describe('formatCoordinate', () => {
  it('spells the hemisphere out', () => {
    expect(formatCoordinate({ degrees: 51.5, hemisphere: 'N' })).toBe('51.5° north');
  });
});

describe('coordinatesOf', () => {
  it('reads a MAP with both halves', () => {
    const map = structureAtLine(8);
    expect(map.tag).toBe('MAP');
    expect(coordinatesOf(map)).toEqual({
      lat: { degrees: 51.4875, hemisphere: 'N' },
      long: { degrees: 0.1687, hemisphere: 'W' },
    });
  });

  it('has no answer for a MAP missing a half', () => {
    const partial = analyze(
      bytes(
        '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 BIRT\n2 PLAC X\n3 MAP\n4 LATI N51\n0 TRLR\n',
      ),
    );
    const map = partial.document.structures.find((s) => s.tag === 'MAP')!;
    expect(coordinatesOf(map)).toBeUndefined();
  });
});
