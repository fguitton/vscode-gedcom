/**
 * Converts a GEDCOM X document (JSON or parsed object) to standard FamilySearch GEDCOM 7.0 format.
 */

import { detectGedcomXFormat } from './detect.ts';
import { parseGedcomXJson } from './json.ts';
import type { Fact, Gedcomx, Person, SourceDescription } from './types.ts';

import { parseGedcomXXml } from './xml.ts';

const FACT_TYPE_MAP: Record<string, string> = {
  'http://gedcomx.org/Birth': 'BIRT',
  'http://gedcomx.org/Death': 'DEAT',
  'http://gedcomx.org/Christening': 'CHR',
  'http://gedcomx.org/Baptism': 'BAPM',
  'http://gedcomx.org/Burial': 'BURI',
  'http://gedcomx.org/Cremation': 'CREM',
  'http://gedcomx.org/Adoption': 'ADOP',
  'http://gedcomx.org/Occupation': 'OCCU',
  'http://gedcomx.org/Residence': 'RESI',
  'http://gedcomx.org/Census': 'CENS',
  'http://gedcomx.org/Emigration': 'EMIG',
  'http://gedcomx.org/Immigration': 'IMMI',
  'http://gedcomx.org/Naturalization': 'NATU',
  'http://gedcomx.org/Probate': 'PROB',
  'http://gedcomx.org/Will': 'WILL',
  'http://gedcomx.org/Graduation': 'GRAD',
  'http://gedcomx.org/Retirement': 'RETI',
  // Short forms
  Birth: 'BIRT',
  Death: 'DEAT',
  Christening: 'CHR',
  Baptism: 'BAPM',
  Burial: 'BURI',
  Cremation: 'CREM',
  Occupation: 'OCCU',
  Residence: 'RESI',
  Census: 'CENS',
  Marriage: 'MARR',
  Divorce: 'DIV',
};

const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

/** Converts an ISO/GEDCOM X formal date (e.g. "+1900-05-12" or "A+1850") to standard GEDCOM date syntax */
function formatFormalDate(formal: string): string {
  let clean = formal.trim();
  let prefix = '';

  if (clean.startsWith('A+')) {
    prefix = 'ABT ';
    clean = clean.slice(2);
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  }

  const parts = clean.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10);
    const day = parseInt(parts[2]!, 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12) {
      return `${prefix}${day} ${MONTH_NAMES[month - 1]} ${year}`;
    }
  } else if (parts.length === 2) {
    const year = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10);
    if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
      return `${prefix}${MONTH_NAMES[month - 1]} ${year}`;
    }
  } else if (parts.length === 1) {
    const year = parseInt(parts[0]!, 10);
    if (!isNaN(year)) {
      return `${prefix}${year}`;
    }
  }

  return prefix + clean;
}

function extractIdFromResource(resource?: string): string | null {
  if (!resource) return null;
  if (resource.startsWith('#')) return resource.slice(1);
  const parts = resource.split('/');
  return parts[parts.length - 1] ?? resource;
}

function sanitizeXref(rawId: string, prefix: 'I' | 'F' | 'S' | 'U', index: number): string {
  if (!rawId) return `@${prefix}${index}@`;
  const sanitized = rawId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `@${prefix}_${sanitized}@`;
}

interface FamilyGroup {
  readonly id: string;
  readonly xref: string;
  spouse1Id: string | null;
  spouse2Id: string | null;
  readonly childIds: Set<string>;
  readonly facts: Fact[];
}

/**
 * Converts a Gedcomx object or JSON/XML string into standard GEDCOM 7.0 formatted text.
 */
export function gedcomXToGedcom7(input: Gedcomx | string): string {
  let doc: Gedcomx;

  if (typeof input === 'string') {
    const format = detectGedcomXFormat(input);
    if (format === 'xml') {
      doc = parseGedcomXXml(input);
    } else {
      doc = parseGedcomXJson(input);
    }
  } else {
    doc = input;
  }

  const lines: string[] = [];

  // 1. Header (HEAD)
  lines.push('0 HEAD');
  lines.push('1 GEDC');
  lines.push('2 VERS 7.0');
  lines.push('1 SOUR GEDCOMX');
  lines.push('2 NAME FamilySearch GEDCOM X Converter');
  lines.push('2 VERS 1.0');

  // Map Person IDs to XREFs
  const personMap = new Map<string, Person>();
  const personIdToXref = new Map<string, string>();

  (doc.persons ?? []).forEach((person, idx) => {
    const id = person.id || `P_${idx + 1}`;
    personMap.set(id, person);
    personIdToXref.set(id, sanitizeXref(id, 'I', idx + 1));
  });

  // Map Source Descriptions to XREFs
  const sourceDescriptionMap = new Map<string, SourceDescription>();
  const sourceIdToXref = new Map<string, string>();
  (doc.sourceDescriptions ?? []).forEach((src, idx) => {
    const id = src.id || `S_${idx + 1}`;
    sourceDescriptionMap.set(id, src);
    sourceIdToXref.set(id, sanitizeXref(id, 'S', idx + 1));
  });

  // Map Agents to XREFs
  const agentIdToXref = new Map<string, string>();
  (doc.agents ?? []).forEach((agent, idx) => {
    const id = agent.id || `U_${idx + 1}`;
    agentIdToXref.set(id, sanitizeXref(id, 'U', idx + 1));
  });

  if (doc.agents && doc.agents.length > 0 && doc.agents[0]?.id) {
    const firstAgentXref = agentIdToXref.get(doc.agents[0].id);
    if (firstAgentXref) {
      lines.push(`1 SUBM ${firstAgentXref}`);
    }
  }

  // 2. Reconstruct Family Unions (FAM records) from pairwise relationships
  const families: FamilyGroup[] = [];
  const coupleKeyToFamily = new Map<string, FamilyGroup>();
  const parentToFamilies = new Map<string, FamilyGroup[]>();
  let famCount = 0;

  function coupleKey(id1: string, id2: string): string {
    return [id1, id2].sort().join('::');
  }

  // Process Couple relationships
  for (const rel of doc.relationships ?? []) {
    const isCouple =
      rel.type === 'http://gedcomx.org/Couple' ||
      rel.type === 'Couple' ||
      rel.type === 'http://gedcomx.org/Spouse';

    if (isCouple) {
      const p1 = extractIdFromResource(rel.person1?.resource || rel.person1?.resourceId);
      const p2 = extractIdFromResource(rel.person2?.resource || rel.person2?.resourceId);
      if (p1 && p2) {
        const key = coupleKey(p1, p2);
        let fam = coupleKeyToFamily.get(key);
        if (!fam) {
          famCount++;
          fam = {
            id: rel.id || `FAM_${famCount}`,
            xref: sanitizeXref(rel.id || `F_${famCount}`, 'F', famCount),
            spouse1Id: p1,
            spouse2Id: p2,
            childIds: new Set(),
            facts: [],
          };
          families.push(fam);
          coupleKeyToFamily.set(key, fam);

          // Index by each parent
          const f1 = parentToFamilies.get(p1) || [];
          f1.push(fam);
          parentToFamilies.set(p1, f1);

          const f2 = parentToFamilies.get(p2) || [];
          f2.push(fam);
          parentToFamilies.set(p2, f2);
        }
        if (rel.facts) {
          fam.facts.push(...rel.facts);
        }
      }
    }
  }

  // Process ParentChild relationships
  // Map child -> list of parent IDs
  const childToParents = new Map<string, string[]>();
  for (const rel of doc.relationships ?? []) {
    const isParentChild =
      rel.type === 'http://gedcomx.org/ParentChild' ||
      rel.type === 'ParentChild' ||
      rel.type === 'http://gedcomx.org/AdoptiveParent';

    if (isParentChild) {
      const parentId = extractIdFromResource(rel.person1?.resource || rel.person1?.resourceId);
      const childId = extractIdFromResource(rel.person2?.resource || rel.person2?.resourceId);
      if (parentId && childId) {
        const list = childToParents.get(childId) || [];
        if (!list.includes(parentId)) list.push(parentId);
        childToParents.set(childId, list);
      }
    }
  }

  // Attach children to families
  for (const [childId, parentIds] of childToParents.entries()) {
    if (parentIds.length >= 2) {
      const p1 = parentIds[0]!;
      const p2 = parentIds[1]!;
      const key = coupleKey(p1, p2);
      let fam = coupleKeyToFamily.get(key);
      if (!fam) {
        famCount++;
        fam = {
          id: `FAM_${famCount}`,
          xref: sanitizeXref(`F_${famCount}`, 'F', famCount),
          spouse1Id: p1,
          spouse2Id: p2,
          childIds: new Set(),
          facts: [],
        };
        families.push(fam);
        coupleKeyToFamily.set(key, fam);

        const f1 = parentToFamilies.get(p1) || [];
        f1.push(fam);
        parentToFamilies.set(p1, f1);

        const f2 = parentToFamilies.get(p2) || [];
        f2.push(fam);
        parentToFamilies.set(p2, f2);
      }
      fam.childIds.add(childId);
    } else if (parentIds.length === 1) {
      const p1 = parentIds[0]!;
      const existing = parentToFamilies.get(p1);
      if (existing && existing.length === 1) {
        existing[0]!.childIds.add(childId);
      } else {
        // Single parent family
        famCount++;
        const fam: FamilyGroup = {
          id: `FAM_${famCount}`,
          xref: sanitizeXref(`F_${famCount}`, 'F', famCount),
          spouse1Id: p1,
          spouse2Id: null,
          childIds: new Set([childId]),
          facts: [],
        };
        families.push(fam);
        const f1 = parentToFamilies.get(p1) || [];
        f1.push(fam);
        parentToFamilies.set(p1, f1);
      }
    }
  }

  // Map person -> FAMS (spouse of family) & FAMC (child of family)
  const personFams = new Map<string, string[]>();
  const personFamc = new Map<string, string[]>();

  for (const fam of families) {
    if (fam.spouse1Id) {
      const list = personFams.get(fam.spouse1Id) || [];
      list.push(fam.xref);
      personFams.set(fam.spouse1Id, list);
    }
    if (fam.spouse2Id) {
      const list = personFams.get(fam.spouse2Id) || [];
      list.push(fam.xref);
      personFams.set(fam.spouse2Id, list);
    }
    for (const childId of fam.childIds) {
      const list = personFamc.get(childId) || [];
      list.push(fam.xref);
      personFamc.set(childId, list);
    }
  }

  // 3. Emit INDI records
  for (const [personId, person] of personMap.entries()) {
    const xref = personIdToXref.get(personId) || sanitizeXref(personId, 'I', 1);
    lines.push(`0 ${xref} INDI`);

    // Names
    if (person.names && person.names.length > 0) {
      for (const name of person.names) {
        let nameLine = '';
        let givenName = '';
        let surname = '';

        if (name.nameForms && name.nameForms.length > 0) {
          const form = name.nameForms[0]!;
          if (form.parts) {
            for (const part of form.parts) {
              const pType = part.type || '';
              if (pType.includes('Given') || pType === 'Given') {
                givenName = part.value || '';
              } else if (pType.includes('Surname') || pType === 'Surname') {
                surname = part.value || '';
              }
            }
          }
          if (form.fullText) {
            nameLine = form.fullText;
          }
        }

        if (!nameLine) {
          if (givenName && surname) {
            nameLine = `${givenName} /${surname}/`;
          } else if (givenName) {
            nameLine = givenName;
          } else if (surname) {
            nameLine = `/${surname}/`;
          } else {
            nameLine = 'Unknown';
          }
        } else if (!nameLine.includes('/') && surname) {
          nameLine = `${nameLine.replace(surname, '').trim()} /${surname}/`;
        }

        lines.push(`1 NAME ${nameLine}`);
        if (givenName) lines.push(`2 GIVN ${givenName}`);
        if (surname) lines.push(`2 SURN ${surname}`);
      }
    } else {
      lines.push('1 NAME Unknown');
    }

    // Gender (SEX)
    if (person.gender?.type) {
      const g = person.gender.type.toLowerCase();
      if (g.includes('male') && !g.includes('female')) {
        lines.push('1 SEX M');
      } else if (g.includes('female')) {
        lines.push('1 SEX F');
      } else {
        lines.push('1 SEX U');
      }
    }

    // Facts
    if (person.facts) {
      for (const fact of person.facts) {
        const factType = fact.type
          ? FACT_TYPE_MAP[fact.type] ||
            FACT_TYPE_MAP[fact.type.replace('http://gedcomx.org/', '')] ||
            null
          : null;
        if (factType) {
          if (factType === 'OCCU' || factType === 'RESI') {
            lines.push(`1 ${factType}${fact.value ? ' ' + fact.value : ''}`);
          } else {
            lines.push(`1 ${factType}`);
          }
        } else {
          lines.push('1 EVEN');
          if (fact.type) {
            const label = fact.type.replace('http://gedcomx.org/', '');
            lines.push(`2 TYPE ${label}`);
          }
        }

        if (fact.date) {
          const dStr =
            fact.date.original || (fact.date.formal ? formatFormalDate(fact.date.formal) : null);
          if (dStr) {
            lines.push(`2 DATE ${dStr}`);
          }
        }

        if (fact.place?.original) {
          lines.push(`2 PLAC ${fact.place.original}`);
        }

        if (fact.value && factType !== 'OCCU' && factType !== 'RESI') {
          lines.push(`2 NOTE ${fact.value}`);
        }
      }
    }

    // Family Links
    const famsList = personFams.get(personId) || [];
    for (const famXref of famsList) {
      lines.push(`1 FAMS ${famXref}`);
    }

    const famcList = personFamc.get(personId) || [];
    for (const famXref of famcList) {
      lines.push(`1 FAMC ${famXref}`);
    }

    // Notes
    if (person.notes) {
      for (const note of person.notes) {
        if (note.text) {
          lines.push(`1 NOTE ${note.text}`);
        }
      }
    }

    // Media
    if (person.media) {
      for (const m of person.media) {
        const refId = extractIdFromResource(m.descriptionRef);
        const srcDesc = refId ? sourceDescriptionMap.get(refId) : null;
        const mUrl = m.about || srcDesc?.about;
        const mType = m.mediaType || srcDesc?.mediaType;
        const mTitle = m.titles?.[0]?.value || srcDesc?.titles?.[0]?.value;
        if (mUrl || refId) {
          lines.push('1 OBJE');
          if (mUrl) lines.push(`2 FILE ${mUrl}`);
          if (mType) lines.push(`2 FORM ${mType}`);
          if (mTitle) lines.push(`2 TITL ${mTitle}`);
        }
      }
    }

    // Sources & Attached Media
    if (person.sources) {
      for (const src of person.sources) {
        const refId = extractIdFromResource(src.descriptionRef);
        const srcXref = refId ? sourceIdToXref.get(refId) : null;
        if (srcXref) {
          lines.push(`1 SOUR ${srcXref}`);
        }
        const srcDesc = refId ? sourceDescriptionMap.get(refId) : null;
        if (
          srcDesc?.about &&
          (srcDesc.mediaType?.startsWith('image/') ||
            srcDesc.resourceType === 'http://gedcomx.org/DigitalArtifact')
        ) {
          lines.push('1 OBJE');
          lines.push(`2 FILE ${srcDesc.about}`);
          if (srcDesc.mediaType) lines.push(`2 FORM ${srcDesc.mediaType}`);
          if (srcDesc.titles?.[0]?.value) lines.push(`2 TITL ${srcDesc.titles[0].value}`);
        }
      }
    }
  }

  // 4. Emit FAM records
  for (const fam of families) {
    lines.push(`0 ${fam.xref} FAM`);

    // Determine HUSB and WIFE
    let husbId = fam.spouse1Id;
    let wifeId = fam.spouse2Id;

    if (husbId && wifeId) {
      const p1 = personMap.get(husbId);
      const p2 = personMap.get(wifeId);
      const g1 = p1?.gender?.type?.toLowerCase() || '';
      const g2 = p2?.gender?.type?.toLowerCase() || '';

      if (g1.includes('female') && g2.includes('male')) {
        husbId = fam.spouse2Id;
        wifeId = fam.spouse1Id;
      }
    }

    if (husbId) {
      const hXref = personIdToXref.get(husbId);
      if (hXref) lines.push(`1 HUSB ${hXref}`);
    }

    if (wifeId) {
      const wXref = personIdToXref.get(wifeId);
      if (wXref) lines.push(`1 WIFE ${wXref}`);
    }

    for (const childId of fam.childIds) {
      const cXref = personIdToXref.get(childId);
      if (cXref) lines.push(`1 CHIL ${cXref}`);
    }

    // Family Facts (MARR, DIV, etc.)
    for (const fact of fam.facts) {
      const isDivorce = fact.type?.includes('Divorce');
      const tag = isDivorce ? 'DIV' : 'MARR';
      lines.push(`1 ${tag}`);
      if (fact.date) {
        const dStr =
          fact.date.original || (fact.date.formal ? formatFormalDate(fact.date.formal) : null);
        if (dStr) lines.push(`2 DATE ${dStr}`);
      }
      if (fact.place?.original) {
        lines.push(`2 PLAC ${fact.place.original}`);
      }
    }
  }

  // 5. Emit SOUR / OBJE records
  for (const src of doc.sourceDescriptions ?? []) {
    const id = src.id || 'S_1';
    const xref = sourceIdToXref.get(id) || sanitizeXref(id, 'S', 1);
    const isMedia =
      src.resourceType === 'http://gedcomx.org/DigitalArtifact' ||
      src.mediaType?.startsWith('image/') ||
      src.mediaType?.startsWith('audio/') ||
      src.mediaType?.startsWith('video/');

    if (isMedia) {
      lines.push(`0 ${xref} OBJE`);
      if (src.about) {
        lines.push(`1 FILE ${src.about}`);
      }
      if (src.mediaType) {
        lines.push(`1 FORM ${src.mediaType}`);
      }
      if (src.titles?.[0]?.value) {
        lines.push(`1 TITL ${src.titles[0].value}`);
      }
    } else {
      lines.push(`0 ${xref} SOUR`);
      if (src.titles?.[0]?.value) {
        lines.push(`1 TITL ${src.titles[0].value}`);
      }
      if (src.citation) {
        lines.push(`1 AUTH ${src.citation}`);
      }
      if (src.about) {
        lines.push(`1 FILE ${src.about}`);
      }
    }
  }

  // 6. Emit SUBM records
  for (const agent of doc.agents ?? []) {
    const id = agent.id || 'U_1';
    const xref = agentIdToXref.get(id) || sanitizeXref(id, 'U', 1);
    lines.push(`0 ${xref} SUBM`);
    if (agent.names?.[0]?.value) {
      lines.push(`1 NAME ${agent.names[0].value}`);
    }
  }

  // 7. Trailer
  lines.push('0 TRLR');

  return lines.join('\n') + '\n';
}
