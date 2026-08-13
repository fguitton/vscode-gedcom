/**
 * Places and coordinates.
 *
 * A place payload is a comma-separated list of jurisdictions ordered smallest
 * first, and nothing in the line says what any of them are. `Chelsea, London,
 * Middlesex, England` is readable; `St Giles, Camberwell, Surrey, England` is
 * readable only if you already know that Camberwell is the parish and Surrey the
 * county — and half the files in the wild use an order that is not the one the
 * header declares.
 *
 * The header declares it in `HEAD.PLAC.FORM`, which almost no tool surfaces. This
 * pairs the two up so the levels can be named.
 */

import type { Document, Structure } from './cst.ts';

/** The jurisdictions in a place payload, smallest first, with empties preserved. */
export function placeParts(payload: string): string[] {
  return payload.split(',').map((part) => part.trim());
}

export interface PlaceLevel {
  readonly name: string;
  /** The jurisdiction's kind, from the place form, where one is declared. */
  readonly label?: string;
}

/**
 * A place broken into levels, labelled from the form where the two line up.
 *
 * Empty components are dropped, because a payload like `,,Surrey,England` is the
 * conventional way of saying that the smaller jurisdictions are unknown — showing
 * them back as blanks would only repeat the file.
 */
export function describePlace(payload: string, form?: string): PlaceLevel[] {
  const labels = form ? placeParts(form) : [];

  return placeParts(payload).flatMap((name, index) => {
    if (name.length === 0) return [];
    const label = labels[index];
    return [label ? { name, label } : { name }];
  });
}

/**
 * The place form governing a structure: the nearest `PLAC.FORM` if the place
 * carries one, otherwise the document default in `HEAD.PLAC.FORM`.
 */
export function placeFormOf(document: Document, place?: Structure): string | undefined {
  const local = place?.children.find((c) => c.tag === 'FORM')?.payload;
  if (local) return local;

  const head = document.records.find((r) => r.tag === 'HEAD');
  const inherited = head?.children
    .find((c) => c.tag === 'PLAC')
    ?.children.find((c) => c.tag === 'FORM')?.payload;

  return inherited ?? undefined;
}

export interface Coordinate {
  readonly degrees: number;
  readonly hemisphere: 'N' | 'S' | 'E' | 'W';
}

const HEMISPHERES = { N: 'north', S: 'south', E: 'east', W: 'west' } as const;

/** Reads a `LATI` or `LONG` payload — a hemisphere letter followed by degrees. */
export function parseCoordinate(payload: string): Coordinate | undefined {
  const match = /^\s*([NSEW])\s*(\d+(?:\.\d+)?)\s*$/i.exec(payload);
  if (!match) return undefined;

  const hemisphere = match[1]!.toUpperCase() as Coordinate['hemisphere'];
  const degrees = Number(match[2]);

  // Latitudes run to 90 and longitudes to 180; anything beyond is not a coordinate.
  const limit = hemisphere === 'N' || hemisphere === 'S' ? 90 : 180;
  if (degrees > limit) return undefined;

  return { degrees, hemisphere };
}

/** `51.5074° north`, which is the form a reader can check against a map. */
export function formatCoordinate(coordinate: Coordinate): string {
  return `${coordinate.degrees}° ${HEMISPHERES[coordinate.hemisphere]}`;
}

/** Signed decimal degrees, the convention every mapping service takes. */
export function signedDegrees(coordinate: Coordinate): number {
  const negative = coordinate.hemisphere === 'S' || coordinate.hemisphere === 'W';
  return negative ? -coordinate.degrees : coordinate.degrees;
}

/** Latitude and longitude from a `MAP` structure, when it carries both. */
export function coordinatesOf(map: Structure): { lat: Coordinate; long: Coordinate } | undefined {
  const read = (tag: string) => {
    const payload = map.children.find((c) => c.tag === tag)?.payload;
    return payload ? parseCoordinate(payload) : undefined;
  };

  const lat = read('LATI');
  const long = read('LONG');
  return lat && long ? { lat, long } : undefined;
}
