import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  calculateKinship,
  detectGedcomXFormat,
  extractGdz,
  findLocalMediaReferences,
  gedcomXToGedcom7,
  getMimeType,
  isGdz,
  isGedcomX,
  packageGdz,
  readGdz,
  splitGdzPath,
  toDataUrl,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const archiveDir = join(root, 'fixtures', 'archive');
const mediaDir = join(root, 'fixtures', 'media');

describe('E2E GDZ (GEDZIP) Multi-Format Testing', () => {
  const sampleGedcom = `0 HEAD
1 GEDC
2 VERS 7.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Marie /Curie/
1 SEX F
1 BIRT
2 DATE 7 NOV 1867
2 PLAC Warsaw, Poland
1 DEAT
2 DATE 4 JUL 1934
1 FAMS @F1@
1 OBJE
2 FILE media/portrait.jpg
2 FORM jpg
1 OBJE
2 FILE metadata/citation.json
1 OBJE
2 FILE metadata/archive.xml
0 @I2@ INDI
1 NAME Pierre /Curie/
1 SEX M
1 BIRT
2 DATE 15 MAY 1859
1 FAMS @F1@
0 @I3@ INDI
1 NAME Irène /Joliot-Curie/
1 SEX F
1 BIRT
2 DATE 12 SEP 1897
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 26 JUL 1895
1 CHIL @I3@
0 TRLR
`;

  const sampleJson = JSON.stringify(
    {
      id: 'curie-metadata-tree',
      description: 'GEDCOM X JSON dataset inside GDZ archive',
      persons: [
        {
          id: 'P-1',
          gender: { type: 'http://gedcomx.org/Female' },
          names: [{ preferred: true, nameForms: [{ fullText: 'Marie /Curie/' }] }],
          facts: [{ type: 'http://gedcomx.org/Birth', date: { original: '7 NOV 1867' } }],
        },
        {
          id: 'P-2',
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ preferred: true, nameForms: [{ fullText: 'Pierre /Curie/' }] }],
          facts: [{ type: 'http://gedcomx.org/Birth', date: { original: '15 MAY 1859' } }],
        },
      ],
      relationships: [
        {
          type: 'http://gedcomx.org/Couple',
          person1: { resource: '#P-2' },
          person2: { resource: '#P-1' },
        },
      ],
    },
    null,
    2,
  );

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<gedcomx xmlns="http://gedcomx.org/v1/" id="curie-xml-metadata">
  <attribution>
    <contributor resource="#agent-archive"/>
    <changeMessage>Companion XML metadata inside GDZ</changeMessage>
  </attribution>
  <person id="P-1">
    <gender type="http://gedcomx.org/Female"/>
    <name preferred="true">
      <nameForm>
        <fullText>Marie /Curie/</fullText>
      </nameForm>
    </name>
  </person>
</gedcomx>`;

  it('builds and saves fixtures/archive/mixed-formats.gdz with JSON, XML, GED, and Media files', () => {
    const photoJpg = readFileSync(join(mediaDir, 'sample.jpg'));
    const photoPng = readFileSync(join(mediaDir, 'portrait.png'));
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 sample pdf document');

    const gdzBytes = packageGdz({
      gedcomText: sampleGedcom,
      files: {
        'metadata/citation.json': new TextEncoder().encode(sampleJson),
        'metadata/archive.xml': new TextEncoder().encode(sampleXml),
        'media/portrait.jpg': photoJpg,
        'media/portrait.png': photoPng,
        'documents/nobel_prize.pdf': pdfBytes,
      },
    });

    expect(isGdz(gdzBytes)).toBe(true);

    const fixturePath = join(archiveDir, 'mixed-formats.gdz');
    writeFileSync(fixturePath, Buffer.from(gdzBytes));

    // Verify written archive on disk
    const onDiskBytes = readFileSync(fixturePath);
    expect(isGdz(onDiskBytes)).toBe(true);
    const archive = readGdz(onDiskBytes);
    expect(archive.listFiles()).toHaveLength(6); // gedcom.ged + 5 files
    expect(archive.hasFile('metadata/citation.json')).toBe(true);
    expect(archive.hasFile('metadata/archive.xml')).toBe(true);
    expect(archive.hasFile('media/portrait.jpg')).toBe(true);
    expect(archive.hasFile('media/portrait.png')).toBe(true);
    expect(archive.hasFile('documents/nobel_prize.pdf')).toBe(true);
  });

  it('extracts and processes JSON/XML/GED files from the mixed GDZ archive', () => {
    const fixturePath = join(archiveDir, 'mixed-formats.gdz');
    const bytes = readFileSync(fixturePath);
    const archive = readGdz(bytes);

    // 1. Primary GEDCOM dataset analysis & kinship
    const gedAnalysis = analyzeText(archive.gedcomText);
    expect(gedAnalysis.version).toBe('7.0');
    expect(gedAnalysis.document.records.length).toBeGreaterThanOrEqual(4);
    const kinship = calculateKinship(gedAnalysis, 'I1', 'I3');
    expect(kinship?.description.toLowerCase()).toContain('daughter');

    // 2. Companion JSON extraction & analysis
    const jsonBytes = archive.getFile('metadata/citation.json')!;
    const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
    expect(isGedcomX(jsonText)).toBe(true);
    expect(detectGedcomXFormat(jsonText)).toBe('json');
    const jsonAnalysis = analyzeText(jsonText);
    expect(jsonAnalysis.xrefs.definitions.has('I_P_1')).toBe(true);

    // 3. Companion XML extraction & conversion to GEDCOM 7
    const xmlBytes = archive.getFile('metadata/archive.xml')!;
    const xmlText = new TextDecoder('utf-8').decode(xmlBytes);
    expect(isGedcomX(xmlText)).toBe(true);
    expect(detectGedcomXFormat(xmlText)).toBe('xml');
    const convertedGedcom = gedcomXToGedcom7(xmlText);
    expect(convertedGedcom).toContain('1 NAME Marie /Curie/');

    // 4. Media data URL conversion
    const jpgBytes = archive.getFile('media/portrait.jpg')!;
    expect(getMimeType('portrait.jpg')).toBe('image/jpeg');
    const dataUrl = toDataUrl(jpgBytes, 'portrait.jpg');
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const pdfExtracted = archive.getFile('documents/nobel_prize.pdf')!;
    expect(getMimeType('nobel_prize.pdf')).toBe('application/pdf');
    expect(new TextDecoder().decode(pdfExtracted)).toContain('%PDF-1.4');
  });

  it('scans media references and paths inside the mixed GDZ archive', () => {
    const refs = findLocalMediaReferences(sampleGedcom);
    expect(refs).toContain('media/portrait.jpg');
    expect(refs).toContain('metadata/citation.json');
    expect(refs).toContain('metadata/archive.xml');

    const split = splitGdzPath('/repo/fixtures/archive/mixed-formats.gdz/metadata/citation.json');
    expect(split.archivePath).toBe('/repo/fixtures/archive/mixed-formats.gdz');
    expect(split.entryPath).toBe('metadata/citation.json');
  });

  it('supports roundtrip editing and repackaging with modified JSON/XML/GED entries', () => {
    const fixturePath = join(archiveDir, 'mixed-formats.gdz');
    const initialBytes = readFileSync(fixturePath);
    const extracted = extractGdz(initialBytes);

    // Modify GEDCOM text
    const updatedGedcom = extracted.gedcomText.replace('Warsaw, Poland', 'Warszawa, Poland');

    // Add a new JSON file
    const newJson = JSON.stringify({ note: 'Added during edit test' });
    extracted.files.set('metadata/notes.json', new TextEncoder().encode(newJson));

    // Repack
    const repackedBytes = packageGdz({
      gedcomText: updatedGedcom,
      files: extracted.files,
    });

    expect(isGdz(repackedBytes)).toBe(true);

    const reloaded = readGdz(repackedBytes);
    expect(reloaded.gedcomText).toContain('Warszawa, Poland');
    expect(reloaded.hasFile('metadata/notes.json')).toBe(true);
    expect(reloaded.hasFile('media/portrait.jpg')).toBe(true);
  });

  it('validates real fixture alberteinstein.gdz', () => {
    const fixturePath = join(archiveDir, 'alberteinstein.gdz');
    const bytes = readFileSync(fixturePath);
    expect(isGdz(bytes)).toBe(true);
    const archive = readGdz(bytes);
    expect(archive.gedcomText).toContain('Albert');
    expect(archive.hasFile('media/AlbertEinstein1921.jpg')).toBe(true);

    const photoBytes = archive.getFile('media/AlbertEinstein1921.jpg')!;
    const dataUrl = toDataUrl(photoBytes, 'media/AlbertEinstein1921.jpg');
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
});
