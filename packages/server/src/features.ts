/**
 * Language features, as pure functions over an analysis.
 *
 * Nothing here touches a connection or a transport, so every feature is testable
 * without starting a server — and the same code serves both the Node extension
 * host and the browser worker.
 *
 * All of it is a projection of `packages/core`. If a feature needs information
 * the parser does not expose, the parser is what should change.
 */

import {
  analyzeText,
  asPointer,
  completionsFor,
  fullSpan,
  isExtensionTag,
  labelOf,
  modelFor,
  payloadOf,
  walk,
  type Analysis,
  type Diagnostic as CoreDiagnostic,
  type Span,
  type Structure,
} from '@vscode-gedcom/core';

import {
  CompletionItemKind,
  DiagnosticSeverity,
  FoldingRangeKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentHighlight,
  type FoldingRange,
  type Hover,
  type Location,
  type Position,
  type Range,
  type DocumentSymbol,
  type SemanticTokensLegend,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver-types';

// --- span conversion --------------------------------------------------------

export const toRange = (span: Span): Range => ({
  start: { line: span.line, character: span.start },
  end: { line: span.line, character: span.end },
});

const contains = (span: Span, position: Position): boolean =>
  span.line === position.line && position.character >= span.start && position.character <= span.end;

// --- diagnostics ------------------------------------------------------------

const SEVERITY = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
} as const;

export function diagnostics(analysis: Analysis): Diagnostic[] {
  return analysis.diagnostics.map((d: CoreDiagnostic) => ({
    range: toRange(d.span),
    message: d.message,
    severity: SEVERITY[d.severity],
    code: d.code,
    source: 'gedcom',
  }));
}

// --- navigation -------------------------------------------------------------

/** The pointer reference under a position, if any. */
function referenceAt(analysis: Analysis, position: Position) {
  return analysis.xrefs.references.find((r) => contains(r.span, position));
}

/** The record whose identifier is under a position, if any. */
function definitionUnder(analysis: Analysis, position: Position): Structure | undefined {
  return analysis.document.structures.find(
    (s) => s.xrefSpan !== null && contains(s.xrefSpan, position),
  );
}

/** The identifier addressed by a position, whether written as a definition or a use. */
export function xrefAt(analysis: Analysis, position: Position): string | undefined {
  return (
    referenceAt(analysis, position)?.xref ?? definitionUnder(analysis, position)?.xref ?? undefined
  );
}

export function definition(analysis: Analysis, uri: string, position: Position): Location | null {
  const reference = referenceAt(analysis, position);
  if (!reference) return null;

  const target = analysis.xrefs.definitions.get(reference.xref);
  if (!target?.xrefSpan) return null;

  return { uri, range: toRange(target.xrefSpan) };
}

export function references(
  analysis: Analysis,
  uri: string,
  position: Position,
  includeDeclaration: boolean,
): Location[] {
  const xref = xrefAt(analysis, position);
  if (xref === undefined) return [];

  const locations: Location[] = (analysis.xrefs.referencesTo.get(xref) ?? []).map((r) => ({
    uri,
    range: toRange(r.span),
  }));

  if (includeDeclaration) {
    const target = analysis.xrefs.definitions.get(xref);
    if (target?.xrefSpan) locations.unshift({ uri, range: toRange(target.xrefSpan) });
  }

  return locations;
}

export function documentHighlights(analysis: Analysis, position: Position): DocumentHighlight[] {
  const xref = xrefAt(analysis, position);
  if (xref === undefined) return [];

  const highlights: DocumentHighlight[] = [];
  const target = analysis.xrefs.definitions.get(xref);
  if (target?.xrefSpan) highlights.push({ range: toRange(target.xrefSpan), kind: 1 });
  for (const r of analysis.xrefs.referencesTo.get(xref) ?? []) {
    highlights.push({ range: toRange(r.span), kind: 2 });
  }
  return highlights;
}

// --- rename -----------------------------------------------------------------

/**
 * Renaming a cross-reference identifier is the one refactor GEDCOM really needs,
 * and the index makes it exact: rewrite the definition and every pointer at once.
 */
export function renameEdits(
  analysis: Analysis,
  uri: string,
  position: Position,
  newName: string,
): WorkspaceEdit | null {
  const xref = xrefAt(analysis, position);
  if (xref === undefined) return null;

  const clean = newName.replace(/^@|@$/g, '');
  if (clean.length === 0) return null;

  const edits: TextEdit[] = [];
  const target = analysis.xrefs.definitions.get(xref);
  if (target?.xrefSpan) {
    // The stored span covers the at-signs; the identifier sits between them.
    edits.push({
      range: toRange({
        ...target.xrefSpan,
        start: target.xrefSpan.start + 1,
        end: target.xrefSpan.end - 1,
      }),
      newText: clean,
    });
  }
  for (const r of analysis.xrefs.referencesTo.get(xref) ?? []) {
    edits.push({ range: toRange(r.span), newText: clean });
  }

  return edits.length > 0 ? { changes: { [uri]: edits } } : null;
}

// --- hover ------------------------------------------------------------------

/**
 * A one-line description of a record, for hovers, the outline and completion.
 *
 * Given an analysis it resolves spouse pointers, so a family reads
 * `John Smith + Jane Doe` rather than `@I1@ + @I2@` — the identifiers are what
 * the reader is trying to look up, not what they want to be told.
 */
export function summarize(record: Structure, analysis?: Analysis): string {
  const name = record.children.find((c) => c.tag === 'NAME')?.payload;
  if (name) return name.replace(/\//g, '');

  const title = record.children.find((c) => c.tag === 'TITL')?.payload;
  if (title) return title;

  if (record.payload) return record.payload.split('\n')[0]!.slice(0, 60);

  const spouse = (tag: string): string | undefined => {
    const structure = record.children.find((c) => c.tag === tag);
    if (!structure) return undefined;

    const pointer = asPointer(structure);
    if (pointer === null || !analysis) return structure.payload ?? undefined;

    const target = analysis.xrefs.definitions.get(pointer);
    const targetName = target?.children.find((c) => c.tag === 'NAME')?.payload;
    return targetName?.replace(/\//g, '') ?? structure.payload ?? undefined;
  };

  const husband = spouse('HUSB');
  const wife = spouse('WIFE');
  if (husband ?? wife) return `${husband ?? '?'} + ${wife ?? '?'}`;

  return record.tag;
}

export function hover(analysis: Analysis, position: Position): Hover | null {
  // Pointers are checked first: a pointer lives in the payload, which is outside
  // both the tag and xref spans, so looking up the structure first would miss it.
  const reference = referenceAt(analysis, position);
  if (reference) {
    const target = analysis.xrefs.definitions.get(reference.xref);
    const value = target
      ? [`**${target.tag}** \`@${reference.xref}@\``, '', summarize(target, analysis)].join('\n')
      : `\`@${reference.xref}@\` — no matching record in this document.`;
    return { contents: { kind: 'markdown', value }, range: toRange(reference.span) };
  }

  const structure = analysis.document.structures.find(
    (s) => contains(s.tagSpan, position) || (s.xrefSpan && contains(s.xrefSpan, position)),
  );
  if (!structure) return null;

  const model = modelFor(analysis.version);
  const lines: string[] = [];

  const resolution = analysis.validation.resolutions.get(structure);
  const label = resolution?.slug ? labelOf(model, resolution.slug) : undefined;

  lines.push(`**${structure.tag}**${label ? ` — ${label}` : ''}`);

  if (structure.xref !== null) {
    const uses = analysis.xrefs.referencesTo.get(structure.xref)?.length ?? 0;
    lines.push('', `\`@${structure.xref}@\` — ${uses} reference${uses === 1 ? '' : 's'}`);
  }

  if (resolution?.slug) {
    const payload = payloadOf(model, resolution.slug);
    if (payload) {
      lines.push(
        '',
        payload.type === 'pointer'
          ? `Payload: pointer${payload.to ? ` to a \`${model.tags[payload.to] ?? payload.to}\` record` : ''}`
          : `Payload: \`${payload.type.replace(/^type-/, '')}\``,
      );
    }
  } else if (isExtensionTag(structure.tag)) {
    lines.push('', '_Extension tag._');
  } else {
    lines.push('', '_Not described by this version of the specification._');
  }

  return {
    contents: { kind: 'markdown', value: lines.join('\n') },
    range: toRange(structure.tagSpan),
  };
}

// --- outline ----------------------------------------------------------------

const SYMBOL_KIND: Record<string, SymbolKind> = {
  HEAD: SymbolKind.Namespace,
  TRLR: SymbolKind.Namespace,
  INDI: SymbolKind.Class,
  FAM: SymbolKind.Interface,
  SOUR: SymbolKind.File,
  REPO: SymbolKind.Package,
  OBJE: SymbolKind.File,
  SNOTE: SymbolKind.String,
  NOTE: SymbolKind.String,
  SUBM: SymbolKind.Constant,
};

export function documentSymbols(analysis: Analysis): DocumentSymbol[] {
  const build = (structure: Structure): DocumentSymbol => {
    const extent = fullSpan(structure);
    const range: Range = {
      start: { line: extent.start.line, character: 0 },
      end: { line: extent.end.line, character: Number.MAX_SAFE_INTEGER },
    };

    const detail =
      structure.level === 0
        ? summarize(structure, analysis)
        : (structure.payload?.split('\n')[0]?.slice(0, 60) ?? '');

    return {
      name: structure.xref !== null ? `${structure.tag} @${structure.xref}@` : structure.tag,
      detail,
      kind: SYMBOL_KIND[structure.tag] ?? SymbolKind.Field,
      range,
      selectionRange: toRange(structure.tagSpan),
      children: structure.children.map(build),
    };
  };

  return analysis.document.records.map(build);
}

// --- folding ----------------------------------------------------------------

/**
 * Folding follows level numbers, not indentation. GEDCOM lines all start at
 * column zero, so VS Code's default indentation-based folding does nothing.
 */
export function foldingRanges(analysis: Analysis): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  for (const record of analysis.document.records) {
    for (const structure of walk(record)) {
      const extent = fullSpan(structure);
      if (extent.end.line <= extent.start.line) continue;
      ranges.push({
        startLine: extent.start.line,
        endLine: extent.end.line,
        kind: FoldingRangeKind.Region,
      });
    }
  }

  return ranges;
}

// --- completion -------------------------------------------------------------

/**
 * Completion needs the context the user is *typing into*, which is not yet in
 * the tree. The level is read from the line prefix, then the enclosing structure
 * is the nearest preceding one at level - 1.
 */
export function completion(
  analysis: Analysis,
  position: Position,
  lineText: string,
): CompletionItem[] {
  const model = modelFor(analysis.version);
  const prefix = lineText.slice(0, position.character);

  const levelMatch = /^(\d+)[ \t]+/.exec(prefix);
  if (!levelMatch) return [];

  const level = Number(levelMatch[1]);

  // Walk past the level, and past an xref definition if one has been typed, to
  // see whether the cursor sits in tag position or payload position.
  let rest = prefix.slice(levelMatch[0].length);
  const xrefMatch = /^@[^@]*@[ \t]+/.exec(rest);
  if (xrefMatch) rest = rest.slice(xrefMatch[0].length);

  // Offering identifiers is only useful where a pointer can go, which is after
  // a tag rather than in place of one.
  const afterTag = /^[A-Za-z_][A-Za-z0-9_]*[ ]/.test(rest);
  if (afterTag) {
    return [...analysis.xrefs.definitions.entries()].map(([xref, record]) => ({
      label: `@${xref}@`,
      kind: CompletionItemKind.Reference,
      detail: `${record.tag} — ${summarize(record, analysis)}`,
      insertText: `@${xref}@`,
    }));
  }

  // The enclosing structure is the last one seen at the level above, before
  // this line.
  let parent: Structure | undefined;
  for (const structure of analysis.document.structures) {
    if (structure.span.line >= position.line) break;
    if (structure.level === level - 1) parent = structure;
  }

  const parentSlug = level === 0 ? null : analysis.validation.resolutions.get(parent!)?.slug;
  if (level > 0 && !parentSlug) return [];

  return completionsFor(model, parentSlug ?? null).map((tag) => {
    const entry = model.subs[parentSlug ?? '']?.[tag];
    const label = entry ? labelOf(model, entry.s) : undefined;
    return {
      label: tag,
      kind: CompletionItemKind.Property,
      detail: label,
      documentation: entry ? `Cardinality ${entry.c}` : undefined,
    };
  });
}

// --- semantic tokens --------------------------------------------------------

/**
 * Semantic tokens carry what a regular expression cannot know: whether a tag is
 * valid *in this position*, and whether a pointer resolves. The TextMate grammar
 * only ever sees a flat vocabulary.
 */
export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: ['number', 'property', 'macro', 'class', 'variable', 'keyword', 'string'],
  tokenModifiers: ['declaration', 'defaultLibrary', 'deprecated'],
};

const TYPE = Object.fromEntries(
  semanticTokensLegend.tokenTypes.map((name, index) => [name, index]),
) as Record<string, number>;

const MOD = Object.fromEntries(
  semanticTokensLegend.tokenModifiers.map((name, index) => [name, 1 << index]),
) as Record<string, number>;

interface RawToken {
  line: number;
  start: number;
  length: number;
  type: number;
  modifiers: number;
}

export function semanticTokens(analysis: Analysis): number[] {
  const raw: RawToken[] = [];

  for (const structure of analysis.document.structures) {
    const resolution = analysis.validation.resolutions.get(structure);

    if (structure.xrefSpan) {
      raw.push({
        line: structure.xrefSpan.line,
        start: structure.xrefSpan.start + 1,
        length: structure.xrefSpan.end - structure.xrefSpan.start - 2,
        type: TYPE['class']!,
        modifiers: MOD['declaration']!,
      });
    }

    raw.push({
      line: structure.tagSpan.line,
      start: structure.tagSpan.start,
      length: structure.tagSpan.end - structure.tagSpan.start,
      type: isExtensionTag(structure.tag) ? TYPE['macro']! : TYPE['property']!,
      // The distinguishing bit: resolved means "legal here", not merely "a real tag".
      modifiers: resolution?.slug ? MOD['defaultLibrary']! : 0,
    });

    const pointer = asPointer(structure);
    if (pointer !== null && structure.payloadSpan) {
      const resolved = analysis.xrefs.definitions.has(pointer);
      raw.push({
        line: structure.payloadSpan.line,
        start: structure.payloadSpan.start + 1,
        length: structure.payloadSpan.end - structure.payloadSpan.start - 2,
        type: pointer === 'VOID' ? TYPE['keyword']! : TYPE['variable']!,
        modifiers: pointer !== 'VOID' && !resolved ? MOD['deprecated']! : 0,
      });
    }
  }

  raw.sort((a, b) => a.line - b.line || a.start - b.start);

  // Encode as LSP's delta-compressed quintuples.
  const data: number[] = [];
  let lastLine = 0;
  let lastStart = 0;
  for (const token of raw) {
    if (token.length <= 0) continue;
    const deltaLine = token.line - lastLine;
    const deltaStart = deltaLine === 0 ? token.start - lastStart : token.start;
    data.push(deltaLine, deltaStart, token.length, token.type, token.modifiers);
    lastLine = token.line;
    lastStart = token.start;
  }
  return data;
}

// --- entry point ------------------------------------------------------------

export interface Settings {
  /**
   * `auto` follows the file's own version: strict for GEDCOM 7, lenient for
   * 5.5.x and for files too old or damaged to identify.
   */
  readonly strictness: 'auto' | 'strict' | 'lenient';
}

export const defaultSettings: Settings = { strictness: 'auto' };

export function analyzeDocument(text: string, settings: Settings = defaultSettings): Analysis {
  return analyzeText(
    text,
    settings.strictness === 'auto' ? {} : { strictness: settings.strictness },
  );
}
