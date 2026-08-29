/**
 * Rich inline insights for GEDCOM X files (JSON and XML).
 *
 * Provides:
 * 1. Inlay Hints: displays resolved names/lifespans next to resource/person/source pointers.
 * 2. Hover Cards: rich genealogical summaries for person, source, and relationship references.
 * 3. CodeLens: interactive "Show in Tree" buttons above person records.
 */

import {
  buildKeywordTooltip,
  buildRecordTooltip,
  computeGedcomXEntitySpans,
  detectGedcomXFormat,
  formatHeaderSummary,
  formatRecordReferences,
  formatRecordSummary,
  formatTreeLensTitle,
  isGedcomX,
  parseGedcomXJson,
  parseGedcomXXml,
  type Agent,
  type Fact,
  type Gedcomx,
  type Person,
  type SourceDescription,
} from '@vscode-gedcom/core';

import { analysisOf } from './analysis.ts';

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

export class GedcomXHoverProvider implements HoverProvider {
  provideHover(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
  ): Hover | null {
    const text = document.getText();
    if (!isGedcomX(text)) return null;

    const analysis = analysisOf(document);
    const range = document.getWordRangeAtPosition(position, /#?[a-zA-Z0-9_\-:/.]+/);
    const word = range ? document.getText(range) : '';
    if (!word) return null;

    const cleanId = word.replace(/^#/, '');

    // 1. Check if word is an explicit record ID / pointer in this document
    const recordCard = buildRecordTooltip(analysis, cleanId);
    if (!recordCard.includes('no matching record found')) {
      const md = new MarkdownString(recordCard);
      md.isTrusted = true;
      return new Hover(md, range);
    }

    // 2. Check if cursor is on an entity line (e.g. <person id="..."> or "id": "...")
    const span = (analysis.entitySpans ?? []).find((s) => s.startLine === position.line);
    if (
      span &&
      (word === 'id' ||
        word === 'person' ||
        word === 'relationship' ||
        word === 'sourceDescription' ||
        word === 'agent')
    ) {
      const entityCard = buildRecordTooltip(analysis, span.xref);
      if (!entityCard.includes('no matching record found')) {
        const md = new MarkdownString(entityCard);
        md.isTrusted = true;
        return new Hover(md, range);
      }
    }

    // 3. Universal keyword / verb / member / property tooltip
    const keywordCard = buildKeywordTooltip(word);
    if (keywordCard) {
      const md = new MarkdownString(keywordCard);
      md.isTrusted = true;
      return new Hover(md, range);
    }

    return null;
  }
}

export class GedcomXInlayHintsProvider implements InlayHintsProvider {
  provideInlayHints(document: TextDocument, range: Range, _token: CancellationToken): InlayHint[] {
    const enabled = workspace.getConfiguration('gedcom').get<boolean>('inlayHints.pointers', true);
    if (!enabled) return [];

    const text = document.getText();
    const format = detectGedcomXFormat(text);
    if (!format) return [];

    const gx = parseDocument(document);
    if (!gx) return [];

    const analysis = analysisOf(document);

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
          hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
          hint.paddingLeft = true;
          hints.push(hint);
        } else if (sources.has(id)) {
          const s = sources.get(id)!;
          const title = s.titles?.[0]?.value ?? 'Source';
          const label = ` › ${title}`;
          const hint = new InlayHint(pos, label, InlayHintKind.Type);
          hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
          hint.paddingLeft = true;
          hints.push(hint);
        } else if (agents.has(id)) {
          const a = agents.get(id)!;
          const name = a.names?.[0]?.value ?? 'Agent';
          const label = ` › ${name}`;
          const hint = new InlayHint(pos, label, InlayHintKind.Type);
          hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
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

    const analysis = analysisOf(document);
    const spans = analysis.entitySpans ?? computeGedcomXEntitySpans(text, format);
    const lenses: CodeLens[] = [];

    // 1. Header summary lens above the file
    const headerTitle = formatHeaderSummary(analysis);
    if (headerTitle && document.lineCount > 0) {
      const headerRange = new Range(
        new Position(0, 0),
        new Position(0, document.lineAt(0).text.length),
      );
      lenses.push(new CodeLens(headerRange, { title: headerTitle, command: '' }));
    }

    // 2. Multi-lens above each record entity (Summary, References, Tree)
    for (const span of spans) {
      const l = span.startLine;
      if (l >= document.lineCount) continue;

      const lineText = document.lineAt(l).text;
      const range = new Range(new Position(l, 0), new Position(l, lineText.length));

      // Summary lens
      const summary = formatRecordSummary(analysis, span.xref);
      if (summary) {
        lenses.push(new CodeLens(range, { title: summary, command: '' }));
      }

      // References lens
      const refs = formatRecordReferences(analysis, span.xref);
      lenses.push(new CodeLens(range, { title: refs.title, command: '' }));

      // Tree lens (for individuals and families)
      if (span.tag === 'INDI' || span.tag === 'FAM') {
        lenses.push(
          new CodeLens(range, {
            title: formatTreeLensTitle(),
            command: 'gedcom.showGraph',
            arguments: [document.uri.toString(), l],
          }),
        );
      }
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
