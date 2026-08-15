/** One analysis per document version, shared by every panel that draws. */

import { describe, expect, it } from 'vitest';

import { analysisOf, forget, type Readable } from '../src/analysis.ts';

const TEXT = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME John /Smith/\n0 TRLR\n';

/** A document that counts how often it was actually read. */
function document(uri: string, version = 1, text = TEXT) {
  let reads = 0;
  const readable: Readable & { reads: () => number } = {
    uri: { toString: () => uri },
    version,
    getText: () => {
      reads += 1;
      return text;
    },
    reads: () => reads,
  };
  return readable;
}

describe('the analysis cache', () => {
  it('reads a document once, however many panels ask', () => {
    const file = document('file:///one.ged');

    const first = analysisOf(file);
    const second = analysisOf(file);
    const third = analysisOf(file);

    expect(file.reads()).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('re-reads when the document changes', () => {
    const before = document('file:///two.ged', 1);
    const first = analysisOf(before);

    const after = document('file:///two.ged', 2, '0 HEAD\n0 @I2@ INDI\n0 TRLR\n');
    const second = analysisOf(after);

    expect(second).not.toBe(first);
    expect(second.document.records).toHaveLength(3);
  });

  it('keeps several documents at once', () => {
    const one = document('file:///a.ged');
    const other = document('file:///b.ged');

    const first = analysisOf(one);
    analysisOf(other);

    expect(analysisOf(one)).toBe(first);
    expect(one.reads()).toBe(1);
  });

  it('forgets a document when the editor is done with it', () => {
    const file = document('file:///three.ged');
    analysisOf(file);
    forget(file.uri);

    analysisOf(file);
    expect(file.reads()).toBe(2);
  });

  it('holds a bounded number of documents', () => {
    // An analysis of a large file is the biggest thing this extension keeps in
    // memory, and a session can touch any number of files.
    const first = document('file:///bounded-0.ged');
    analysisOf(first);

    for (let index = 1; index <= 12; index += 1)
      analysisOf(document(`file:///bounded-${index}.ged`));

    analysisOf(first);
    expect(first.reads()).toBe(2);
  });
});
