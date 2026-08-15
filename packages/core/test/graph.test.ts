/**
 * Neighbourhood extraction and layout.
 *
 * The layout lives in core precisely so it can be tested here, without an editor
 * or a webview in the way.
 */

import { describe, expect, it } from 'vitest';

import { neighbourhood, recordAt } from '../src/graph.ts';
import { analyze } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

const FAMILY = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '1 DEAT',
  '2 DATE 3 MAR 1975',
  '1 FAMS @F1@',
  '1 SOUR @S1@',
  '0 @I2@ INDI',
  '1 NAME Jane /Doe/',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Child /Smith/',
  '1 BIRT',
  '2 DATE 1930',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 MARR',
  '2 DATE 4 JUN 1925',
  '0 @S1@ SOUR',
  '1 TITL Parish register',
  '0 @I9@ INDI',
  '1 NAME Unrelated /Person/',
  '0 TRLR',
  '',
].join('\n');

const analysis = analyze(bytes(FAMILY));

describe('neighbourhood', () => {
  it('places the focus at distance zero', () => {
    const graph = neighbourhood(analysis, 'I1');
    expect(graph.focus).toBe('I1');
    expect(graph.nodes.find((n) => n.xref === 'I1')?.distance).toBe(0);
  });

  it('collapses the family record and connects the people directly', () => {
    // The whole point. GEDCOM puts a FAM between every pair of relatives because
    // that is how it stores a marriage; drawn literally, half the boxes have no
    // names in them and a grandparent is four hops from a grandchild.
    const graph = neighbourhood(analysis, 'I1', { depth: 1 });
    expect(graph.nodes.map((n) => n.xref).sort()).toEqual(['I1', 'I2', 'I3']);
    expect(graph.nodes.some((n) => n.tag === 'FAM')).toBe(false);
  });

  it('reaches a spouse and a child in one hop, not two', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 1 });
    expect(graph.nodes.find((n) => n.xref === 'I2')?.distance).toBe(1);
    expect(graph.nodes.find((n) => n.xref === 'I3')?.distance).toBe(1);
  });

  it('labels a marriage with its year and a parent link with the role', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 1 });
    const between = (a: string, b: string) =>
      graph.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

    expect(between('I1', 'I2')?.label).toBe('Married 1925');
    expect(between('I1', 'I2')?.kind).toBe('spouse');

    const child = between('I1', 'I3')!;
    expect(child.kind).toBe('parent');
    // Both readings are carried, so the drawing can label the edge whichever way
    // round it ends up running.
    expect([child.label, child.reverseLabel].sort()).toEqual(['Child', 'Parent']);
  });

  it('draws a family as its people, never as a box of its own', () => {
    // Putting the cursor in a family asks to see that family — a couple and
    // their children. The record itself has no name, no dates, and nothing to
    // say that its members do not say better.
    const graph = neighbourhood(analysis, 'F1', { depth: 1 });
    expect(graph.nodes.map((n) => n.xref).sort()).toEqual(['I1', 'I2', 'I3']);
    expect(graph.nodes.some((n) => n.tag === 'FAM')).toBe(false);
  });

  it('highlights everyone the family is about, since it has no box', () => {
    const graph = neighbourhood(analysis, 'F1', { depth: 1 });
    expect(graph.focus).toBe('F1');
    expect([...graph.focused].sort()).toEqual(['I1', 'I2', 'I3']);
  });

  it('seats the family in generations rather than all in one column', () => {
    // The bug this replaced: a family and its spouses all sat at generation
    // zero, so the edge between them ran backwards and its label fell behind a
    // box.
    const graph = neighbourhood(analysis, 'F1', { depth: 1 });
    const generation = (xref: string) => graph.nodes.find((node) => node.xref === xref)?.generation;

    expect(generation('I1')).toBe(0);
    expect(generation('I2')).toBe(0);
    expect(generation('I3')).toBe(1);
  });

  it('draws every relationship once', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 2 });
    const pairs = graph.edges.map((e) => [e.from, e.to].sort().join(' '));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('excludes records with no path to the focus', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 5 });
    expect(graph.nodes.map((n) => n.xref)).not.toContain('I9');
  });

  it('labels people by name and keeps the defining line', () => {
    const node = neighbourhood(analysis, 'I1').nodes.find((n) => n.xref === 'I1')!;
    expect(node.label).toBe('John Smith');
    expect(node.tag).toBe('INDI');
    expect(node.line).toBe(3);
  });

  it('carries dates, which are what tell two people of a name apart', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 1 });
    expect(graph.nodes.find((n) => n.xref === 'I1')?.detail).toBe('1901–1975');
    // Only a birth recorded.
    expect(graph.nodes.find((n) => n.xref === 'I3')?.detail).toBe('b. 1930');
    // No dates at all shows nothing. "Individual" under a name is a label with
    // no information in it — every box in a family tree holds one — and a row of
    // them reads as though something failed to load.
    expect(graph.nodes.find((n) => n.xref === 'I2')?.detail).toBe('');
  });

  it('leaves sources out unless they are asked for', () => {
    // A well-sourced person cites dozens of records, and they crowd out the
    // family the panel exists to show.
    expect(neighbourhood(analysis, 'I1', { depth: 1 }).nodes.map((n) => n.xref)).not.toContain(
      'S1',
    );

    expect(
      neighbourhood(analysis, 'I1', { depth: 1, includeReferences: true }).nodes.map((n) => n.xref),
    ).toContain('S1');
  });

  it('names record types in English', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 1, includeReferences: true });
    expect(graph.nodes.find((n) => n.xref === 'I1')?.kind).toBe('Individual');
    expect(graph.nodes.find((n) => n.xref === 'S1')?.kind).toBe('Source');
    expect(graph.edges.every((edge) => edge.label.length > 0)).toBe(true);
  });

  it('returns nothing for an unknown or absent focus', () => {
    expect(neighbourhood(analysis, null).nodes).toEqual([]);
    expect(neighbourhood(analysis, 'NOPE').nodes).toEqual([]);
  });

  it('returns nothing for a family whose members are all missing', () => {
    const orphaned = analyze(
      bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @F9@ FAM\n1 HUSB @GONE@\n0 TRLR\n'),
    );
    expect(neighbourhood(orphaned, 'F9').nodes).toEqual([]);
  });

  it('caps the neighbourhood and reports what it left out', () => {
    const graph = neighbourhood(analysis, 'I1', { depth: 5, maxNodes: 2 });
    expect(graph.nodes.length).toBeLessThanOrEqual(2);
    expect([...graph.elided.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe('layout', () => {
  const graph = neighbourhood(analysis, 'F1', { depth: 2 });

  it('puts each node in a column matching its generation', () => {
    // Not its hop count. A sibling and a grandparent are both two hops away, and
    // a column that holds them both says something false about the family.
    const byXref = new Map(graph.nodes.map((n) => [n.xref, n]));

    // The couple sit level with their family; the child a generation on.
    expect(byXref.get('I1')!.x).toBe(byXref.get('I2')!.x);
    expect(byXref.get('I1')!.x).toBeLessThan(byXref.get('I3')!.x);
  });

  it('puts ancestors left of the focus and descendants right', () => {
    const tree = neighbourhood(analysis, 'I3', { depth: 2 });
    const byXref = new Map(tree.nodes.map((n) => [n.xref, n]));

    expect(byXref.get('I1')!.x).toBeLessThan(byXref.get('I3')!.x);
    expect(byXref.get('I2')!.x).toBeLessThan(byXref.get('I3')!.x);
  });

  it('seats a couple next to each other', () => {
    // A marriage is drawn down the side of the column, which only reads as one
    // when the two boxes are adjacent.
    const byXref = new Map(graph.nodes.map((n) => [n.xref, n]));
    expect(Math.abs(byXref.get('I1')!.y - byXref.get('I2')!.y)).toBeLessThanOrEqual(64);
  });

  it('never overlaps two nodes', () => {
    const seen = new Set(graph.nodes.map((n) => `${n.x},${n.y}`));
    expect(seen.size).toBe(graph.nodes.length);
  });

  it('is deterministic across runs', () => {
    // A panel that redraws as the cursor moves must not rearrange itself; a node
    // jumping position on every keystroke is worse than a plain arrangement.
    const a = neighbourhood(analysis, 'I1', { depth: 2 }).nodes.map(
      (n) => `${n.xref}:${n.x},${n.y}`,
    );
    const b = neighbourhood(analysis, 'I1', { depth: 2 }).nodes.map(
      (n) => `${n.xref}:${n.x},${n.y}`,
    );
    expect(a).toEqual(b);
  });

  it('reports a canvas big enough for every node', () => {
    for (const node of graph.nodes) {
      expect(node.x).toBeLessThanOrEqual(graph.width);
      expect(node.y).toBeLessThanOrEqual(graph.height);
    }
  });
});

describe('following the cursor', () => {
  it('finds the record containing a line', () => {
    expect(recordAt(analysis, 3)).toBe('I1');
    expect(recordAt(analysis, 5)).toBe('I1');
    expect(recordAt(analysis, 19)).toBe('F1');
  });

  it('reports nothing inside a record with no identifier', () => {
    expect(recordAt(analysis, 1)).toBeNull();
  });
});

describe('against a real file', () => {
  const royal = analyze(fixture('v5/Royal92.ged').bytes);

  it('extracts a readable neighbourhood from a large file', () => {
    const someone = [...royal.xrefs.definitions.keys()].find(
      (xref) => royal.xrefs.definitions.get(xref)!.tag === 'INDI',
    )!;
    const graph = neighbourhood(royal, someone, { depth: 2 });

    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(graph.nodes.length).toBeLessThanOrEqual(60);
    expect(graph.nodes.every((n) => n.label.length > 0)).toBe(true);
  });

  it('stays within the node cap for a well-connected record', () => {
    for (const xref of [...royal.xrefs.definitions.keys()].slice(0, 40)) {
      expect(neighbourhood(royal, xref, { depth: 3 }).nodes.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('direction of travel', () => {
  const THREE_GENERATIONS = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @GP@ INDI',
    '1 NAME Grand /Parent/',
    '1 FAMS @F0@',
    '0 @F0@ FAM',
    '1 HUSB @GP@',
    '1 CHIL @ME@',
    '0 @ME@ INDI',
    '1 NAME Me /Person/',
    '1 FAMC @F0@',
    '1 FAMS @F1@',
    '0 @SP@ INDI',
    '1 NAME My /Spouse/',
    '1 FAMS @F1@',
    '0 @F1@ FAM',
    '1 HUSB @ME@',
    '1 WIFE @SP@',
    '1 CHIL @KID@',
    '0 @KID@ INDI',
    '1 NAME My /Child/',
    '1 FAMC @F1@',
    '0 TRLR',
    '',
  ].join('\n');

  const tree = analyze(bytes(THREE_GENERATIONS));
  const reached = (direction: 'both' | 'ancestors' | 'descendants') =>
    neighbourhood(tree, 'ME', { depth: 3, direction })
      .nodes.map((n) => n.xref)
      .sort();

  it('reaches both ways by default', () => {
    expect(reached('both')).toEqual(['GP', 'KID', 'ME', 'SP']);
  });

  it('follows only the line back when tracing ancestors', () => {
    expect(reached('ancestors')).not.toContain('KID');
    expect(reached('ancestors')).toContain('GP');
  });

  it('follows only the line forward when tracing descendants', () => {
    expect(reached('descendants')).not.toContain('GP');
    expect(reached('descendants')).toContain('KID');
  });

  it('keeps spouses whichever way it is travelling', () => {
    // A marriage belongs to a line of descent as much as to a line of ancestry;
    // dropping it would leave half of every couple unexplained.
    expect(reached('ancestors')).toContain('SP');
    expect(reached('descendants')).toContain('SP');
  });
});

describe('multiple spouses', () => {
  const MULTI_SPOUSE = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @H@ INDI',
    '1 NAME Henry /Tudor/',
    '1 FAMS @F1@',
    '1 FAMS @F2@',
    '0 @W1@ INDI',
    '1 NAME Catherine /Aragon/',
    '1 FAMS @F1@',
    '0 @W2@ INDI',
    '1 NAME Anne /Boleyn/',
    '1 FAMS @F2@',
    '0 @F1@ FAM',
    '1 HUSB @H@',
    '1 WIFE @W1@',
    '0 @F2@ FAM',
    '1 HUSB @H@',
    '1 WIFE @W2@',
    '0 TRLR',
    '',
  ].join('\n');

  it('groups multiple spouses into the same unit with the partner', () => {
    const graph = neighbourhood(analyze(bytes(MULTI_SPOUSE)), 'H', { depth: 1 });
    const nodes = graph.nodes.filter((n) => ['H', 'W1', 'W2'].includes(n.xref));
    expect(nodes.length).toBe(3);

    // In a column, y positions must be strictly consecutive for all three partners
    const sorted = [...nodes].sort((a, b) => a.y - b.y);
    const ys = sorted.map((n) => n.y);
    const diff1 = ys[1]! - ys[0]!;
    const diff2 = ys[2]! - ys[1]!;
    expect(diff1).toBe(diff2);
  });
});
