/**
 * Rich inline insights for GEDCOM X files (JSON and XML).
 *
 * Provides:
 * 1. Inlay Hints: displays resolved names/lifespans next to resource/person/source pointers.
 * 2. Hover Cards: rich genealogical summaries for person, source, and relationship references.
 * 3. CodeLens: interactive "Show in Tree" buttons above person records.
 */

import {
  ageAt,
  buildKeywordTooltip,
  buildRecordTooltip,
  computeGedcomXEntitySpans,
  detectGedcomXFormat,
  formatAgeAtEvent,
  formatHeaderSummary,
  formatRecordReferences,
  formatRecordSummary,
  formatTreeLensTitle,
  formatValueHint,
  HINT_INDENT,
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
  DocumentHighlight,
  DocumentHighlightKind,
  DocumentLink,
  Hover,
  InlayHint,
  InlayHintKind,
  languages,
  Location,
  MarkdownString,
  Position,
  Range,
  Uri,
  workspace,
  type CancellationToken,
  type CodeLensProvider,
  type DefinitionProvider,
  type Disposable,
  type DocumentHighlightProvider,
  type DocumentLinkProvider,
  type ExtensionContext,
  type HoverProvider,
  type InlayHintsProvider,
  type ReferenceContext,
  type ReferenceProvider,
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

    // 2. Check if cursor is on an entity declaration or pointer line
    const lineText = document.lineAt(position.line).text;
    const idOnLineMatch = /(?:id|resource|descriptionRef)["\s:=]+"?#?([a-zA-Z0-9_-]+)"?/i.exec(
      lineText,
    );
    if (idOnLineMatch) {
      const idCard = buildRecordTooltip(analysis, idOnLineMatch[1]!);
      if (!idCard.includes('no matching record found')) {
        const md = new MarkdownString(idCard);
        md.isTrusted = true;
        return new Hover(md, range);
      }
    }

    const span = (analysis.entitySpans ?? []).find(
      (s) => position.line >= s.startLine && position.line <= s.startLine + 2,
    );
    if (span) {
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
    const config = workspace.getConfiguration('gedcom');
    const enabledPointers = config.get<boolean>('inlayHints.pointers', true);
    const enabledValues = config.get<boolean>('inlayHints.values', true);
    const enabledAges = config.get<boolean>('inlayHints.ages', true);

    if (!enabledPointers && !enabledValues && !enabledAges) return [];

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
    const annotatedLines = new Set<number>();

    // 1. Pointer Inlay Hints (Resource / DescriptionRef pointers)
    if (enabledPointers) {
      const refRegex = /(?:resource|descriptionRef)["\s:=]+#([a-zA-Z0-9_-]+)/g;

      for (let l = startLine; l <= endLine; l++) {
        if (annotatedLines.has(l)) continue;
        const line = document.lineAt(l);
        let match: RegExpExecArray | null;
        refRegex.lastIndex = 0;

        while ((match = refRegex.exec(line.text)) !== null) {
          const id = match[1]!;
          const pos = new Position(l, line.text.length);

          if (persons.has(id)) {
            const p = persons.get(id)!;
            const name = getPersonName(p);
            const span = getPersonLifespan(p);
            const label = `${HINT_INDENT}${name}${span ? ` (${span})` : ''}`;
            const hint = new InlayHint(pos, label, InlayHintKind.Type);
            hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            break;
          } else if (sources.has(id)) {
            const s = sources.get(id)!;
            const title = s.titles?.[0]?.value ?? 'Source';
            const label = `${HINT_INDENT}${title}`;
            const hint = new InlayHint(pos, label, InlayHintKind.Type);
            hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            break;
          } else if (agents.has(id)) {
            const a = agents.get(id)!;
            const name = a.names?.[0]?.value ?? 'Agent';
            const label = `${HINT_INDENT}${name}`;
            const hint = new InlayHint(pos, label, InlayHintKind.Type);
            hint.tooltip = new MarkdownString(buildRecordTooltip(analysis, id));
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            break;
          }
        }
      }
    }

    // 2. Coded Value Inlay Hints (Gender, Relationship types)
    if (enabledValues) {
      const genderRegex =
        /(?:gender[^>}]*?type|type)["\s:=]+"?https?:\/\/gedcomx\.org\/(Male|Female|Unknown)"?/i;
      const coupleRegex = /(?:type)["\s:=]+"?https?:\/\/gedcomx\.org\/Couple"?/i;
      const parentChildRegex = /(?:type)["\s:=]+"?https?:\/\/gedcomx\.org\/ParentChild"?/i;

      for (let l = startLine; l <= endLine; l++) {
        if (annotatedLines.has(l)) continue;
        const lineText = document.lineAt(l).text;
        const gMatch = genderRegex.exec(lineText);
        if (gMatch) {
          const val = formatValueHint(gMatch[1]!);
          if (val) {
            const label = `${HINT_INDENT}${val}`;
            const pos = new Position(l, lineText.length);
            const hint = new InlayHint(pos, label, InlayHintKind.Parameter);
            hint.tooltip = new MarkdownString(`**${val}** (Gender value)`);
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            continue;
          }
        }

        if (coupleRegex.test(lineText)) {
          const val = formatValueHint('Couple');
          if (val) {
            const label = `${HINT_INDENT}${val}`;
            const pos = new Position(l, lineText.length);
            const hint = new InlayHint(pos, label, InlayHintKind.Parameter);
            hint.tooltip = new MarkdownString(`**${val}** (Relationship type)`);
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            continue;
          }
        }

        if (parentChildRegex.test(lineText)) {
          const val = formatValueHint('ParentChild');
          if (val) {
            const label = `${HINT_INDENT}${val}`;
            const pos = new Position(l, lineText.length);
            const hint = new InlayHint(pos, label, InlayHintKind.Parameter);
            hint.tooltip = new MarkdownString(`**${val}** (Relationship type)`);
            hint.paddingLeft = true;
            hints.push(hint);
            annotatedLines.add(l);
            continue;
          }
        }
      }
    }

    // 3. Age at Event End-of-Line Inlay Hints ("Died age 70", "Married age 25", etc.)
    if (enabledAges) {
      const spans = analysis.entitySpans ?? computeGedcomXEntitySpans(text, format);

      for (const p of gx.persons ?? []) {
        if (!p.id) continue;
        const birthDate = getFactDate(p.facts, 'birth');
        if (!birthDate) continue;

        const span = spans.find((s) => s.xref.includes(p.id!));
        const pStart = span?.startLine ?? 0;
        const pEnd = span?.endLine ?? document.lineCount - 1;

        for (const fact of p.facts ?? []) {
          if (!fact.type || fact.type.toLowerCase().includes('birth')) continue;
          const eventDate = fact.date?.original ?? fact.date?.formal;
          if (!eventDate) continue;

          const ageInfo = formatAgeAtEvent(birthDate, eventDate, fact.type);
          if (!ageInfo) continue;

          for (let l = pStart; l <= Math.min(pEnd, document.lineCount - 1); l++) {
            if (l < startLine || l > endLine) continue;
            if (annotatedLines.has(l)) continue;

            const lineText = document.lineAt(l).text;
            const matchesDate =
              (fact.date?.original && lineText.includes(fact.date.original)) ||
              (fact.date?.formal && lineText.includes(fact.date.formal)) ||
              (fact.date?.original && lineText.includes('date'));

            if (matchesDate) {
              annotatedLines.add(l);
              const pos = new Position(l, lineText.length);
              const hint = new InlayHint(
                pos,
                `${HINT_INDENT}${ageInfo.label}`,
                InlayHintKind.Parameter,
              );
              hint.tooltip = new MarkdownString(ageInfo.tooltip);
              hint.paddingLeft = true;
              hints.push(hint);
              break;
            }
          }
        }
      }

      // Couple relationships marriages
      for (const rel of gx.relationships ?? []) {
        if (!rel.type?.includes('Couple') || !rel.facts) continue;
        const p1Id = rel.person1?.resource?.replace(/^#/, '');
        const p2Id = rel.person2?.resource?.replace(/^#/, '');
        const b1 = p1Id ? getFactDate(persons.get(p1Id)?.facts, 'birth') : undefined;
        const b2 = p2Id ? getFactDate(persons.get(p2Id)?.facts, 'birth') : undefined;

        for (const fact of rel.facts) {
          const marrDate = fact.date?.original ?? fact.date?.formal;
          if (!marrDate) continue;

          let label: string | undefined;
          let tooltip: string | undefined;

          if (b1 && b2) {
            const age1 = formatAgeAtEvent(b1, marrDate, 'Marriage');
            const age2 = formatAgeAtEvent(b2, marrDate, 'Marriage');
            if (age1 && age2) {
              const num1 = ageAt(b1, marrDate)?.years;
              const num2 = ageAt(b2, marrDate)?.years;
              label = `Married (age ${num1}, age ${num2})`;
              tooltip = `**Married** (Calculated ages from spouses' birth dates)`;
            } else if (age1) {
              label = age1.label;
              tooltip = age1.tooltip;
            } else if (age2) {
              label = age2.label;
              tooltip = age2.tooltip;
            }
          } else if (b1) {
            const a = formatAgeAtEvent(b1, marrDate, 'Marriage');
            label = a?.label;
            tooltip = a?.tooltip;
          } else if (b2) {
            const a = formatAgeAtEvent(b2, marrDate, 'Marriage');
            label = a?.label;
            tooltip = a?.tooltip;
          }

          if (label && tooltip) {
            for (let l = startLine; l <= endLine; l++) {
              if (annotatedLines.has(l)) continue;
              const lineText = document.lineAt(l).text;
              if (
                (fact.date?.original && lineText.includes(fact.date.original)) ||
                (fact.date?.formal && lineText.includes(fact.date.formal))
              ) {
                annotatedLines.add(l);
                const pos = new Position(l, lineText.length);
                const hint = new InlayHint(pos, `${HINT_INDENT}${label}`, InlayHintKind.Parameter);
                hint.tooltip = new MarkdownString(tooltip);
                hint.paddingLeft = true;
                hints.push(hint);
                break;
              }
            }
          }
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDefinitionLocation(document: TextDocument, id: string): Location | null {
  const cleanId = id.replace(/^#/, '');
  const escaped = escapeRegex(cleanId);
  const defRegex = new RegExp(`(?:id)["\\s:=]+["']${escaped}["']`);

  for (let l = 0; l < document.lineCount; l++) {
    const lineText = document.lineAt(l).text;
    const match = defRegex.exec(lineText);
    if (match) {
      const start = match.index;
      const end = match.index + match[0].length;
      return new Location(document.uri, new Range(l, start, l, end));
    }
  }

  const xmlTagRegex = new RegExp(`<[a-zA-Z0-9_-]+[^>]*\\bid=["']${escaped}["']`);
  for (let l = 0; l < document.lineCount; l++) {
    const lineText = document.lineAt(l).text;
    const match = xmlTagRegex.exec(lineText);
    if (match) {
      const start = match.index;
      const end = match.index + match[0].length;
      return new Location(document.uri, new Range(l, start, l, end));
    }
  }

  return null;
}

function getIdentifierAtPosition(document: TextDocument, position: Position): string | null {
  const lineText = document.lineAt(position.line).text;

  // Check if position is on #id reference
  const refRegex = /(?:resource|descriptionRef|about)?["\s:=]*#([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(lineText)) !== null) {
    if (position.character >= match.index && position.character <= match.index + match[0].length) {
      return match[1]!;
    }
  }

  // Check if position is on id definition
  const defRegex = /(?:id)["\s:=]+["']([a-zA-Z0-9_-]+)["']/g;
  while ((match = defRegex.exec(lineText)) !== null) {
    if (position.character >= match.index && position.character <= match.index + match[0].length) {
      return match[1]!;
    }
  }

  const wordRange = document.getWordRangeAtPosition(position, /#?[a-zA-Z0-9_-]+/);
  if (wordRange) {
    return document.getText(wordRange).replace(/^#/, '');
  }

  return null;
}

export class GedcomXDefinitionProvider implements DefinitionProvider {
  provideDefinition(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
  ): Location | Location[] | null {
    const text = document.getText();
    if (!isGedcomX(text)) return null;

    const lineText = document.lineAt(position.line).text;

    // 1. Is the cursor on a reference pointer (#id, resource="#id", descriptionRef="#id")?
    const refRegex = /(?:resource|descriptionRef|about)?["\s:=]*#([a-zA-Z0-9_-]+)/g;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(lineText)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      if (position.character >= matchStart && position.character <= matchEnd) {
        const id = match[1]!;
        const defLoc = findDefinitionLocation(document, id);
        if (defLoc) return defLoc;
      }
    }

    // 2. Is the cursor on an ID definition (id="...", "id": "...")?
    const defRegex = /(?:id)["\s:=]+["']([a-zA-Z0-9_-]+)["']/g;
    while ((match = defRegex.exec(lineText)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      if (position.character >= matchStart && position.character <= matchEnd) {
        const id = match[1]!;
        const defLoc = findDefinitionLocation(document, id);
        if (defLoc) return defLoc;
      }
    }

    // 3. Fallback: check word at position if it starts with # or matches an ID
    const wordRange = document.getWordRangeAtPosition(position, /#?[a-zA-Z0-9_-]+/);
    if (wordRange) {
      const rawWord = document.getText(wordRange).replace(/^#/, '');
      const defLoc = findDefinitionLocation(document, rawWord);
      if (defLoc && defLoc.range.start.line !== position.line) return defLoc;
    }

    return null;
  }
}

export class GedcomXReferenceProvider implements ReferenceProvider {
  provideReferences(
    document: TextDocument,
    position: Position,
    context: ReferenceContext,
    _token: CancellationToken,
  ): Location[] {
    const text = document.getText();
    if (!isGedcomX(text)) return [];

    const id = getIdentifierAtPosition(document, position);
    if (!id) return [];

    const locations: Location[] = [];

    if (context.includeDeclaration) {
      const defLoc = findDefinitionLocation(document, id);
      if (defLoc) locations.push(defLoc);
    }

    const refRegex = new RegExp(
      `(?:resource|descriptionRef|about)?["\\s:=]*#${escapeRegex(id)}(?![a-zA-Z0-9_-])`,
      'g',
    );

    for (let l = 0; l < document.lineCount; l++) {
      const lineText = document.lineAt(l).text;
      let match: RegExpExecArray | null;
      refRegex.lastIndex = 0;
      while ((match = refRegex.exec(lineText)) !== null) {
        const startChar = match.index;
        const endChar = match.index + match[0].length;
        locations.push(new Location(document.uri, new Range(l, startChar, l, endChar)));
      }
    }

    return locations;
  }
}

export class GedcomXDocumentHighlightProvider implements DocumentHighlightProvider {
  provideDocumentHighlights(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
  ): DocumentHighlight[] {
    const text = document.getText();
    if (!isGedcomX(text)) return [];

    const id = getIdentifierAtPosition(document, position);
    if (!id) return [];

    const highlights: DocumentHighlight[] = [];

    const defLoc = findDefinitionLocation(document, id);
    if (defLoc) {
      highlights.push(new DocumentHighlight(defLoc.range, DocumentHighlightKind.Write));
    }

    const refRegex = new RegExp(
      `(?:resource|descriptionRef|about)?["\\s:=]*#${escapeRegex(id)}(?![a-zA-Z0-9_-])`,
      'g',
    );
    for (let l = 0; l < document.lineCount; l++) {
      const lineText = document.lineAt(l).text;
      let match: RegExpExecArray | null;
      refRegex.lastIndex = 0;
      while ((match = refRegex.exec(lineText)) !== null) {
        const startChar = match.index;
        const endChar = match.index + match[0].length;
        highlights.push(
          new DocumentHighlight(new Range(l, startChar, l, endChar), DocumentHighlightKind.Read),
        );
      }
    }

    return highlights;
  }
}

export class GedcomXDocumentLinkProvider implements DocumentLinkProvider {
  provideDocumentLinks(document: TextDocument, _token: CancellationToken): DocumentLink[] {
    const text = document.getText();
    if (!isGedcomX(text)) return [];

    const links: DocumentLink[] = [];
    const urlRegex = /https?:\/\/[^\s"'>]+/g;
    const refRegex = /(?:resource|descriptionRef|about)["\s:=]+["']?#([a-zA-Z0-9_-]+)["']?/g;

    for (let l = 0; l < document.lineCount; l++) {
      const lineText = document.lineAt(l).text;

      // Internal #id links (jump to definition on Ctrl+Click)
      let match: RegExpExecArray | null;
      refRegex.lastIndex = 0;
      while ((match = refRegex.exec(lineText)) !== null) {
        const id = match[1]!;
        const defLoc = findDefinitionLocation(document, id);
        if (defLoc) {
          const hashIdx = lineText.indexOf('#' + id, match.index);
          const start = hashIdx >= 0 ? hashIdx : match.index;
          const end = start + ('#' + id).length;
          const range = new Range(l, start, l, end);
          const link = new DocumentLink(
            range,
            document.uri.with({ fragment: `L${defLoc.range.start.line + 1}` }),
          );
          link.tooltip = `Jump to definition of ${id}`;
          links.push(link);
        }
      }

      // External http:// URLs
      urlRegex.lastIndex = 0;
      while ((match = urlRegex.exec(lineText)) !== null) {
        const urlStr = match[0];
        if (urlStr.startsWith('http://gedcomx.org')) continue;
        try {
          const uri = Uri.parse(urlStr);
          const range = new Range(l, match.index, l, match.index + urlStr.length);
          links.push(new DocumentLink(range, uri));
        } catch {
          // ignore invalid URLs
        }
      }
    }

    return links;
  }
}

export function registerGedcomXInsights(context: ExtensionContext, log: Log): Disposable[] {
  log.info('Registering GEDCOM X inline insights (hover, inlay hints, code lenses, navigation)');

  const disposables: Disposable[] = [
    languages.registerHoverProvider(DOCUMENT_SELECTOR, new GedcomXHoverProvider()),
    languages.registerInlayHintsProvider(DOCUMENT_SELECTOR, new GedcomXInlayHintsProvider()),
    languages.registerCodeLensProvider(DOCUMENT_SELECTOR, new GedcomXCodeLensProvider()),
    languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new GedcomXDefinitionProvider()),
    languages.registerReferenceProvider(DOCUMENT_SELECTOR, new GedcomXReferenceProvider()),
    languages.registerDocumentHighlightProvider(
      DOCUMENT_SELECTOR,
      new GedcomXDocumentHighlightProvider(),
    ),
    languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new GedcomXDocumentLinkProvider()),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}
