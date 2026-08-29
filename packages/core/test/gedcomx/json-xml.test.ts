import { describe, expect, it } from 'vitest';
import { parseGedcomXJson, toGedcomXJson } from '../../src/gedcomx/json.ts';
import { parseGedcomXXml, toGedcomXXml } from '../../src/gedcomx/xml.ts';
import type { Gedcomx } from '../../src/gedcomx/types.ts';

describe('GEDCOM X JSON & XML parser and serializer', () => {
  const sampleDoc: Gedcomx = {
    attribution: {
      changeMessage: 'Exported from FamilySearch',
      modified: 1391784900000,
    },
    persons: [
      {
        id: 'P-1',
        principal: true,
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            preferred: true,
            type: 'http://gedcomx.org/BirthName',
            nameForms: [
              {
                fullText: 'John /Doe/',
                parts: [
                  { type: 'http://gedcomx.org/Given', value: 'John' },
                  { type: 'http://gedcomx.org/Surname', value: 'Doe' },
                ],
              },
            ],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1 JAN 1900', formal: '+1900-01-01' },
            place: { original: 'Salt Lake City, UT, USA' },
          },
          {
            type: 'http://gedcomx.org/Death',
            date: { original: '15 MAR 1970', formal: '+1970-03-15' },
          },
        ],
        notes: [{ text: 'Sample biographical note.' }],
      },
    ],
    relationships: [
      {
        id: 'R-1',
        type: 'http://gedcomx.org/Couple',
        person1: { resource: '#P-1' },
        person2: { resource: '#P-2' },
        facts: [
          {
            type: 'http://gedcomx.org/Marriage',
            date: { original: '1925' },
          },
        ],
      },
    ],
    sourceDescriptions: [
      {
        id: 'S-1',
        citation: 'Parish Records Vol 1',
      },
    ],
    agents: [
      {
        id: 'A-1',
        names: [{ value: 'FamilySearch Contributor' }],
      },
    ],
  };

  it('serializes and parses GEDCOM X JSON accurately', () => {
    const jsonStr = toGedcomXJson(sampleDoc);
    const parsed = parseGedcomXJson(jsonStr);

    expect(parsed.persons?.length).toBe(1);
    expect(parsed.persons?.[0]?.id).toBe('P-1');
    expect(parsed.persons?.[0]?.gender?.type).toBe('http://gedcomx.org/Male');
    expect(parsed.persons?.[0]?.names?.[0]?.nameForms?.[0]?.fullText).toBe('John /Doe/');
    expect(parsed.persons?.[0]?.facts?.length).toBe(2);
    expect(parsed.relationships?.length).toBe(1);
    expect(parsed.relationships?.[0]?.type).toBe('http://gedcomx.org/Couple');
  });

  it('serializes and parses GEDCOM X XML accurately', () => {
    const xmlStr = toGedcomXXml(sampleDoc);
    expect(xmlStr).toContain('<gedcomx xmlns="http://gedcomx.org/v1/">');
    expect(xmlStr).toContain('<person id="P-1" principal="true">');
    expect(xmlStr).toContain('<gender type="http://gedcomx.org/Male"/>');

    const parsed = parseGedcomXXml(xmlStr);
    expect(parsed.persons?.length).toBe(1);
    expect(parsed.persons?.[0]?.id).toBe('P-1');
    expect(parsed.persons?.[0]?.gender?.type).toBe('http://gedcomx.org/Male');
    expect(parsed.persons?.[0]?.names?.[0]?.nameForms?.[0]?.fullText).toBe('John /Doe/');
    expect(parsed.persons?.[0]?.facts?.length).toBe(2);
    expect(parsed.persons?.[0]?.facts?.[0]?.date?.original).toBe('1 JAN 1900');
    expect(parsed.persons?.[0]?.facts?.[0]?.place?.original).toBe('Salt Lake City, UT, USA');
    expect(parsed.relationships?.length).toBe(1);
    expect(parsed.relationships?.[0]?.type).toBe('http://gedcomx.org/Couple');
    expect(parsed.relationships?.[0]?.person1?.resource).toBe('#P-1');
  });

  it('handles XML entities in text and attributes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gedcomx xmlns="http://gedcomx.org/v1/">
  <person id="P-2">
    <name>
      <nameForm>
        <fullText>Mary &amp; Jane &lt;Smith&gt;</fullText>
      </nameForm>
    </name>
    <note>
      <text>Notes with &quot;quotes&quot; and &apos;apostrophes&apos;</text>
    </note>
  </person>
</gedcomx>`;
    const parsed = parseGedcomXXml(xml);
    expect(parsed.persons?.[0]?.names?.[0]?.nameForms?.[0]?.fullText).toBe('Mary & Jane <Smith>');
    expect(parsed.persons?.[0]?.notes?.[0]?.text).toBe('Notes with "quotes" and \'apostrophes\'');
  });
});
