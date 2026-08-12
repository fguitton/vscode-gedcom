/**
 * Builds the GEDCOM TextMate grammar.
 *
 * Two rules govern everything in this file:
 *
 *  1. **Every rule is a single-line `match`.** GEDCOM is a strictly line-oriented
 *     format — `Line = Level D [Xref D] Tag [D LineVal] EOL` — so no rule may use
 *     `begin`/`end`. A begin/end pair lets tokenizer state escape the line it
 *     started on, which is how the previous grammar turned one unpaired `@` in a
 *     note into a pointer that swallowed the rest of the file.
 *
 *  2. **The grammar is lexical, not conformant.** Whether a tag is legal *in this
 *     position* is a question about the structure tree, which no regex can answer.
 *     The grammar therefore recognises the union of every version's vocabulary and
 *     leaves conformance to the language server.
 *
 * Scope names follow TextMate convention so stock themes colour them sensibly.
 * `source.gedcom` is fixed by GitHub Linguist's grammars.yml and must never change.
 */

import { calendars, dateKeywords, epochs, months, tagsByClass, type TagClass } from './registry.ts';

const TAGS_BY_CLASS = tagsByClass();

/**
 * Semantic class to TextMate scope. This mapping *is* the colour design.
 *
 * Scopes are chosen so the classes land in buckets themes actually separate.
 * That constraint is tighter than it looks: GitHub renders this grammar through
 * PrettyLights, whose Primer palette has far fewer buckets than a VS Code theme —
 * broadly keyword, entity, entity-tag, constant/support, string, variable,
 * comment and markup. Two classes sharing a bucket would be invisible there even
 * while looking fine locally.
 *
 * `variable` for linkage is deliberate on both counts: it is a distinct bucket,
 * and it makes a linkage tag share its colour with the pointer that follows, so
 * `1 FAMS @F1@` reads as one gesture rather than two. `markup.quote` for evidence
 * is chosen on meaning as much as appearance — a citation is material quoted from
 * elsewhere.
 *
 * `administrative` intentionally shares the attribute bucket. De-emphasis is what
 * it wants, and no honest scope provides it: `comment` would render correctly and
 * mean something false.
 */
const CLASS_SCOPES: readonly (readonly [TagClass, string])[] = [
  ['envelope', 'keyword.control.envelope.gedcom'],
  ['record', 'entity.name.type.record.gedcom'],
  ['event', 'support.function.event.gedcom'],
  ['attribute', 'entity.name.tag.attribute.gedcom'],
  ['linkage', 'variable.other.linkage.gedcom'],
  ['evidence', 'markup.quote.evidence.gedcom'],
  ['administrative', 'entity.name.tag.administrative.gedcom'],
];

type Captures = Record<string, { name?: string; patterns?: Rule[] }>;

interface Rule {
  readonly include?: string;
  readonly name?: string;
  readonly match?: string;
  readonly captures?: Captures;
}

interface Grammar {
  readonly $schema: string;
  readonly name: string;
  readonly scopeName: string;
  readonly patterns: Rule[];
  readonly repository: Record<string, { patterns: Rule[] }>;
}

// --- shared regex fragments -------------------------------------------------

/** Leading whitespace is illegal per spec, but tolerated here: flagging it is a
 *  diagnostic, not a lexing decision. Captured so it stays out of the level. */
const INDENT = '(\\s*)';
const LEVEL = '(\\d+)';
/** Structural delimiter. The spec mandates exactly one space; real exports pad. */
const D = '[ ]+';
/** Payload delimiter. Exactly one space — any further spaces belong to the
 *  payload, which matters for CONT lines that encode leading whitespace. */
const DP = '[ ]';
/**
 * Cross-reference identifier.
 *
 * GEDCOM 7 restricts these to tagchars and 5.5.1 requires a leading alphanumeric,
 * but neither restriction is safe to enforce here. Files in the wild carry
 * identifiers in non-Latin scripts, and a grammar stricter than the parser would
 * mark the whole line illegal — losing a record because its identifier is not
 * Latin. Judging identifier legality is validation's job.
 *
 * The first character therefore excludes only what would create an ambiguity:
 * `#` would swallow the 5.5.1 date escape `@#DJULIAN@`, whitespace cannot open an
 * identifier, and `@` is the delimiter itself, which also keeps the `@@` escape
 * from reading as an empty pointer. `[^@]` for the remainder stops the match from
 * crossing a closing at-sign.
 */
const XREF_BODY = '[^@#\\s][^@\\n]*';
const XREF = `(@${XREF_BODY}@)`;
const TAG = '([A-Za-z_][A-Za-z0-9_]*)';
const PAYLOAD = '(.*)';

const alternation = (words: readonly string[]) => `\\b(?:${[...words].join('|')})\\b`;

/** Tags whose payload carries a personal name with `/surname/` delimiters. */
const NAME_TAGS = ['NAME', '_MARNM', '_AKA', '_AKAN', '_BIRN', '_ADPN'];
/** Tags whose payload is a date expression. */
const DATE_TAGS = ['DATE', 'SDATE'];

// --- capture helpers --------------------------------------------------------

const levelCapture = { name: 'constant.numeric.integer.level.gedcom' };
const tagCapture = { patterns: [{ include: '#tag' }] };
const xrefDefCapture = { patterns: [{ include: '#xref-definition' }] };
const xrefRefCapture = { patterns: [{ include: '#xref-reference' }] };

const payloadCapture = {
  name: 'string.unquoted.payload.gedcom',
  patterns: [{ include: '#payload-escapes' }],
};

const datePayloadCapture = {
  name: 'string.unquoted.payload.gedcom',
  patterns: [{ include: '#date' }],
};

const namePayloadCapture = {
  name: 'string.unquoted.payload.gedcom',
  patterns: [{ include: '#personal-name' }],
};

// --- the grammar ------------------------------------------------------------

export function buildGrammar(): Grammar {
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'GEDCOM',
    scopeName: 'source.gedcom',
    patterns: [{ include: '#line' }],
    repository: {
      /**
       * Line dispatch. Order is significant: the more specific payload shapes are
       * tried before the generic tag line, and the invalid-line catch-all is last.
       */
      line: {
        patterns: [
          { include: '#record-line' },
          { include: '#continuation-line' },
          { include: '#date-line' },
          { include: '#name-line' },
          { include: '#pointer-line' },
          { include: '#tag-line' },
          { include: '#invalid-line' },
        ],
      },

      /** `0 @I123@ INDI` — a record, the only place an xref is *defined*. */
      'record-line': {
        patterns: [
          {
            name: 'meta.line.record.gedcom',
            match: `^${INDENT}${LEVEL}${D}${XREF}${D}${TAG}(?:${DP}${PAYLOAD})?$`,
            captures: {
              '2': levelCapture,
              '3': xrefDefCapture,
              '4': tagCapture,
              '5': payloadCapture,
            },
          },
        ],
      },

      /**
       * `1 CONT   text` — continuation pseudo-structures. Split out because the
       * payload's leading whitespace is significant data, not padding.
       */
      'continuation-line': {
        patterns: [
          {
            name: 'meta.line.continuation.gedcom',
            match: `^${INDENT}${LEVEL}${D}(CONC|CONT)(?:${DP}${PAYLOAD})?$`,
            captures: {
              '2': levelCapture,
              '3': { name: 'keyword.control.continuation.gedcom' },
              '4': payloadCapture,
            },
          },
        ],
      },

      /** `2 DATE 12 AUG 1401` and the 5.5.1 `@#DJULIAN@` escape form. */
      'date-line': {
        patterns: [
          {
            name: 'meta.line.date.gedcom',
            match: `^${INDENT}${LEVEL}${D}(${DATE_TAGS.join('|')})(?:${DP}${PAYLOAD})?$`,
            captures: {
              '2': levelCapture,
              '3': { name: 'entity.name.tag.gedcom' },
              '4': datePayloadCapture,
            },
          },
        ],
      },

      /** `1 NAME John /Smith/` — surname is delimited by solidi. */
      'name-line': {
        patterns: [
          {
            name: 'meta.line.name.gedcom',
            match: `^${INDENT}${LEVEL}${D}(${NAME_TAGS.join('|')})(?:${DP}${PAYLOAD})?$`,
            captures: {
              '2': levelCapture,
              '3': tagCapture,
              '4': namePayloadCapture,
            },
          },
        ],
      },

      /**
       * `1 FAMS @F1@` — the payload is a pointer. Matched only when the payload is
       * *exactly* a pointer, so text that merely contains an @ falls through to the
       * generic tag line and is treated as text.
       */
      'pointer-line': {
        patterns: [
          {
            name: 'meta.line.pointer.gedcom',
            match: `^${INDENT}${LEVEL}${D}${TAG}${DP}${XREF}[ ]*$`,
            captures: {
              '2': levelCapture,
              '3': tagCapture,
              '4': xrefRefCapture,
            },
          },
        ],
      },

      /** `1 NOTE some text` — the general case. */
      'tag-line': {
        patterns: [
          {
            name: 'meta.line.gedcom',
            match: `^${INDENT}${LEVEL}${D}${TAG}(?:${DP}${PAYLOAD})?$`,
            captures: {
              '2': levelCapture,
              '3': tagCapture,
              '4': payloadCapture,
            },
          },
        ],
      },

      /**
       * Anything that is not a GEDCOM line at all. Blank lines are excluded: they
       * are technically illegal but harmless and extremely common in the wild.
       */
      'invalid-line': {
        patterns: [
          {
            match: '^(?!\\s*$).*$',
            name: 'invalid.illegal.line.gedcom',
          },
        ],
      },

      // --- tag classification ---------------------------------------------

      /**
       * Tags are coloured by what they *mean*, not merely by being tags.
       *
       * A reader scanning a large file is asking which lines record something
       * that happened, which state an enduring fact, which are edges in the
       * family graph, and which are just citation paperwork. One scope for all
       * tags answers none of those. The classes come from `tagsByClass()`, mostly
       * derived from the registry, so they cannot drift from the specification.
       *
       * Scope roots are chosen for what themes actually separate. GitHub renders
       * this grammar through PrettyLights rather than a modern TextMate engine,
       * and Primer distinguishes fewer roots than a VS Code theme does, so each
       * class sits under a different root rather than a different sub-scope.
       *
       * Unknown tags are scoped distinctly but never as errors: an undocumented
       * tag is a portability concern, not a syntax error, and SCHMA-documented
       * extensions cannot be recognised lexically at all.
       */
      tag: {
        patterns: [
          ...CLASS_SCOPES.map(([tagClass, name]) => ({
            match: alternation(TAGS_BY_CLASS[tagClass]),
            name,
          })).filter((rule) => rule.match.length > 8),
          { match: alternation(TAGS_BY_CLASS.other), name: 'entity.name.tag.gedcom' },
          { match: '_[A-Za-z0-9_]*', name: 'entity.name.tag.extension.gedcom' },
          { match: '[A-Za-z][A-Za-z0-9_]*', name: 'entity.name.tag.unknown.gedcom' },
        ],
      },

      // --- cross-references -------------------------------------------------

      'xref-definition': {
        patterns: [
          {
            match: `(@)(${XREF_BODY})(@)`,
            captures: {
              '1': { name: 'punctuation.definition.xref.begin.gedcom' },
              '2': { name: 'entity.name.type.xref.gedcom' },
              '3': { name: 'punctuation.definition.xref.end.gedcom' },
            },
          },
        ],
      },

      'xref-reference': {
        patterns: [
          {
            match: '(@)(VOID)(@)',
            captures: {
              '1': { name: 'punctuation.definition.xref.begin.gedcom' },
              '2': { name: 'constant.language.void.gedcom' },
              '3': { name: 'punctuation.definition.xref.end.gedcom' },
            },
          },
          {
            match: `(@)(${XREF_BODY})(@)`,
            captures: {
              '1': { name: 'punctuation.definition.xref.begin.gedcom' },
              '2': { name: 'variable.other.xref.gedcom' },
              '3': { name: 'punctuation.definition.xref.end.gedcom' },
            },
          },
        ],
      },

      // --- payload internals ------------------------------------------------

      /**
       * The two at-sign forms that may appear inside ordinary text.
       * GEDCOM 5.5.1 doubled every `@`; GEDCOM 7 escapes only a leading one.
       * Both are recognised — the grammar cannot know which version applies.
       */
      'payload-escapes': {
        patterns: [
          { match: '@#[^@]*@', name: 'constant.language.escape.gedcom' },
          { match: '@@', name: 'constant.character.escape.gedcom' },
        ],
      },

      date: {
        patterns: [
          { match: '@#[^@]*@', name: 'constant.language.calendar.gedcom' },
          { match: alternation(calendars), name: 'constant.language.calendar.gedcom' },
          { match: alternation(dateKeywords), name: 'keyword.operator.date.gedcom' },
          { match: alternation(months), name: 'constant.language.month.gedcom' },
          {
            match: `\\b(?:${epochs.map((e) => e.replace(/\./g, '\\.')).join('|')})`,
            name: 'constant.language.epoch.gedcom',
          },
          { match: '\\b\\d+\\b', name: 'constant.numeric.date.gedcom' },
        ],
      },

      'personal-name': {
        patterns: [
          {
            match: '(/)([^/]*)(/)',
            captures: {
              '1': { name: 'punctuation.definition.surname.begin.gedcom' },
              '2': { name: 'string.quoted.other.surname.gedcom' },
              '3': { name: 'punctuation.definition.surname.end.gedcom' },
            },
          },
          { include: '#payload-escapes' },
        ],
      },
    },
  };
}
