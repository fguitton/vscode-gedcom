/**
 * Converts standard GEDCOM (5.5.1 / 7.0 Document or text) to GEDCOM X data structure.
 */

import { parse } from '../parser.ts';
import type { Document, Structure } from '../cst.ts';
import type {
  Agent,
  Fact,
  Gedcomx,
  Name,
  NameForm,
  NamePart,
  Person,
  Relationship,
  SourceDescription,
} from './types.ts';

const GEDCOM_FACT_MAP: Record<string, string> = {
  BIRT: 'http://gedcomx.org/Birth',
  DEAT: 'http://gedcomx.org/Death',
  CHR: 'http://gedcomx.org/Christening',
  BAPM: 'http://gedcomx.org/Baptism',
  BURI: 'http://gedcomx.org/Burial',
  CREM: 'http://gedcomx.org/Cremation',
  ADOP: 'http://gedcomx.org/Adoption',
  OCCU: 'http://gedcomx.org/Occupation',
  RESI: 'http://gedcomx.org/Residence',
  CENS: 'http://gedcomx.org/Census',
  EMIG: 'http://gedcomx.org/Emigration',
  IMMI: 'http://gedcomx.org/Immigration',
  NATU: 'http://gedcomx.org/Naturalization',
  PROB: 'http://gedcomx.org/Probate',
  WILL: 'http://gedcomx.org/Will',
  GRAD: 'http://gedcomx.org/Graduation',
  RETI: 'http://gedcomx.org/Retirement',
};

function stripAt(xref?: string | null): string {
  if (!xref) return '';
  return xref.replace(/^@|@$/g, '');
}

function findChildren(structure: Structure, tag: string): Structure[] {
  return structure.children.filter((c) => c.tag === tag);
}

function findChild(structure: Structure, tag: string): Structure | undefined {
  return structure.children.find((c) => c.tag === tag);
}

/**
 * Converts a GEDCOM Document or text string into a Gedcomx model.
 */
export function gedcomToGedcomX(input: Document | string): Gedcomx {
  const doc = typeof input === 'string' ? parse(input) : input;

  const persons: Person[] = [];
  const relationships: Relationship[] = [];
  const sourceDescriptions: SourceDescription[] = [];
  const agents: Agent[] = [];

  for (const record of doc.records) {
    if (record.tag === 'INDI') {
      const personId = stripAt(record.xref);

      // Gender
      const sex = findChild(record, 'SEX')?.payload?.trim().toUpperCase();
      let genderType: string | undefined;
      if (sex === 'M') genderType = 'http://gedcomx.org/Male';
      else if (sex === 'F') genderType = 'http://gedcomx.org/Female';
      else if (sex) genderType = 'http://gedcomx.org/Unknown';

      // Names
      const names: Name[] = [];
      for (const nameStruct of findChildren(record, 'NAME')) {
        const fullText = nameStruct.payload || undefined;
        const parts: NamePart[] = [];

        const givn = findChild(nameStruct, 'GIVN')?.payload;
        if (givn) {
          parts.push({ type: 'http://gedcomx.org/Given', value: givn });
        }

        const surn = findChild(nameStruct, 'SURN')?.payload;
        if (surn) {
          parts.push({ type: 'http://gedcomx.org/Surname', value: surn });
        }

        const nameForm: NameForm = {
          fullText,
          parts: parts.length > 0 ? parts : undefined,
        };

        names.push({
          preferred: names.length === 0,
          type: 'http://gedcomx.org/BirthName',
          nameForms: [nameForm],
        });
      }

      // Facts
      const facts: Fact[] = [];
      for (const child of record.children) {
        const factType = GEDCOM_FACT_MAP[child.tag];
        if (factType || child.tag === 'EVEN') {
          const dateStruct = findChild(child, 'DATE');
          const placeStruct = findChild(child, 'PLAC');
          const typeStruct = findChild(child, 'TYPE');

          const finalType =
            factType ||
            (typeStruct?.payload
              ? `http://gedcomx.org/${typeStruct.payload}`
              : 'http://gedcomx.org/Other');

          facts.push({
            type: finalType,
            value: child.payload || undefined,
            date: dateStruct?.payload ? { original: dateStruct.payload } : undefined,
            place: placeStruct?.payload ? { original: placeStruct.payload } : undefined,
          });
        }
      }

      // Notes
      const notes = findChildren(record, 'NOTE')
        .map((n) => ({
          text: n.payload || '',
        }))
        .filter((n) => n.text.length > 0);

      // Sources
      const sources = findChildren(record, 'SOUR')
        .map((s) => ({
          descriptionRef: `#${stripAt(s.payload)}`,
        }))
        .filter((s) => s.descriptionRef.length > 1);

      persons.push({
        id: personId,
        gender: genderType ? { type: genderType } : undefined,
        names: names.length > 0 ? names : undefined,
        facts: facts.length > 0 ? facts : undefined,
        notes: notes.length > 0 ? notes : undefined,
        sources: sources.length > 0 ? sources : undefined,
      });
    } else if (record.tag === 'FAM') {
      const famId = stripAt(record.xref);
      const husb = stripAt(findChild(record, 'HUSB')?.payload);
      const wife = stripAt(findChild(record, 'WIFE')?.payload);
      const children = findChildren(record, 'CHIL')
        .map((c) => stripAt(c.payload))
        .filter(Boolean);

      // Couple Facts (MARR, DIV)
      const coupleFacts: Fact[] = [];
      for (const marr of findChildren(record, 'MARR')) {
        const date = findChild(marr, 'DATE')?.payload;
        const place = findChild(marr, 'PLAC')?.payload;
        coupleFacts.push({
          type: 'http://gedcomx.org/Marriage',
          date: date ? { original: date } : undefined,
          place: place ? { original: place } : undefined,
        });
      }
      for (const div of findChildren(record, 'DIV')) {
        const date = findChild(div, 'DATE')?.payload;
        const place = findChild(div, 'PLAC')?.payload;
        coupleFacts.push({
          type: 'http://gedcomx.org/Divorce',
          date: date ? { original: date } : undefined,
          place: place ? { original: place } : undefined,
        });
      }

      // Couple Relationship
      if (husb && wife) {
        relationships.push({
          id: `${famId}_couple`,
          type: 'http://gedcomx.org/Couple',
          person1: { resource: `#${husb}` },
          person2: { resource: `#${wife}` },
          facts: coupleFacts.length > 0 ? coupleFacts : undefined,
        });
      }

      // ParentChild Relationships
      for (const childId of children) {
        if (husb) {
          relationships.push({
            id: `${famId}_parent_${husb}_${childId}`,
            type: 'http://gedcomx.org/ParentChild',
            person1: { resource: `#${husb}` },
            person2: { resource: `#${childId}` },
          });
        }
        if (wife) {
          relationships.push({
            id: `${famId}_parent_${wife}_${childId}`,
            type: 'http://gedcomx.org/ParentChild',
            person1: { resource: `#${wife}` },
            person2: { resource: `#${childId}` },
          });
        }
      }
    } else if (record.tag === 'SOUR') {
      const sourceId = stripAt(record.xref);
      const titl = findChild(record, 'TITL')?.payload;
      const auth = findChild(record, 'AUTH')?.payload;
      sourceDescriptions.push({
        id: sourceId,
        titles: titl ? [{ value: titl }] : undefined,
        citation: auth || undefined,
      });
    } else if (record.tag === 'SUBM') {
      const agentId = stripAt(record.xref);
      const name = findChild(record, 'NAME')?.payload;
      agents.push({
        id: agentId,
        names: name ? [{ value: name }] : undefined,
      });
    }
  }

  return {
    attribution: {
      changeMessage: 'Exported from vscode-gedcom',
      created: Date.now(),
    },
    persons: persons.length > 0 ? persons : undefined,
    relationships: relationships.length > 0 ? relationships : undefined,
    sourceDescriptions: sourceDescriptions.length > 0 ? sourceDescriptions : undefined,
    agents: agents.length > 0 ? agents : undefined,
  };
}
