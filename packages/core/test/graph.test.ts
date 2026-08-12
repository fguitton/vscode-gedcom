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
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Jane /Doe/',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Child /Smith/',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
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

  it('follows pointers in both directions', () => {
    // I1 points at F1 via FAMS; F1 points back via HUSB. A reader does not care
    // which way round the file wrote it.
    const graph = neighbourhood(analysis, 'F1', { depth: 1 });
    expect(graph.nodes.map((n) => n.xref).sort()).toEqual(['F1', 'I1', 'I2', 'I3']);
  });

  it('reaches in-laws at depth two but not at depth one', () => {
    expect(
      neighbourhood(analysis, 'I1', { depth: 1 })
        .nodes.map((n) => n.xref)
        .sort(),
    ).toEqual(['F1', 'I1']);
    expect(
      neighbourhood(analysis, 'I1', { depth: 2 })
        .nodes.map((n) => n.xref)
        .sort(),
    ).toEqual(['F1', 'I1', 'I2', 'I3']);
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

  it('keeps every edge between included nodes, including cycles', () => {
    // I1 -> F1 (FAMS) and F1 -> I1 (HUSB) are both real and both worth drawing.
    const graph = neighbourhood(analysis, 'I1', { depth: 2 });
    const between = graph.edges.filter(
      (e) => (e.from === 'I1' && e.to === 'F1') || (e.from === 'F1' && e.to === 'I1'),
    );
    expect(between.map((e) => e.tag).sort()).toEqual(['FAMS', 'HUSB']);
  });

  it('returns nothing for an unknown or absent focus', () => {
    expect(neighbourhood(analysis, null).nodes).toEqual([]);
    expect(neighbourhood(analysis, 'NOPE').nodes).toEqual([]);
  });

  it('caps the neighbourhood and reports what it left out', () => {
    const graph = neighbourhood(analysis, 'F1', { depth: 5, maxNodes: 2 });
    expect(graph.nodes.length).toBeLessThanOrEqual(2);
    expect([...graph.elided.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe('layout', () => {
  const graph = neighbourhood(analysis, 'I1', { depth: 2 });

  it('puts each node in a column matching its distance', () => {
    const byXref = new Map(graph.nodes.map((n) => [n.xref, n]));
    expect(byXref.get('I1')!.x).toBeLessThan(byXref.get('F1')!.x);
    expect(byXref.get('F1')!.x).toBeLessThan(byXref.get('I2')!.x);
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
    expect(recordAt(analysis, 13)).toBe('F1');
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
