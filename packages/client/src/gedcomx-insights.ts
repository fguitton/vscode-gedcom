/**
 * Rich inline insights for GEDCOM X files (JSON and XML).
 *
 * Provides:
 * 1. Inlay Hints: displays resolved names/lifespans next to resource/person/source pointers.
 * 2. Hover Cards: rich genealogical summaries for person, source, and relationship references.
 * 3. CodeLens: interactive "Show in Tree" buttons above person records.
 */

import {
  computeGedcomXEntitySpans,
  detectGedcomXFormat,
  isGedcomX,
  parseGedcomXJson,
  parseGedcomXXml,
  toGedcomXref,
  type Agent,
  type Fact,
  type Gedcomx,
  type Person,
  type SourceDescription,
} from '@vscode-gedcom/core';

import {
  CodeLens,
  Hover,
  InlayHint,
  InlayHintKind,
  languages,
  MarkdownString,
  Position,
  Range,
  workspace,
  type CancellationToken,
  type CodeLensProvider,
  type Disposable,
  type ExtensionContext,
  type HoverProvider,
  type InlayHintsProvider,
  type TextDocument,
} from 'vscode';
import type { Log } from './log.ts';

const DOCUMENT_SELECTOR = [
  { language: 'json' },
  { language: 'xml' },
  { language: 'gedcom' },
  { scheme: 'file', pattern: '**/*.{gedx,gedcomx,json,xml}' },
  { scheme: 'untitled' },
];

function parseDocument(document: TextDocument): Gedcomx | null {
  const text = document.getText();
  if (!isGedcomX(text)) return null;

  const format = detectGedcomXFormat(text);
  try {
    if (format === 'json') return parseGedcomXJson(text);
    if (format === 'xml') return parseGedcomXXml(text);
  } catch {
    return null;
  }
  return null;
}

function getPersonName(person: Person): string {
  const form = person.names?.[0]?.nameForms?.[0];
  if (form?.fullText) {
    return form.fullText.replace(/\//g, '').trim();
  }
  if (form?.parts && form.parts.length > 0) {
    const given = form.parts.find((p) => p.type?.includes('Given'))?.value ?? '';
    const surname = form.parts.find((p) => p.type?.includes('Surname'))?.value ?? '';
    const full = `${given} ${surname}`.trim();
    if (full) return full;
  }
  return 'Unknown Person';
}

function getFactDate(facts: Fact[] | undefined, factType: string): string | undefined {
  const fact = facts?.find((f) => f.type?.toLowerCase().includes(factType.toLowerCase()));
  return fact?.date?.original ?? fact?.date?.formal;
}

function getFactPlace(facts: Fact[] | undefined, factType: string): string | undefined {
  const fact = facts?.find((f) => f.type?.toLowerCase().includes(factType.toLowerCase()));
  return fact?.place?.original;
}

function getPersonLifespan(person: Person): string {
  const birth = getFactDate(person.facts, 'birth');
  const death = getFactDate(person.facts, 'death');
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `b. ${birth}`;
  if (death) return `d. ${death}`;
  const occu = person.facts?.find((f) => f.type?.toLowerCase().includes('occupation'))?.value;
  if (occu) return occu;
  return '';
}

function buildPersonHover(person: Person, gx: Gedcomx): MarkdownString {
  const md = new MarkdownString();
  md.isTrusted = true;

  const name = getPersonName(person);
  const lifespan = getPersonLifespan(person);
  const title = `### 👤 ${name} ${lifespan ? `*(${lifespan})*` : ''}`;
  md.appendMarkdown(`${title}\n\n`);

  if (person.extracted) {
    md.appendMarkdown(`> 📄 **Extracted Persona** *(Source-derived)*\n\n`);
  }

  const gender = person.gender?.type?.includes('Female')
    ? 'Female (♀)'
    : person.gender?.type?.includes('Male')
      ? 'Male (♂)'
      : undefined;
  if (gender) {
    md.appendMarkdown(`- **Gender:** ${gender}\n`);
  }

  const birthDate = getFactDate(person.facts, 'birth');
  const birthPlace = getFactPlace(person.facts, 'birth');
  if (birthDate || birthPlace) {
    md.appendMarkdown(
      `- **Birth:** ${[birthDate, birthPlace ? `in ${birthPlace}` : ''].filter(Boolean).join(' ')}\n`,
    );
  }

  const deathDate = getFactDate(person.facts, 'death');
  const deathPlace = getFactPlace(person.facts, 'death');
  if (deathDate || deathPlace) {
    md.appendMarkdown(
      `- **Death:** ${[deathDate, deathPlace ? `in ${deathPlace}` : ''].filter(Boolean).join(' ')}\n`,
    );
  }

  const otherFacts = (person.facts ?? []).filter(
    (f) =>
      !f.type?.toLowerCase().includes('birth') &&
      !f.type?.toLowerCase().includes('death') &&
      f.type,
  );
  for (const fact of otherFacts.slice(0, 4)) {
    const rawType = (fact.type ?? '').split('/').pop() ?? 'Fact';
    const val = [fact.value, fact.date?.original, fact.place?.original].filter(Boolean).join(' - ');
    if (val) md.appendMarkdown(`- **${rawType}:** ${val}\n`);
  }

  // Find relationships
  const parents: string[] = [];
  const spouses: string[] = [];
  const children: string[] = [];

  const personUri = `#${person.id}`;
  for (const rel of gx.relationships ?? []) {
    const p1 = rel.person1?.resource;
    const p2 = rel.person2?.resource;
    const isParentChild = rel.type?.includes('ParentChild');
    const isCouple = rel.type?.includes('Couple');

    if (isParentChild) {
      if (p2 === personUri && p1) {
        const parentPerson = gx.persons?.find((p) => `#${p.id}` === p1);
        if (parentPerson) parents.push(getPersonName(parentPerson));
      } else if (p1 === personUri && p2) {
        const childPerson = gx.persons?.find((p) => `#${p.id}` === p2);
        if (childPerson) children.push(getPersonName(childPerson));
      }
    } else if (isCouple) {
      if (p1 === personUri && p2) {
        const spousePerson = gx.persons?.find((p) => `#${p.id}` === p2);
        if (spousePerson) spouses.push(getPersonName(spousePerson));
      } else if (p2 === personUri && p1) {
        const spousePerson = gx.persons?.find((p) => `#${p.id}` === p1);
        if (spousePerson) spouses.push(getPersonName(spousePerson));
      }
    }
  }

  if (parents.length > 0) md.appendMarkdown(`\n**Parents:** ${parents.join(', ')}\n`);
  if (spouses.length > 0) md.appendMarkdown(`\n**Spouse(s):** ${spouses.join(', ')}\n`);
  if (children.length > 0) md.appendMarkdown(`\n**Children:** ${children.join(', ')}\n`);

  if (person.sources && person.sources.length > 0) {
    const cited = person.sources
      .map((s) => {
        const descRef = s.descriptionRef?.replace(/^#/, '');
        const src = gx.sourceDescriptions?.find((sd) => sd.id === descRef);
        return src?.titles?.[0]?.value ?? src?.citation ?? descRef;
      })
      .filter(Boolean);
    if (cited.length > 0) {
      md.appendMarkdown(`\n**Sources:** ${cited.join('; ')}\n`);
    }
  }

  return md;
}

function buildSourceHover(source: SourceDescription): MarkdownString {
  const md = new MarkdownString();
  md.isTrusted = true;

  const title = source.titles?.[0]?.value ?? 'Source Record';
  md.appendMarkdown(`### 📜 ${title}\n\n`);

  if (source.citation) {
    md.appendMarkdown(`> ${source.citation}\n\n`);
  }

  if (source.about) {
    md.appendMarkdown(`- **URL / Resource:** [${source.about}](${source.about})\n`);
  }

  if (source.repository?.resource) {
    md.appendMarkdown(`- **Repository:** \`${source.repository.resource}\`\n`);
  }

  return md;
}

function buildAgentHover(agent: Agent): MarkdownString {
  const md = new MarkdownString();
  md.isTrusted = true;

  const name = agent.names?.[0]?.value ?? agent.id ?? 'Agent';
  md.appendMarkdown(`### 🏛️ ${name}\n\n`);

  if (agent.emails && agent.emails.length > 0) {
    md.appendMarkdown(`- **Email:** ${agent.emails.map((e) => e.resource).join(', ')}\n`);
  }

  if (agent.homepage?.resource) {
    md.appendMarkdown(`- **Homepage:** ${agent.homepage.resource}\n`);
  }

  return md;
}

const GEDCOMX_TYPE_DESCRIPTIONS: Record<string, { label: string; gedcom7: string; desc: string }> =
  {
    'http://gedcomx.org/Birth': {
      label: 'Birth Fact',
      gedcom7: 'BIRT',
      desc: 'The birth of an individual.',
    },
    'http://gedcomx.org/Death': {
      label: 'Death Fact',
      gedcom7: 'DEAT',
      desc: 'The death of an individual.',
    },
    'http://gedcomx.org/Marriage': {
      label: 'Marriage Fact',
      gedcom7: 'FAM.MARR',
      desc: 'The marriage of two individuals.',
    },
    'http://gedcomx.org/Divorce': {
      label: 'Divorce Fact',
      gedcom7: 'FAM.DIV',
      desc: 'The legal dissolution of a marriage.',
    },
    'http://gedcomx.org/Couple': {
      label: 'Couple Relationship',
      gedcom7: 'FAM (HUSB + WIFE)',
      desc: 'A relationship between two spouses or partners.',
    },
    'http://gedcomx.org/ParentChild': {
      label: 'Parent-Child Relationship',
      gedcom7: 'FAM (CHIL)',
      desc: 'A relationship between a parent (person1) and child (person2).',
    },
    'http://gedcomx.org/Christening': {
      label: 'Christening Fact',
      gedcom7: 'CHR',
      desc: 'The religious christening or baptism of an infant.',
    },
    'http://gedcomx.org/Baptism': {
      label: 'Baptism Fact',
      gedcom7: 'BAPM',
      desc: 'The baptism of an individual.',
    },
    'http://gedcomx.org/Burial': {
      label: 'Burial Fact',
      gedcom7: 'BURI',
      desc: 'The burial of an individual.',
    },
    'http://gedcomx.org/Occupation': {
      label: 'Occupation Fact',
      gedcom7: 'OCCU',
      desc: 'The profession or trade of an individual.',
    },
    'http://gedcomx.org/Residence': {
      label: 'Residence Fact',
      gedcom7: 'RESI',
      desc: 'The place where an individual resided.',
    },
    'http://gedcomx.org/Census': {
      label: 'Census Fact',
      gedcom7: 'CENS',
      desc: 'An enumeration of an individual in a civil census.',
    },
  };

export class GedcomXHoverProvider implements HoverProvider {
  provideHover(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
  ): Hover | null {
    const gx = parseDocument(document);
    if (!gx) return null;

    const range = document.getWordRangeAtPosition(position, /#?[a-zA-Z0-9_\-:/.]+/);
    const word = range ? document.getText(range) : '';
    if (!word) return null;

    const cleanId = word.replace(/^#/, '');

    // Check Person ID
    const person = gx.persons?.find((p) => p.id === cleanId);
    if (person) {
      return new Hover(buildPersonHover(person, gx), range);
    }

    // Check Source ID
    const source = gx.sourceDescriptions?.find((s) => s.id === cleanId);
    if (source) {
      return new Hover(buildSourceHover(source), range);
    }

    // Check Agent ID
    const agent = gx.agents?.find((a) => a.id === cleanId);
    if (agent) {
      return new Hover(buildAgentHover(agent), range);
    }

    // Check standard GEDCOM X type URI
    const typeInfo = GEDCOMX_TYPE_DESCRIPTIONS[word];
    if (typeInfo) {
      const md = new MarkdownString();
      md.appendMarkdown(`### ${typeInfo.label}\n\n`);
      md.appendMarkdown(`${typeInfo.desc}\n\n`);
      md.appendMarkdown(`- **GEDCOM 7.0 Equivalent:** \`${typeInfo.gedcom7}\`\n`);
      md.appendMarkdown(`- **URI:** \`${word}\`\n`);
      return new Hover(md, range);
    }

    return null;
  }
}

export class GedcomXInlayHintsProvider implements InlayHintsProvider {
  provideInlayHints(document: TextDocument, range: Range, _token: CancellationToken): InlayHint[] {
    const enabled = workspace.getConfiguration('gedcom').get<boolean>('inlayHints.pointers', true);
    if (!enabled) return [];

    const gx = parseDocument(document);
    if (!gx) return [];

    const persons = new Map<string, Person>();
    for (const p of gx.persons ?? []) {
      if (p.id) persons.set(p.id, p);
    }

    const sources = new Map<string, SourceDescription>();
    for (const s of gx.sourceDescriptions ?? []) {
      if (s.id) sources.set(s.id, s);
    }

    const agents = new Map<string, Agent>();
    for (const a of gx.agents ?? []) {
      if (a.id) agents.set(a.id, a);
    }

    const hints: InlayHint[] = [];
    const startLine = range.start.line;
    const endLine = Math.min(range.end.line, document.lineCount - 1);

    const refRegex = /(?:resource|descriptionRef)["\s:=]+#([a-zA-Z0-9_-]+)/g;

    for (let l = startLine; l <= endLine; l++) {
      const line = document.lineAt(l);
      let match: RegExpExecArray | null;
      refRegex.lastIndex = 0;

      while ((match = refRegex.exec(line.text)) !== null) {
        const id = match[1]!;
        const matchEndIndex = match.index + match[0].length;
        const pos = new Position(l, matchEndIndex);

        if (persons.has(id)) {
          const p = persons.get(id)!;
          const name = getPersonName(p);
          const span = getPersonLifespan(p);
          const label = ` › ${name}${span ? ` (${span})` : ''}`;
          const hint = new InlayHint(pos, label, InlayHintKind.Type);
          hint.tooltip = buildPersonHover(p, gx);
          hint.paddingLeft = true;
          hints.push(hint);
        } else if (sources.has(id)) {
          const s = sources.get(id)!;
          const title = s.titles?.[0]?.value ?? 'Source';
          const label = ` › ${title}`;
          const hint = new InlayHint(pos, label, InlayHintKind.Type);
          hint.tooltip = buildSourceHover(s);
          hint.paddingLeft = true;
          hints.push(hint);
        } else if (agents.has(id)) {
          const a = agents.get(id)!;
          const name = a.names?.[0]?.value ?? 'Agent';
          const label = ` › ${name}`;
          const hint = new InlayHint(pos, label, InlayHintKind.Type);
          hint.tooltip = buildAgentHover(a);
          hint.paddingLeft = true;
          hints.push(hint);
        }
      }
    }

    return hints;
  }
}

export class GedcomXCodeLensProvider implements CodeLensProvider {
  provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
    const enabled = workspace.getConfiguration('gedcom').get<boolean>('codeLens.enabled', true);
    if (!enabled) return [];

    const text = document.getText();
    const format = detectGedcomXFormat(text);
    if (!format) return [];

    const gx = parseDocument(document);
    if (!gx || !gx.persons || gx.persons.length === 0) return [];

    const spans = computeGedcomXEntitySpans(text, format);
    const lenses: CodeLens[] = [];

    for (const span of spans) {
      if (span.tag !== 'INDI') continue;
      const l = span.startLine;
      if (l >= document.lineCount) continue;

      const person = gx.persons.find(
        (p) => toGedcomXref(p.id ?? '', 'I') === span.xref || p.id === span.xref,
      );
      const name = person ? getPersonName(person) : span.xref;
      const lineText = document.lineAt(l).text;
      const range = new Range(new Position(l, 0), new Position(l, lineText.length));

      lenses.push(
        new CodeLens(range, {
          title: `$(type-hierarchy) Show ${name} in Tree`,
          command: 'gedcom.showGraph',
          arguments: [document.uri.toString(), l],
        }),
      );
    }

    return lenses;
  }
}

export function registerGedcomXInsights(context: ExtensionContext, log: Log): Disposable[] {
  log.info('Registering GEDCOM X inline insights (hover, inlay hints, code lenses)');

  const disposables: Disposable[] = [
    languages.registerHoverProvider(DOCUMENT_SELECTOR, new GedcomXHoverProvider()),
    languages.registerInlayHintsProvider(DOCUMENT_SELECTOR, new GedcomXInlayHintsProvider()),
    languages.registerCodeLensProvider(DOCUMENT_SELECTOR, new GedcomXCodeLensProvider()),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}
