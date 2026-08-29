/**
 * Shared, syntax-independent tooltip and hover construction helpers.
 *
 * Provides rich genealogical cards and vocabulary glossaries for both
 * standard .ged files and GEDCOM X (JSON and XML).
 */

import type { Structure } from './cst.ts';
import type { Analysis } from './index.ts';
import { lifespan, relationsOf } from './relations.ts';
import { summarizeRecord } from './summary.ts';

function resolveRecord(
  analysis: Analysis,
  recordOrXref: Structure | string,
): Structure | undefined {
  if (typeof recordOrXref === 'string') {
    const clean = recordOrXref.replace(/^@|@$|^#/g, '');
    return (
      analysis.xrefs.definitions.get(clean) ??
      analysis.xrefs.definitions.get(`I_${clean}`) ??
      analysis.xrefs.definitions.get(`F_${clean}`) ??
      analysis.xrefs.definitions.get(`S_${clean}`) ??
      analysis.xrefs.definitions.get(`U_${clean}`)
    );
  }
  return recordOrXref;
}

/**
 * Builds a rich Markdown tooltip card for any genealogical record
 * (Individual, Family, Source, Submitter, Repository, Agent).
 */
export function buildRecordTooltip(analysis: Analysis, recordOrXref: Structure | string): string {
  const record = resolveRecord(analysis, recordOrXref);
  if (!record) {
    const ref = typeof recordOrXref === 'string' ? recordOrXref : 'record';
    return `\`${ref}\` — no matching record found in this document.`;
  }

  const lines: string[] = [];
  const xref = record.xref ?? '';
  const uses = xref ? (analysis.xrefs.referencesTo.get(xref)?.length ?? 0) : 0;
  const label = summarizeRecord(record, analysis);

  if (record.tag === 'INDI') {
    const span = lifespan(analysis, xref);
    const title = `### 👤 ${label} ${span ? `*(${span})*` : ''}`;
    lines.push(title);

    const refInfo = xref ? `\`@${xref}@\` · ${uses} reference${uses === 1 ? '' : 's'}` : '';
    if (refInfo) lines.push(`*${refInfo}*`);

    const sex = record.children.find((c) => c.tag === 'SEX')?.payload;
    if (sex) {
      lines.push(`- **Gender:** ${sex === 'M' ? 'Male (♂)' : sex === 'F' ? 'Female (♀)' : sex}`);
    }

    const birt = record.children.find((c) => c.tag === 'BIRT');
    if (birt) {
      const date = birt.children.find((c) => c.tag === 'DATE')?.payload;
      const plac = birt.children.find((c) => c.tag === 'PLAC')?.payload;
      lines.push(`- **Birth:** ${[date, plac ? `in ${plac}` : ''].filter(Boolean).join(' ')}`);
    }

    const deat = record.children.find((c) => c.tag === 'DEAT');
    if (deat) {
      const date = deat.children.find((c) => c.tag === 'DATE')?.payload;
      const plac = deat.children.find((c) => c.tag === 'PLAC')?.payload;
      lines.push(`- **Death:** ${[date, plac ? `in ${plac}` : ''].filter(Boolean).join(' ')}`);
    }

    // Other events / facts
    const facts = record.children.filter(
      (c) =>
        c.tag !== 'NAME' &&
        c.tag !== 'SEX' &&
        c.tag !== 'BIRT' &&
        c.tag !== 'DEAT' &&
        c.tag !== 'FAMS' &&
        c.tag !== 'FAMC' &&
        c.tag !== 'SOUR' &&
        c.tag !== 'NOTE' &&
        c.tag !== 'CHAN' &&
        c.tag !== 'UID',
    );
    for (const fact of facts.slice(0, 4)) {
      const date = fact.children.find((c) => c.tag === 'DATE')?.payload;
      const plac = fact.children.find((c) => c.tag === 'PLAC')?.payload;
      const val = [fact.payload, date, plac].filter(Boolean).join(' · ');
      if (val) lines.push(`- **${fact.tag}:** ${val}`);
    }

    // Relations
    if (xref) {
      const rels = relationsOf(analysis, xref);
      const resolveNames = (ids: readonly string[]) =>
        ids
          .map((id) => {
            const target = analysis.xrefs.definitions.get(id);
            return target ? summarizeRecord(target, analysis) : id;
          })
          .filter(Boolean);

      if (rels.parents.length > 0) {
        lines.push(`\n**Parents:** ${resolveNames(rels.parents).join(', ')}`);
      }
      if (rels.spouses.length > 0) {
        lines.push(`\n**Spouse(s):** ${resolveNames(rels.spouses).join(', ')}`);
      }
      if (rels.children.length > 0) {
        lines.push(`\n**Children:** ${resolveNames(rels.children).join(', ')}`);
      }
    }

    // Sources
    const sources = record.children
      .filter((c) => c.tag === 'SOUR')
      .map((c) => {
        const ptr = c.payload?.replace(/^@|@$/g, '');
        if (ptr) {
          const src = analysis.xrefs.definitions.get(ptr);
          return src ? summarizeRecord(src, analysis) : ptr;
        }
        return c.children.find((sc) => sc.tag === 'TITL')?.payload;
      })
      .filter(Boolean);

    if (sources.length > 0) {
      lines.push(`\n**Sources:** ${sources.join('; ')}`);
    }
  } else if (record.tag === 'FAM') {
    lines.push(`### 👨‍👩‍👧 Family \`@${xref}@\``);
    if (xref) lines.push(`*${uses} reference${uses === 1 ? '' : 's'}*`);

    const husb = record.children.find((c) => c.tag === 'HUSB')?.payload?.replace(/^@|@$/g, '');
    const wife = record.children.find((c) => c.tag === 'WIFE')?.payload?.replace(/^@|@$/g, '');
    if (husb) {
      const hTarget = analysis.xrefs.definitions.get(husb);
      lines.push(`- **Husband:** ${hTarget ? summarizeRecord(hTarget, analysis) : husb}`);
    }
    if (wife) {
      const wTarget = analysis.xrefs.definitions.get(wife);
      lines.push(`- **Wife:** ${wTarget ? summarizeRecord(wTarget, analysis) : wife}`);
    }

    const marr = record.children.find((c) => c.tag === 'MARR');
    if (marr) {
      const date = marr.children.find((c) => c.tag === 'DATE')?.payload;
      const plac = marr.children.find((c) => c.tag === 'PLAC')?.payload;
      lines.push(`- **Marriage:** ${[date, plac ? `in ${plac}` : ''].filter(Boolean).join(' ')}`);
    }

    const children = record.children
      .filter((c) => c.tag === 'CHIL')
      .map((c) => c.payload?.replace(/^@|@$/g, ''))
      .filter((id): id is string => Boolean(id));

    if (children.length > 0) {
      const childNames = children.map((id) => {
        const cTarget = analysis.xrefs.definitions.get(id);
        return cTarget ? summarizeRecord(cTarget, analysis) : id;
      });
      lines.push(`\n**Children (${children.length}):** ${childNames.join(', ')}`);
    }
  } else if (record.tag === 'SOUR') {
    const titl = record.children.find((c) => c.tag === 'TITL')?.payload ?? label;
    lines.push(`### 📜 ${titl}`);
    if (xref) lines.push(`*\`@${xref}@\` · ${uses} reference${uses === 1 ? '' : 's'}*`);

    const auth = record.children.find((c) => c.tag === 'AUTH')?.payload;
    if (auth) lines.push(`- **Author:** ${auth}`);
    const publ = record.children.find((c) => c.tag === 'PUBL')?.payload;
    if (publ) lines.push(`- **Publication:** ${publ}`);
    const repo = record.children.find((c) => c.tag === 'REPO')?.payload?.replace(/^@|@$/g, '');
    if (repo) {
      const rTarget = analysis.xrefs.definitions.get(repo);
      lines.push(`- **Repository:** ${rTarget ? summarizeRecord(rTarget, analysis) : repo}`);
    }
  } else if (record.tag === 'SUBM' || record.tag === 'AGENT') {
    lines.push(`### 🏛️ ${label}`);
    if (xref) lines.push(`*\`@${xref}@\` · ${uses} reference${uses === 1 ? '' : 's'}*`);

    const email = record.children.find((c) => c.tag === 'EMAIL')?.payload;
    if (email) lines.push(`- **Email:** ${email}`);
    const phone = record.children.find((c) => c.tag === 'PHON')?.payload;
    if (phone) lines.push(`- **Phone:** ${phone}`);
    const www = record.children.find((c) => c.tag === 'WWW')?.payload;
    if (www) lines.push(`- **Homepage:** ${www}`);
  } else {
    lines.push(`### ${record.tag} \`@${xref}@\``);
    lines.push(label);
  }

  return lines.join('\n\n');
}

/**
 * Universal vocabulary definition for keywords, verbs, members, tags, and URIs.
 */
export interface KeywordInfo {
  readonly title: string;
  readonly desc: string;
  readonly gedcom7Tag?: string;
  readonly gedcomxUri?: string;
  readonly jsonXmlMember?: string;
}

const KEYWORD_DICTIONARY: Record<string, KeywordInfo> = {
  // Entities
  indi: {
    title: 'Individual / Person',
    desc: 'An individual person who is of interest in a family history.',
    gedcom7Tag: 'INDI',
    gedcomxUri: 'http://gedcomx.org/Person',
    jsonXmlMember: 'persons / <person>',
  },
  person: {
    title: 'Individual / Person',
    desc: 'An individual person who is of interest in a family history.',
    gedcom7Tag: 'INDI',
    gedcomxUri: 'http://gedcomx.org/Person',
    jsonXmlMember: 'persons / <person>',
  },
  persons: {
    title: 'Individuals / Persons Collection',
    desc: 'A collection of individual person records in a genealogical tree.',
    gedcom7Tag: 'INDI',
    gedcomxUri: 'http://gedcomx.org/Person',
    jsonXmlMember: 'persons / <person>',
  },
  fam: {
    title: 'Family / Relationship',
    desc: 'A family unit comprising partners/spouses and their children.',
    gedcom7Tag: 'FAM',
    gedcomxUri: 'http://gedcomx.org/Relationship',
    jsonXmlMember: 'relationships / <relationship>',
  },
  relationship: {
    title: 'Relationship / Family',
    desc: 'A genealogical relationship between persons (e.g. Couple or Parent-Child).',
    gedcom7Tag: 'FAM',
    gedcomxUri: 'http://gedcomx.org/Relationship',
    jsonXmlMember: 'relationships / <relationship>',
  },
  relationships: {
    title: 'Relationships Collection',
    desc: 'The collection of familial and couple relationships in this document.',
    gedcom7Tag: 'FAM',
    gedcomxUri: 'http://gedcomx.org/Relationship',
    jsonXmlMember: 'relationships / <relationship>',
  },
  sour: {
    title: 'Source Description',
    desc: 'A description of an authoritative source, artifact, document, or citation.',
    gedcom7Tag: 'SOUR',
    gedcomxUri: 'http://gedcomx.org/SourceDescription',
    jsonXmlMember: 'sourceDescriptions / <sourceDescription>',
  },
  sourcedescription: {
    title: 'Source Description',
    desc: 'A description of an authoritative source, artifact, document, or citation.',
    gedcom7Tag: 'SOUR',
    gedcomxUri: 'http://gedcomx.org/SourceDescription',
    jsonXmlMember: 'sourceDescriptions / <sourceDescription>',
  },
  subm: {
    title: 'Submitter / Agent',
    desc: 'The person, system, or organization submitting or curating this genealogical data.',
    gedcom7Tag: 'SUBM',
    gedcomxUri: 'http://gedcomx.org/Agent',
    jsonXmlMember: 'agents / <agent>',
  },
  agent: {
    title: 'Agent / Submitter',
    desc: 'The person, organization, or software responsible for publishing the records.',
    gedcom7Tag: 'SUBM',
    gedcomxUri: 'http://gedcomx.org/Agent',
    jsonXmlMember: 'agents / <agent>',
  },
  agents: {
    title: 'Agents Collection',
    desc: 'Collection of submitters, contributors, or organizations in this file.',
    gedcom7Tag: 'SUBM',
    gedcomxUri: 'http://gedcomx.org/Agent',
    jsonXmlMember: 'agents / <agent>',
  },
  repo: {
    title: 'Repository',
    desc: 'The archive, library, church, or organization holding the cited source material.',
    gedcom7Tag: 'REPO',
    gedcomxUri: 'http://gedcomx.org/Repository',
    jsonXmlMember: 'repository / <repository>',
  },
  head: {
    title: 'Header / Document Metadata',
    desc: 'File-level metadata including schema versions, character encoding, and exporter attribution.',
    gedcom7Tag: 'HEAD',
    gedcomxUri: 'http://gedcomx.org/Attribution',
    jsonXmlMember: 'attribution / <attribution>',
  },
  attribution: {
    title: 'Attribution & Provenance',
    desc: 'Provenance metadata describing contributors, change timestamps, and source origin.',
    gedcom7Tag: 'HEAD / CHAN',
    gedcomxUri: 'http://gedcomx.org/Attribution',
    jsonXmlMember: 'attribution / <attribution>',
  },

  // Facts & Vitals
  birt: {
    title: 'Birth Fact',
    desc: 'The event of an individual being born.',
    gedcom7Tag: 'BIRT',
    gedcomxUri: 'http://gedcomx.org/Birth',
    jsonXmlMember: 'facts (type: Birth)',
  },
  birth: {
    title: 'Birth Fact',
    desc: 'The event of an individual being born.',
    gedcom7Tag: 'BIRT',
    gedcomxUri: 'http://gedcomx.org/Birth',
    jsonXmlMember: 'facts (type: Birth)',
  },
  deat: {
    title: 'Death Fact',
    desc: 'The event of an individual’s demise.',
    gedcom7Tag: 'DEAT',
    gedcomxUri: 'http://gedcomx.org/Death',
    jsonXmlMember: 'facts (type: Death)',
  },
  death: {
    title: 'Death Fact',
    desc: 'The event of an individual’s demise.',
    gedcom7Tag: 'DEAT',
    gedcomxUri: 'http://gedcomx.org/Death',
    jsonXmlMember: 'facts (type: Death)',
  },
  marr: {
    title: 'Marriage Fact',
    desc: 'The legal, civil, or religious union of two individuals.',
    gedcom7Tag: 'MARR',
    gedcomxUri: 'http://gedcomx.org/Marriage',
    jsonXmlMember: 'facts (type: Marriage)',
  },
  marriage: {
    title: 'Marriage Fact',
    desc: 'The legal, civil, or religious union of two individuals.',
    gedcom7Tag: 'MARR',
    gedcomxUri: 'http://gedcomx.org/Marriage',
    jsonXmlMember: 'facts (type: Marriage)',
  },
  div: {
    title: 'Divorce Fact',
    desc: 'The legal or civil dissolution of a marriage.',
    gedcom7Tag: 'DIV',
    gedcomxUri: 'http://gedcomx.org/Divorce',
    jsonXmlMember: 'facts (type: Divorce)',
  },
  divorce: {
    title: 'Divorce Fact',
    desc: 'The legal or civil dissolution of a marriage.',
    gedcom7Tag: 'DIV',
    gedcomxUri: 'http://gedcomx.org/Divorce',
    jsonXmlMember: 'facts (type: Divorce)',
  },
  bapm: {
    title: 'Baptism Fact',
    desc: 'The religious baptism or christening ceremony.',
    gedcom7Tag: 'BAPM',
    gedcomxUri: 'http://gedcomx.org/Baptism',
    jsonXmlMember: 'facts (type: Baptism)',
  },
  baptism: {
    title: 'Baptism Fact',
    desc: 'The religious baptism or christening ceremony.',
    gedcom7Tag: 'BAPM',
    gedcomxUri: 'http://gedcomx.org/Baptism',
    jsonXmlMember: 'facts (type: Baptism)',
  },
  chr: {
    title: 'Christening Fact',
    desc: 'The baptism or naming of an infant in a religious congregation.',
    gedcom7Tag: 'CHR',
    gedcomxUri: 'http://gedcomx.org/Christening',
    jsonXmlMember: 'facts (type: Christening)',
  },
  christening: {
    title: 'Christening Fact',
    desc: 'The baptism or naming of an infant in a religious congregation.',
    gedcom7Tag: 'CHR',
    gedcomxUri: 'http://gedcomx.org/Christening',
    jsonXmlMember: 'facts (type: Christening)',
  },
  buri: {
    title: 'Burial Fact',
    desc: 'The interring of the deceased individual’s mortal remains.',
    gedcom7Tag: 'BURI',
    gedcomxUri: 'http://gedcomx.org/Burial',
    jsonXmlMember: 'facts (type: Burial)',
  },
  burial: {
    title: 'Burial Fact',
    desc: 'The interring of the deceased individual’s mortal remains.',
    gedcom7Tag: 'BURI',
    gedcomxUri: 'http://gedcomx.org/Burial',
    jsonXmlMember: 'facts (type: Burial)',
  },
  occu: {
    title: 'Occupation Fact',
    desc: 'The trade, profession, craft, or employment of the person.',
    gedcom7Tag: 'OCCU',
    gedcomxUri: 'http://gedcomx.org/Occupation',
    jsonXmlMember: 'facts (type: Occupation)',
  },
  occupation: {
    title: 'Occupation Fact',
    desc: 'The trade, profession, craft, or employment of the person.',
    gedcom7Tag: 'OCCU',
    gedcomxUri: 'http://gedcomx.org/Occupation',
    jsonXmlMember: 'facts (type: Occupation)',
  },
  resi: {
    title: 'Residence Fact',
    desc: 'The place where an individual lived at a specific point in time.',
    gedcom7Tag: 'RESI',
    gedcomxUri: 'http://gedcomx.org/Residence',
    jsonXmlMember: 'facts (type: Residence)',
  },
  residence: {
    title: 'Residence Fact',
    desc: 'The place where an individual lived at a specific point in time.',
    gedcom7Tag: 'RESI',
    gedcomxUri: 'http://gedcomx.org/Residence',
    jsonXmlMember: 'facts (type: Residence)',
  },
  cens: {
    title: 'Census Fact',
    desc: 'An official periodic count and enumeration of the population.',
    gedcom7Tag: 'CENS',
    gedcomxUri: 'http://gedcomx.org/Census',
    jsonXmlMember: 'facts (type: Census)',
  },
  census: {
    title: 'Census Fact',
    desc: 'An official periodic count and enumeration of the population.',
    gedcom7Tag: 'CENS',
    gedcomxUri: 'http://gedcomx.org/Census',
    jsonXmlMember: 'facts (type: Census)',
  },
  couple: {
    title: 'Couple Relationship',
    desc: 'A relationship between two spouses or partners.',
    gedcom7Tag: 'FAM (HUSB + WIFE)',
    gedcomxUri: 'http://gedcomx.org/Couple',
    jsonXmlMember: 'relationships (type: Couple)',
  },
  parentchild: {
    title: 'Parent-Child Relationship',
    desc: 'A relationship between a parent (person1) and child (person2).',
    gedcom7Tag: 'FAM (CHIL)',
    gedcomxUri: 'http://gedcomx.org/ParentChild',
    jsonXmlMember: 'relationships (type: ParentChild)',
  },
  male: {
    title: 'Male Gender',
    desc: 'Biological male sex or masculine gender identifier.',
    gedcom7Tag: 'SEX M',
    gedcomxUri: 'http://gedcomx.org/Male',
    jsonXmlMember: 'gender (type: Male)',
  },
  female: {
    title: 'Female Gender',
    desc: 'Biological female sex or feminine gender identifier.',
    gedcom7Tag: 'SEX F',
    gedcomxUri: 'http://gedcomx.org/Female',
    jsonXmlMember: 'gender (type: Female)',
  },

  fact: {
    title: 'Genealogical Fact / Attribute',
    desc: 'A single recorded genealogical fact, event, or personal attribute.',
    gedcom7Tag: 'FACT / EVEN',
    gedcomxUri: 'http://gedcomx.org/Fact',
    jsonXmlMember: 'facts / <fact>',
  },
  facts: {
    title: 'Facts Collection',
    desc: 'Collection of events, vital dates, attributes, and occupations for a person or family.',
    gedcom7Tag: 'FACT / EVEN',
    gedcomxUri: 'http://gedcomx.org/Fact',
    jsonXmlMember: 'facts / <fact>',
  },

  // Properties & Fields
  sex: {
    title: 'Gender / Biological Sex',
    desc: 'The gender or biological sex of the individual.',
    gedcom7Tag: 'SEX',
    gedcomxUri: 'http://gedcomx.org/Gender',
    jsonXmlMember: 'gender / <gender>',
  },
  gender: {
    title: 'Gender / Biological Sex',
    desc: 'The gender or biological sex of the individual.',
    gedcom7Tag: 'SEX',
    gedcomxUri: 'http://gedcomx.org/Gender',
    jsonXmlMember: 'gender / <gender>',
  },
  name: {
    title: 'Personal Name',
    desc: 'The formal, birth, married, or customary name of the individual.',
    gedcom7Tag: 'NAME',
    gedcomxUri: 'http://gedcomx.org/Name',
    jsonXmlMember: 'names / <name>',
  },
  names: {
    title: 'Names Collection',
    desc: 'List of recorded name forms and spelling variations for this individual.',
    gedcom7Tag: 'NAME',
    gedcomxUri: 'http://gedcomx.org/Name',
    jsonXmlMember: 'names / <name>',
  },
  nameform: {
    title: 'Name Form',
    desc: 'A specific representation or script of a person’s name.',
    gedcom7Tag: 'NAME / TRAN',
    gedcomxUri: 'http://gedcomx.org/NameForm',
    jsonXmlMember: 'nameForms / <nameForm>',
  },
  nameforms: {
    title: 'Name Forms Collection',
    desc: 'Representations of a name across different alphabets, scripts, or full-text representations.',
    gedcom7Tag: 'NAME / TRAN',
    gedcomxUri: 'http://gedcomx.org/NameForm',
    jsonXmlMember: 'nameForms / <nameForm>',
  },
  fulltext: {
    title: 'Full Text Name',
    desc: 'The unparsed, full-length name string (often with surnames delimited in slashes `/Surname/`).',
    gedcom7Tag: 'NAME payload',
    jsonXmlMember: 'fullText / <fullText>',
  },
  givn: {
    title: 'Given Name',
    desc: 'The first or forenames bestowed upon the individual.',
    gedcom7Tag: 'GIVN',
    gedcomxUri: 'http://gedcomx.org/Given',
    jsonXmlMember: 'parts (type: Given)',
  },
  surn: {
    title: 'Surname / Family Name',
    desc: 'The hereditary surname or family name passed across generations.',
    gedcom7Tag: 'SURN',
    gedcomxUri: 'http://gedcomx.org/Surname',
    jsonXmlMember: 'parts (type: Surname)',
  },
  date: {
    title: 'Date Specification',
    desc: 'A temporal timestamp or calendar date (exact, estimated, range, or period).',
    gedcom7Tag: 'DATE',
    gedcomxUri: 'http://gedcomx.org/Date',
    jsonXmlMember: 'date / <date>',
  },
  formal: {
    title: 'Formal ISO-8601 Date',
    desc: 'Standardized ISO-8601 or GEDCOM X formal date string (e.g. `+1850-03-12`).',
    gedcom7Tag: 'DATE',
    jsonXmlMember: 'formal / @formal',
  },
  original: {
    title: 'Original Date / Place Text',
    desc: 'The exact textual transcription as written in the historical source document.',
    gedcom7Tag: 'DATE / PLAC',
    jsonXmlMember: 'original / <original>',
  },
  plac: {
    title: 'Place / Jurisdiction',
    desc: 'The geographic jurisdiction or location where an event transpired.',
    gedcom7Tag: 'PLAC',
    gedcomxUri: 'http://gedcomx.org/PlaceReference',
    jsonXmlMember: 'place / <place>',
  },
  place: {
    title: 'Place / Jurisdiction',
    desc: 'The geographic jurisdiction or location where an event transpired.',
    gedcom7Tag: 'PLAC',
    gedcomxUri: 'http://gedcomx.org/PlaceReference',
    jsonXmlMember: 'place / <place>',
  },
  person1: {
    title: 'First Person in Relationship',
    desc: 'Pointer to the primary partner (in a Couple) or parent (in a Parent-Child relationship).',
    gedcom7Tag: 'HUSB / FAMC',
    jsonXmlMember: 'person1 / <person1>',
  },
  person2: {
    title: 'Second Person in Relationship',
    desc: 'Pointer to the second partner (in a Couple) or child (in a Parent-Child relationship).',
    gedcom7Tag: 'WIFE / CHIL',
    jsonXmlMember: 'person2 / <person2>',
  },
  id: {
    title: 'Unique Identifier',
    desc: 'The local document identifier or cross-reference key for this entity.',
    gedcom7Tag: 'XREF (@ID@)',
    jsonXmlMember: '"id" / @id',
  },
  resource: {
    title: 'Resource Pointer / URI',
    desc: 'A URI or local hash reference (`#id`) pointing to another record in the document.',
    gedcom7Tag: 'Pointer payload (@ID@)',
    jsonXmlMember: '"resource" / @resource',
  },
};

/**
 * Builds a rich Markdown tooltip for any keyword, verb, tag, property, or URI.
 */
export function buildKeywordTooltip(keywordOrTagOrUri: string): string | undefined {
  const raw = keywordOrTagOrUri.trim();
  const normalized = raw
    .toLowerCase()
    .replace(/^https?:\/\/gedcomx\.org\//, '')
    .replace(/^[<"']|[>"']$/g, '');

  const info =
    KEYWORD_DICTIONARY[normalized] ??
    KEYWORD_DICTIONARY[raw] ??
    KEYWORD_DICTIONARY[raw.toLowerCase()];

  if (!info) return undefined;

  const lines: string[] = [];
  lines.push(`### ${info.title}\n`);
  lines.push(`${info.desc}\n`);

  const meta: string[] = [];
  if (info.gedcom7Tag) meta.push(`- **GEDCOM 7 Tag:** \`${info.gedcom7Tag}\``);
  if (info.gedcomxUri) meta.push(`- **GEDCOM X URI:** \`${info.gedcomxUri}\``);
  if (info.jsonXmlMember) meta.push(`- **JSON / XML:** \`${info.jsonXmlMember}\``);

  if (meta.length > 0) {
    lines.push(meta.join('\n'));
  }

  return lines.join('\n');
}
