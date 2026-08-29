import { describe, expect, it } from 'vitest';
import { computeGedcomXEntitySpans } from '../../src/gedcomx/spans.ts';

describe('GEDCOM X entity spans computation', () => {
  it('computes spans accurately for JSON with multiple persons and relationships', () => {
    const json = `{
  "attribution": {
    "contributor": { "resource": "#agent_1" }
  },
  "persons": [
    {
      "id": "P-1",
      "names": [{ "nameForms": [{ "fullText": "John /Doe/" }] }]
    },
    {
      "id": "P-2",
      "names": [{ "nameForms": [{ "fullText": "Jane /Smith/" }] }]
    }
  ],
  "relationships": [
    {
      "id": "R-1",
      "person1": { "resource": "#P-1" },
      "person2": { "resource": "#P-2" }
    }
  ]
}`;

    const spans = computeGedcomXEntitySpans(json, 'json');
    expect(spans).toHaveLength(3);

    expect(spans[0]!.tag).toBe('INDI');
    expect(spans[0]!.xref).toBe('I_P_1');
    expect(spans[0]!.startLine).toBe(5);
    expect(spans[0]!.endLine).toBe(8);

    expect(spans[1]!.tag).toBe('INDI');
    expect(spans[1]!.xref).toBe('I_P_2');
    expect(spans[1]!.startLine).toBe(9);
    expect(spans[1]!.endLine).toBe(12);

    expect(spans[2]!.tag).toBe('FAM');
    expect(spans[2]!.xref).toBe('F_R_1');
    expect(spans[2]!.startLine).toBe(15);
    expect(spans[2]!.endLine).toBe(19);
  });

  it('computes spans accurately for XML with multiple persons and relationships', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gedcomx xmlns="http://gedcomx.org/v1/">
  <attribution>
    <contributor resource="#agent_1"/>
  </attribution>
  <person id="P-1">
    <gender type="http://gedcomx.org/Male"/>
    <name>
      <nameForm><fullText>John /Doe/</fullText></nameForm>
    </name>
  </person>
  <person id="P-2">
    <gender type="http://gedcomx.org/Female"/>
  </person>
  <relationship id="R-1" type="http://gedcomx.org/Couple">
    <person1 resource="#P-1"/>
    <person2 resource="#P-2"/>
  </relationship>
</gedcomx>`;

    const spans = computeGedcomXEntitySpans(xml, 'xml');
    expect(spans).toHaveLength(3);

    expect(spans[0]!.tag).toBe('INDI');
    expect(spans[0]!.xref).toBe('I_P_1');
    expect(spans[0]!.startLine).toBe(5);
    expect(spans[0]!.endLine).toBe(10);

    expect(spans[1]!.tag).toBe('INDI');
    expect(spans[1]!.xref).toBe('I_P_2');
    expect(spans[1]!.startLine).toBe(11);
    expect(spans[1]!.endLine).toBe(13);

    expect(spans[2]!.tag).toBe('FAM');
    expect(spans[2]!.xref).toBe('F_R_1');
    expect(spans[2]!.startLine).toBe(14);
    expect(spans[2]!.endLine).toBe(17);
  });
});
