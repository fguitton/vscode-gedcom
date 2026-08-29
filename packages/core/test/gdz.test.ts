import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractGdz,
  findLocalMediaReferences,
  isGdz,
  joinGdzPath,
  normalizeZipPath,
  packageGdz,
  readGdz,
  splitGdzPath,
} from '../src/gdz.ts';

describe('GEDZIP (.gdz)', () => {
  const sampleGedcom = `0 HEAD
1 GEDC
2 VERS 7.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Doe/
1 OBJE
2 FILE media/portrait.jpg
2 FORM jpg
1 OBJE
2 FILE https://example.com/tree.jpg
2 FORM jpg
0 @I2@ INDI
1 NAME Jane /Smith/
1 OBJE
2 FILE documents/birth_cert.pdf
2 FORM pdf
0 TRLR
`;

  it('detects zip archive magic header with isGdz', () => {
    const textBytes = new TextEncoder().encode(sampleGedcom);
    expect(isGdz(textBytes)).toBe(false);

    const emptyZip = packageGdz({ gedcomText: sampleGedcom });
    expect(isGdz(emptyZip)).toBe(true);
  });

  it('normalizes archive relative paths', () => {
    expect(normalizeZipPath('media\\photos\\portrait.jpg')).toBe('media/photos/portrait.jpg');
    expect(normalizeZipPath('/media/photos/portrait.jpg')).toBe('media/photos/portrait.jpg');
    expect(normalizeZipPath('///documents/cert.pdf')).toBe('documents/cert.pdf');
  });

  it('packages and reads back a GEDZIP archive with gedcom.ged and media files', () => {
    const photoBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const pdfBytes = new Uint8Array([10, 20, 30, 40]);

    const archiveBytes = packageGdz({
      gedcomText: sampleGedcom,
      files: {
        'media/portrait.jpg': photoBytes,
        'documents\\birth_cert.pdf': pdfBytes,
      },
    });

    expect(isGdz(archiveBytes)).toBe(true);

    const archive = readGdz(archiveBytes);
    expect(archive.gedcomPath).toBe('gedcom.ged');
    expect(archive.gedcomText).toBe(sampleGedcom);
    expect(archive.listFiles()).toContain('gedcom.ged');
    expect(archive.listFiles()).toContain('media/portrait.jpg');
    expect(archive.listFiles()).toContain('documents/birth_cert.pdf');

    expect(archive.hasFile('media/portrait.jpg')).toBe(true);
    expect(archive.hasFile('media\\portrait.jpg')).toBe(true);
    expect(archive.getFile('media/portrait.jpg')).toEqual(photoBytes);
    expect(archive.getFile('documents/birth_cert.pdf')).toEqual(pdfBytes);
    expect(archive.getFile('missing.jpg')).toBeUndefined();
  });

  it('packages with Map of files', () => {
    const photoBytes = new Uint8Array([7, 8, 9]);
    const fileMap = new Map<string, Uint8Array>();
    fileMap.set('assets/avatar.png', photoBytes);

    const archiveBytes = packageGdz({
      gedcomText: sampleGedcom,
      files: fileMap,
    });

    const archive = readGdz(archiveBytes);
    expect(archive.hasFile('assets/avatar.png')).toBe(true);
    expect(archive.getFile('assets/avatar.png')).toEqual(photoBytes);
  });

  it('extractGdz extracts all files cleanly', () => {
    const photoBytes = new Uint8Array([42, 43]);
    const archiveBytes = packageGdz({
      gedcomText: sampleGedcom,
      files: { 'photo.jpg': photoBytes },
    });

    const extracted = extractGdz(archiveBytes);
    expect(extracted.gedcomPath).toBe('gedcom.ged');
    expect(extracted.gedcomText).toBe(sampleGedcom);
    expect(extracted.files.size).toBe(2); // gedcom.ged + photo.jpg
    expect(extracted.files.get('photo.jpg')).toEqual(photoBytes);
  });

  it('falls back to any .ged file if gedcom.ged is absent', () => {
    const archiveBytes = packageGdz({
      gedcomText: sampleGedcom,
      datasetName: 'family_tree.ged',
    });

    const archive = readGdz(archiveBytes);
    expect(archive.gedcomPath).toBe('family_tree.ged');
    expect(archive.gedcomText).toBe(sampleGedcom);
  });

  it('throws when no GEDCOM dataset exists in the archive', () => {
    const invalidZip = packageGdz({
      gedcomText: '',
      datasetName: 'readme.txt',
    });

    expect(() => readGdz(invalidZip)).toThrow(/No GEDCOM dataset/);
  });

  it('scans and finds local media references, ignoring web URLs', () => {
    const references = findLocalMediaReferences(sampleGedcom);
    expect(references).toEqual(['media/portrait.jpg', 'documents/birth_cert.pdf']);
    expect(references).not.toContain('https://example.com/tree.jpg');
  });

  it('splits and joins GDZ virtual paths', () => {
    const split1 = splitGdzPath('/workspace/trees/family.gdz/media/portrait.jpg');
    expect(split1.archivePath).toBe('/workspace/trees/family.gdz');
    expect(split1.entryPath).toBe('media/portrait.jpg');

    const splitRoot = splitGdzPath('/workspace/trees/family.gdz');
    expect(splitRoot.archivePath).toBe('/workspace/trees/family.gdz');
    expect(splitRoot.entryPath).toBe('');

    const joined = joinGdzPath('/workspace/trees/family.gdz', 'documents/cert.pdf');
    expect(joined).toBe('/workspace/trees/family.gdz/documents/cert.pdf');
  });

  it('reads real fixture archive alberteinstein.gdz', () => {
    const fixturePath = new URL('../../../fixtures/archive/alberteinstein.gdz', import.meta.url);
    const bytes = readFileSync(fixturePath);
    expect(isGdz(bytes)).toBe(true);
    const archive = readGdz(bytes);
    expect(archive.gedcomText).toContain('Einstein');
    expect(archive.listFiles().length).toBeGreaterThan(1);
  });
});
