/**
 * Semantic tag classes.
 *
 * GEDCOM is a data format, not a programming language, so the usual scope
 * vocabulary is free for a mapping chosen on meaning. A reader scanning a large
 * file wants to see which lines record an event, which state an enduring fact,
 * which are edges in the family graph and which are citation paperwork — none of
 * which a single tag colour can convey.
 */

import { describe, expect, it } from 'vitest';

import { leafScope, tokenize } from './tokenizer.ts';

async function scopeOfTag(line: string, tag: string): Promise<string> {
  const tokens = await tokenize(line);
  const column = line.indexOf(tag);
  const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
  return leafScope(token!);
}

describe('each class takes a distinct scope', () => {
  it.each([
    ['0 HEAD', 'HEAD', 'keyword.control.envelope.gedcom'],
    ['0 @I1@ INDI', 'INDI', 'entity.name.type.record.gedcom'],
    ['1 BIRT', 'BIRT', 'support.function.event.gedcom'],
    ['1 NAME John /Smith/', 'NAME', 'entity.name.tag.attribute.gedcom'],
    ['1 SEX M', 'SEX', 'entity.name.tag.attribute.gedcom'],
    ['1 FAMS @F1@', 'FAMS', 'variable.other.linkage.gedcom'],
    ['2 PAGE p.42', 'PAGE', 'markup.quote.evidence.gedcom'],
    ['1 CHAN', 'CHAN', 'entity.name.tag.administrative.gedcom'],
    ['2 DATE 1901', 'DATE', 'entity.name.tag.gedcom'],
  ])('%s scopes %s as %s', async (line, tag, expected) => {
    expect(await scopeOfTag(line, tag)).toBe(expected);
  });

  it('lands the classes in buckets themes separate', async () => {
    const samples: [string, string][] = [
      ['0 HEAD', 'HEAD'],
      ['0 @I1@ INDI', 'INDI'],
      ['1 BIRT', 'BIRT'],
      ['1 NAME x', 'NAME'],
      ['1 FAMS @F1@', 'FAMS'],
      ['2 PAGE p', 'PAGE'],
    ];

    const scopes = await Promise.all(samples.map(([line, tag]) => scopeOfTag(line, tag)));
    expect(new Set(scopes).size).toBe(samples.length);

    // Five distinct roots, not six: record and attribute both sit under `entity`
    // and are separated by the second segment instead. That is the one place the
    // design leans on depth, and it holds because Primer colours
    // `entity.name.type` and `entity.name.tag` from different variables.
    const roots = new Set(scopes.map((scope) => scope.split('.')[0]!));
    expect(roots).toEqual(new Set(['keyword', 'entity', 'support', 'variable', 'markup']));
  });

  it('gives a linkage tag the same bucket as the pointer it introduces', async () => {
    // `1 FAMS @F1@` should read as one gesture rather than a tag and a value.
    const tokens = await tokenize('1 FAMS @F1@');
    const tag = tokens.find((t) => t.text === 'FAMS')!;
    const pointer = tokens.find((t) => t.text === 'F1')!;
    expect(leafScope(tag).split('.')[0]).toBe(leafScope(pointer).split('.')[0]);
  });
});

describe('classification is faithful to the specification', () => {
  it('reads events as events even where a tag looks structural', async () => {
    for (const tag of ['MARR', 'DEAT', 'BURI', 'CENS', 'IMMI']) {
      expect(await scopeOfTag(`1 ${tag}`, tag)).toBe('support.function.event.gedcom');
    }
  });

  it('separates attributes from events, as the enumeration sets do', async () => {
    // DATA-EVEN enumerates both; NO enumerates only events. The difference is
    // the attribute list, so OCCU and RESI must not read as events.
    for (const tag of ['OCCU', 'RESI', 'EDUC', 'NCHI']) {
      expect(await scopeOfTag(`1 ${tag} x`, tag)).toBe('entity.name.tag.attribute.gedcom');
    }
  });

  it('treats every pointer-payload tag as a graph edge', async () => {
    for (const tag of ['HUSB', 'WIFE', 'CHIL', 'FAMC', 'ASSO']) {
      expect(await scopeOfTag(`1 ${tag} @X1@`, tag)).toBe('variable.other.linkage.gedcom');
    }
  });

  it('keeps HEAD and TRLR as envelope even though they sit at level 0', async () => {
    expect(await scopeOfTag('0 HEAD', 'HEAD')).toBe('keyword.control.envelope.gedcom');
    expect(await scopeOfTag('0 TRLR', 'TRLR')).toBe('keyword.control.envelope.gedcom');
  });

  it('still marks extension and unknown tags distinctly', async () => {
    expect(await scopeOfTag('1 _UID x', '_UID')).toBe('entity.name.tag.extension.gedcom');
    expect(await scopeOfTag('1 ZZTOP x', 'ZZTOP')).toBe('entity.name.tag.unknown.gedcom');
  });
});
