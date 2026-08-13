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
  describePayloadType,
  fullSpan,
  glossOf,
  isExtensionTag,
  isRemovedInVersion,
  modelFor,
  payloadOf,
  tagLabel,
  relationsOf,
  removalNote,
  resolveSubstructure,
  scanDate,
  statistics,
  walk,
  lifespan,
  type Analysis,
  type Diagnostic as CoreDiagnostic,
  type Span,
  type Structure,
} from '@vscode-gedcom/core';

import { annotate, describeStructure, type AnnotationKinds } from './describe.ts';

import {
  CompletionItemKind,
  DiagnosticSeverity,
  FoldingRangeKind,
  InlayHintKind,
  SymbolKind,
  type CodeLens,
  type CompletionItem,
  type Diagnostic,
  type DocumentHighlight,
  type DocumentLink,
  type FoldingRange,
  type Hover,
  type InlayHint,
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

/**
 * What is worth saying about a record, beyond its name.
 *
 * Different records answer different questions. For a person the reader wants to
 * know their shape in the tree — how many children, whether they married more
 * than once, how many siblings — none of which the file states directly. For a
 * source they want to know how much of the tree leans on it.
 */
function describeRecord(analysis: Analysis, record: Structure): string[] {
  const lines: string[] = [];
  const xref = record.xref;
  if (xref === null) return lines;

  if (record.tag === 'INDI') {
    const span = lifespan(analysis, xref);
    const sex = record.children.find((c) => c.tag === 'SEX')?.payload;
    const facts = [sex, span].filter(Boolean);
    if (facts.length) lines.push(facts.join(' · '));

    const relations = relationsOf(analysis, xref);
    const counts: string[] = [];
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

    if (relations.parents.length)
      counts.push(plural(relations.parents.length, 'parent', 'parents'));
    if (relations.siblings.length) {
      counts.push(plural(relations.siblings.length, 'sibling', 'siblings'));
    }
    if (relations.spouses.length)
      counts.push(plural(relations.spouses.length, 'spouse', 'spouses'));
    if (relations.children.length)
      counts.push(plural(relations.children.length, 'child', 'children'));

    if (counts.length) lines.push(counts.join(' · '));
    else lines.push('_No family recorded._');
    return lines;
  }

  if (record.tag === 'FAM') {
    const children = record.children.filter((c) => c.tag === 'CHIL').length;
    const marriage = record.children
      .find((c) => c.tag === 'MARR')
      ?.children.find((c) => c.tag === 'DATE')?.payload;

    if (marriage) lines.push(`Married ${marriage}`);
    lines.push(children === 1 ? '1 child' : `${children} children`);
    return lines;
  }

  if (record.tag === 'SOUR' || record.tag === 'REPO' || record.tag === 'SNOTE') {
    const uses = analysis.xrefs.referencesTo.get(xref)?.length ?? 0;
    lines.push(
      uses === 0 ? '_Cited nowhere in this file._' : `Cited ${uses} time${uses === 1 ? '' : 's'}`,
    );
    return lines;
  }

  return lines;
}

export function hover(analysis: Analysis, position: Position): Hover | null {
  // Pointers are checked first: a pointer lives in the payload, which is outside
  // both the tag and xref spans, so looking up the structure first would miss it.
  const reference = referenceAt(analysis, position);
  if (reference) {
    const target = analysis.xrefs.definitions.get(reference.xref);
    const model = modelFor(analysis.version);
    const value = target
      ? [
          `**${tagLabel(model, target.tag, analysis.validation.resolutions.get(target)?.slug)}** ` +
            `\`@${reference.xref}@\``,
          '',
          summarize(target, analysis),
          ...describeRecord(analysis, target),
        ].join('\n')
      : `\`@${reference.xref}@\` — no matching record in this document.`;
    return { contents: { kind: 'markdown', value }, range: toRange(reference.span) };
  }

  // The payload is checked before the tag, so hovering the value of an enumerated
  // or computed payload explains the value rather than restating the tag.
  const structure =
    analysis.document.structures.find(
      (s) => contains(s.tagSpan, position) || (s.xrefSpan && contains(s.xrefSpan, position)),
    ) ??
    analysis.document.structures.find((s) => s.payloadSpan && contains(s.payloadSpan, position));
  if (!structure) return null;

  const model = modelFor(analysis.version);
  const lines: string[] = [];

  const resolution = analysis.validation.resolutions.get(structure);

  // The English name leads and the tag follows in code. The reader hovering a
  // tag is asking what it means, and the tag is the part they can already see.
  const name = tagLabel(model, structure.tag, resolution?.slug);
  lines.push(
    name === structure.tag ? `**${structure.tag}**` : `**${name}** — \`${structure.tag}\``,
  );

  if (structure.xref !== null) {
    const uses = analysis.xrefs.referencesTo.get(structure.xref)?.length ?? 0;
    lines.push('', `\`@${structure.xref}@\` — ${uses} reference${uses === 1 ? '' : 's'}`);

    const described = describeRecord(analysis, structure);
    if (described.length) lines.push('', ...described);
  }

  // What the tag is for. It leads because it is the question being asked; what
  // the payload happens to be typed as is a detail beneath it.
  const gloss = glossOf(structure.tag, resolution?.slug);
  if (gloss) lines.push('', gloss);

  // Everything the verb itself is worth saying, given its position in the tree.
  const described = describeStructure(analysis, structure, resolution?.slug);
  if (described.length) lines.push('', ...described);

  // A tag the target version dropped is the single most actionable thing that can
  // be said about a line, because it comes with what to write instead.
  const removal = removalNote(analysis.version, structure.tag);
  if (removal) lines.push('', `⚠️ ${removal}`);

  if (resolution?.slug) {
    const payload = payloadOf(model, resolution.slug);
    if (payload) {
      if (payload.type === 'pointer') {
        // Named in English first, with the tag in brackets. `a NOTE record` asks
        // the reader to already know the vocabulary they came here to look up.
        const tag = payload.to ? (model.tags[payload.to] ?? payload.to) : undefined;
        const named = tag ? tagLabel(model, tag, payload.to) : undefined;
        lines.push(
          '',
          named && tag
            ? `Points at a **${named}** record (\`${tag}\`).`
            : 'Points at another record.',
        );
      } else {
        const described = describePayloadType(payload.type);
        // "Text." on its own is the emptiest thing a hover can say: the reader
        // can see that the line holds text. Where the glossary has a sentence
        // about the tag, that sentence replaces it; a payload type worth naming —
        // a date, an integer, a media type — is still named.
        if (gloss && described.summary === 'Text' && !described.example) {
          // The gloss above has already said what belongs here.
        } else {
          lines.push(
            '',
            `${described.summary}${described.example ? ` — for example \`${described.example}\`` : ''}.`,
          );
        }
      }
    } else {
      lines.push('', 'Takes no payload; the substructures below carry the content.');
    }

    const cardinality = cardinalityOf(analysis, structure);
    if (cardinality) lines.push('', `_${cardinality}._`);
  } else if (isExtensionTag(structure.tag)) {
    lines.push('', '_Extension tag._');
  } else if (!removal) {
    lines.push('', '_Not described by this version of the specification._');
  }

  return {
    contents: { kind: 'markdown', value: lines.join('\n') },
    range: toRange(structure.tagSpan),
  };
}

/**
 * How many times a structure may appear where it does, in words.
 *
 * `{1:1}` is unreadable and says something a reader genuinely wants: whether this
 * line is required, and whether writing a second one would be a mistake.
 */
function cardinalityOf(analysis: Analysis, structure: Structure): string | undefined {
  const parent = structure.parent;
  const parentSlug = parent ? analysis.validation.resolutions.get(parent)?.slug : null;
  if (parent && !parentSlug) return undefined;

  const model = modelFor(analysis.version);
  const resolved = resolveSubstructure(model, parentSlug ?? null, structure.tag);
  if (!resolved) return undefined;

  const { min, max } = resolved.cardinality;
  if (min === 1 && max === 1) return 'Required, exactly one';
  if (min === 1 && max === Infinity) return 'Required, one or more';
  if (min === 0 && max === 1) return 'Optional, at most one';
  if (min === 0 && max === Infinity) return 'Optional, any number';
  return `Cardinality ${min} to ${max === Infinity ? 'many' : max}`;
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
    // LSP's `uinteger` tops out at 2^31 - 1. `Number.MAX_SAFE_INTEGER` exceeds
    // it, which makes the whole symbol fail protocol validation — the client then
    // reads the response as SymbolInformation and throws. VS Code clamps a
    // too-large end column to the real line length, so this is the usual idiom
    // for "to the end of the line".
    const END_OF_LINE = 2 ** 31 - 1;

    const range: Range = {
      start: { line: extent.start.line, character: 0 },
      end: { line: extent.end.line, character: END_OF_LINE },
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
    // The English name as the detail line, so the list can be read by meaning
    // rather than by recognising four-letter tags.
    const label = tagLabel(model, tag, entry?.s);
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
  tokenTypes: ['number', 'property', 'macro', 'class', 'variable', 'keyword', 'string', 'operator'],
  tokenModifiers: [
    'declaration',
    'defaultLibrary',
    'deprecated',
    // Custom modifiers. Themes will not colour these on their own, so
    // `contributes.semanticTokenScopes` in package.json maps each to a TextMate
    // scope that themes already understand.
    'uncertain',
    'unreferenced',
    'individual',
    'family',
    'source',
  ],
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

/**
 * Which record a structure belongs to, so its substructures can carry a signal
 * from it. Only the record types worth distinguishing get a modifier — tinting
 * everything would be noise rather than information.
 */
const RECORD_MODIFIER: Record<string, string> = {
  INDI: 'individual',
  FAM: 'family',
  SOUR: 'source',
};

function recordModifiers(analysis: Analysis): Map<Structure, number> {
  const byStructure = new Map<Structure, number>();
  for (const record of analysis.document.records) {
    const name = RECORD_MODIFIER[record.tag];
    if (!name) continue;
    const bit = MOD[name]!;
    for (const structure of walk(record)) byStructure.set(structure, bit);
  }
  return byStructure;
}

export function semanticTokens(analysis: Analysis): number[] {
  const raw: RawToken[] = [];
  const tint = recordModifiers(analysis);

  for (const structure of analysis.document.structures) {
    const resolution = analysis.validation.resolutions.get(structure);
    const inRecord = tint.get(structure) ?? 0;

    if (structure.xrefSpan) {
      // A record nothing points at is a dead end. Worth seeing while reading,
      // rather than only in a separate report.
      const unreferenced =
        structure.xref !== null &&
        (analysis.xrefs.referencesTo.get(structure.xref)?.length ?? 0) === 0;

      raw.push({
        line: structure.xrefSpan.line,
        start: structure.xrefSpan.start + 1,
        length: structure.xrefSpan.end - structure.xrefSpan.start - 2,
        type: TYPE['class']!,
        modifiers: MOD['declaration']! | (unreferenced ? MOD['unreferenced']! : 0) | inRecord,
      });
    }

    // A tag the target version removed is not merely unknown: it had a meaning
    // that this version dropped. Themes render `deprecated` struck through,
    // which is exactly the signal wanted when migrating a file.
    const removed = isRemovedInVersion(analysis.version, structure.tag);

    raw.push({
      line: structure.tagSpan.line,
      start: structure.tagSpan.start,
      length: structure.tagSpan.end - structure.tagSpan.start,
      type: isExtensionTag(structure.tag) ? TYPE['macro']! : TYPE['property']!,
      // The distinguishing bit: resolved means "legal here", not merely "a real tag".
      modifiers:
        (resolution?.slug ? MOD['defaultLibrary']! : 0) |
        (removed ? MOD['deprecated']! : 0) |
        inRecord,
    });

    const pointer = asPointer(structure);
    if (pointer !== null && structure.payloadSpan) {
      const resolved = analysis.xrefs.definitions.has(pointer);
      raw.push({
        line: structure.payloadSpan.line,
        start: structure.payloadSpan.start + 1,
        length: structure.payloadSpan.end - structure.payloadSpan.start - 2,
        type: pointer === 'VOID' ? TYPE['keyword']! : TYPE['variable']!,
        modifiers: (pointer !== 'VOID' && !resolved ? MOD['deprecated']! : 0) | inRecord,
      });
    }

    // Date qualifiers. Whether a date is known or guessed is one of the most
    // important distinctions in a genealogy file and the hardest to see, because
    // `ABT 1901` and `1901` are otherwise identical to the eye.
    if ((structure.tag === 'DATE' || structure.tag === 'SDATE') && structure.payloadSpan) {
      for (const keyword of scanDate(structure.payload ?? '')) {
        raw.push({
          line: structure.payloadSpan.line,
          start: structure.payloadSpan.start + keyword.start,
          length: keyword.end - keyword.start,
          type: TYPE['operator']!,
          modifiers: (keyword.qualifier === 'uncertain' ? MOD['uncertain']! : 0) | inRecord,
        });
      }
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

// --- inlay hints ------------------------------------------------------------

/**
 * The single largest thing that can be done for readability.
 *
 * A GEDCOM file is mostly identifiers. `1 FAMS @F1@` is three tokens of which the
 * one carrying the meaning is opaque, and following it means jumping elsewhere in
 * the file and then finding your way back. Rendering the answer at the end of the
 * line removes that trip for every pointer at once.
 *
 * The other two kinds answer the same shape of question — a code standing in for
 * something the reader would have to look up — for enumerations and for ages.
 */
/** Non-breaking, so the client does not collapse it the way it would spaces. */
const HINT_INDENT = '   ';

export function inlayHints(analysis: Analysis, range: Range, settings: Settings): InlayHint[] {
  const kinds = settings.inlayHints;
  if (!kinds.pointers && !kinds.values && !kinds.ages) return [];

  const hints: InlayHint[] = [];

  for (const structure of analysis.document.structures) {
    const span = structure.payloadSpan;
    if (!span) continue;
    if (span.line < range.start.line || span.line > range.end.line) continue;
    // A folded payload ends on a later line than the one the span describes, so
    // an annotation pinned here would land in the middle of the text.
    if (structure.continuationLines.length > 0) continue;

    const slug = analysis.validation.resolutions.get(structure)?.slug;
    const label = annotate(analysis, structure, slug, kinds, (record) =>
      summarize(record, analysis),
    );
    if (!label) continue;

    hints.push({
      position: { line: span.line, character: span.end },
      // Set apart from the payload it annotates. Butted up against the line, an
      // inlay hint reads as part of the data — as though the file itself said
      // `1 SEX M male`. The gap is non-breaking spaces because `paddingLeft`
      // yields a single space and ordinary ones would collapse.
      label: `${HINT_INDENT}${label}`,
      kind: InlayHintKind.Parameter,
      paddingLeft: true,
    });
  }

  return hints;
}

// --- code lens --------------------------------------------------------------

/** Client-side command that converts LSP locations before peeking them. */
const SHOW_REFERENCES = 'gedcom.showReferences';
const SHOW_GRAPH = 'gedcom.showGraph';

/**
 * A summary line above each record.
 *
 * The space above a record is the only place in the file with room for something
 * derived rather than stored. What goes there is what the record does not say
 * about itself: how many people depend on it, and what shape it has in the tree.
 */
export function codeLenses(analysis: Analysis, uri: string, settings: Settings): CodeLens[] {
  if (!settings.codeLens.enabled) return [];

  const lenses: CodeLens[] = [];

  for (const record of analysis.document.records) {
    const range = toRange(record.tagSpan);

    if (record.tag === 'HEAD') {
      const stats = statistics(analysis);
      const counts = Object.entries(stats.records)
        .filter(([tag]) => tag !== 'HEAD' && tag !== 'TRLR')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([tag, count]) => `${count.toLocaleString('en')} ${tag}`);

      const period =
        stats.earliest !== undefined && stats.latest !== undefined
          ? `${stats.earliest}–${stats.latest}`
          : undefined;

      const title = [...counts, period].filter(Boolean).join(' · ');
      if (title) lenses.push({ range, command: { title, command: '' } });
      continue;
    }

    if (record.xref === null) continue;

    const summary = describeRecord(analysis, record)
      .filter((line) => !line.startsWith('_'))
      .join(' · ');
    if (summary) lenses.push({ range, command: { title: summary, command: '' } });

    const uses = analysis.xrefs.referencesTo.get(record.xref) ?? [];
    lenses.push({
      range,
      command: {
        title: uses.length === 1 ? '1 reference' : `${uses.length} references`,
        // Peeking nothing is confusing, so a record nothing points at gets an
        // inert lens rather than a command that appears to do nothing.
        command: uses.length > 0 ? SHOW_REFERENCES : '',
        arguments:
          uses.length > 0
            ? [uri, toRange(record.tagSpan).start, uses.map((use) => toRange(use.span))]
            : undefined,
      },
    });

    if (record.tag === 'INDI' || record.tag === 'FAM') {
      lenses.push({
        range,
        command: { title: 'graph', command: SHOW_GRAPH, arguments: [uri, record.span.line] },
      });
    }
  }

  return lenses;
}

// --- document links ---------------------------------------------------------

/**
 * Payloads that are addresses rather than text.
 *
 * GEDCOM has carried web addresses and email since long before either was
 * clickable anywhere, and a `1 WWW` line is one of the few payloads whose entire
 * purpose is to be followed.
 */
export function documentLinks(analysis: Analysis): DocumentLink[] {
  const links: DocumentLink[] = [];

  for (const structure of analysis.document.structures) {
    const span = structure.payloadSpan;
    const payload = structure.payload?.trim();
    if (!span || !payload || structure.continuationLines.length > 0) continue;

    const target =
      structure.tag === 'WWW' || structure.tag === 'FILE'
        ? /^https?:\/\//i.test(payload)
          ? payload
          : undefined
        : structure.tag === 'EMAIL' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload)
          ? `mailto:${payload}`
          : undefined;

    if (target) links.push({ range: toRange(span), target, tooltip: payload });
  }

  return links;
}

// --- entry point ------------------------------------------------------------

export interface Settings {
  /**
   * `auto` follows the file's own version: strict for GEDCOM 7, lenient for
   * 5.5.x and for files too old or damaged to identify.
   */
  readonly strictness: 'auto' | 'strict' | 'lenient';
  readonly inlayHints: AnnotationKinds;
  readonly codeLens: { readonly enabled: boolean };
}

export const defaultSettings: Settings = {
  strictness: 'auto',
  inlayHints: { pointers: true, values: true, ages: true },
  codeLens: { enabled: true },
};

/**
 * Merges incoming configuration over the defaults.
 *
 * The nested groups have to be merged explicitly, because a client that sends a
 * partial `inlayHints` object would otherwise drop the defaults for whatever it
 * left out. The shape mirrors the dotted setting names in package.json exactly,
 * which is how VS Code delivers a configuration section.
 */
export function resolveSettings(incoming: unknown): Settings {
  const section = (incoming ?? {}) as Partial<Settings>;
  return {
    ...defaultSettings,
    ...section,
    inlayHints: { ...defaultSettings.inlayHints, ...section.inlayHints },
    codeLens: { ...defaultSettings.codeLens, ...section.codeLens },
  };
}

export function analyzeDocument(text: string, settings: Settings = defaultSettings): Analysis {
  return analyzeText(
    text,
    settings.strictness === 'auto' ? {} : { strictness: settings.strictness },
  );
}
