/**
 * Language tags and media types.
 *
 * `Intl.DisplayNames` echoes an unrecognised tag straight back, which would render
 * `1 LANG xx` as "xx" — worse than silence, because it looks like an answer. That
 * behaviour is the main thing worth pinning down here.
 */

import { describe, expect, it } from 'vitest';

import {
  describeLanguage,
  describeMediaType,
  mediaTypeOfPath,
  resolveMediaType,
} from '../src/lang.ts';

describe('describeLanguage', () => {
  it('names a plain language tag', () => {
    expect(describeLanguage('en')).toBe('English');
    expect(describeLanguage('fr')).toBe('French');
  });

  it('names a region-qualified tag', () => {
    expect(describeLanguage('en-GB')).toBe('British English');
  });

  it('handles a script subtag, which GEDCOM 7 files use for transliterations', () => {
    expect(describeLanguage('sr-Latn')).toMatch(/Serbian/);
  });

  it('says nothing rather than echoing an unknown tag back', () => {
    expect(describeLanguage('xx')).toBeUndefined();
  });

  it('survives an ill-formed tag, which throws rather than returning', () => {
    expect(describeLanguage('not a language tag')).toBeUndefined();
    expect(describeLanguage('')).toBeUndefined();
  });
});

describe('resolveMediaType', () => {
  it('passes a modern media type through', () => {
    expect(resolveMediaType('image/jpeg')).toBe('image/jpeg');
    expect(resolveMediaType('IMAGE/JPEG')).toBe('image/jpeg');
  });

  it('resolves the 5.5.1 extension spellings, which most files still use', () => {
    expect(resolveMediaType('jpg')).toBe('image/jpeg');
    expect(resolveMediaType('tif')).toBe('image/tiff');
    expect(resolveMediaType('wav')).toBe('audio/vnd.wave');
  });

  it('has no answer for an unknown bare word', () => {
    expect(resolveMediaType('sketch')).toBeUndefined();
  });
});

describe('describeMediaType', () => {
  it('names the common types', () => {
    expect(describeMediaType('image/jpeg')).toBe('JPEG image');
    expect(describeMediaType('application/pdf')).toBe('PDF document');
    expect(describeMediaType('jpg')).toBe('JPEG image');
  });

  it('falls back to the top-level kind rather than pretending to a full IANA table', () => {
    expect(describeMediaType('image/avif')).toBe('AVIF image');
    expect(describeMediaType('audio/flac')).toBe('FLAC audio');
    expect(describeMediaType('video/x-matroska')).toBe('MATROSKA video');
  });

  it('says nothing for a kind it cannot characterise', () => {
    expect(describeMediaType('application/x-custom')).toBeUndefined();
    expect(describeMediaType('')).toBeUndefined();
  });
});

describe('mediaTypeOfPath', () => {
  it('reads the extension, in any case', () => {
    expect(mediaTypeOfPath('photo.jpg')).toBe('image/jpeg');
    expect(mediaTypeOfPath('scan.PNG')).toBe('image/png');
    expect(mediaTypeOfPath('C:\\Family\\Scans\\gran.TIF')).toBe('image/tiff');
  });

  it('knows formats no FORM payload ever named', () => {
    // GEDCOM 5.5.1 listed the formats of 1996. A file exported last year points
    // at whatever its host actually serves.
    expect(mediaTypeOfPath('portrait.webp')).toBe('image/webp');
    expect(mediaTypeOfPath('crest.svg')).toBe('image/svg+xml');
  });

  it('ignores a query and a fragment', () => {
    // Neither is part of the name, and a URL may carry both.
    expect(mediaTypeOfPath('https://example.org/p.jpg?size=large')).toBe('image/jpeg');
    expect(mediaTypeOfPath('https://example.org/p.png#top')).toBe('image/png');
  });

  it('says nothing where there is nothing to read', () => {
    expect(mediaTypeOfPath('https://example.org/photograph')).toBeUndefined();
    expect(mediaTypeOfPath('archive.tar.xyz')).toBeUndefined();
    expect(mediaTypeOfPath('')).toBeUndefined();
  });
});
