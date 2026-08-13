/**
 * How tangled the drawing actually is.
 *
 * Crossing lines are the one graph defect that no amount of good labelling
 * rescues: the reader cannot tell which line reaches which box, so the drawing
 * stops answering the question it exists for. Ordering heuristics are easy to
 * change and hard to reason about, so this measures the outcome on a real file
 * rather than asserting anything about the method.
 *
 * The geometry here mirrors the webview's: a couple is joined by a marriage bar
 * and their children all descend from one point on it, which is both the
 * conventional pedigree drawing and the thing that removes most crossings.
 */

import { describe, expect, it } from 'vitest';

import { neighbourhood, type Graph } from '../src/graph.ts';
import { analyze } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

/** Must match packages/client/src/graph-view.ts. */
const NODE_WIDTH = 170;
const NODE_HEIGHT = 40;

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** The lines the panel draws between columns, after union-point routing. */
function segments(graph: Graph): Segment[] {
  const byXref = new Map(graph.nodes.map((node) => [node.xref, node]));

  // Keyed by family, exactly as the panel does: someone who married twice has
  // two unions, and their children belong to one or the other.
  const unions = new Map<string, { x: number; y: number }>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'spouse' || !edge.union) continue;
    const a = byXref.get(edge.from);
    const b = byXref.get(edge.to);
    if (!a || !b || a.x !== b.x) continue;

    const top = a.y <= b.y ? a : b;
    const anchor = a.distance === b.distance ? top : a.distance < b.distance ? a : b;
    unions.set(edge.union, { x: anchor.x + NODE_WIDTH, y: anchor.y + NODE_HEIGHT / 2 });
  }

  const drawn = new Set<string>();
  const found: Segment[] = [];

  for (const edge of graph.edges) {
    if (edge.kind === 'spouse') continue;
    const a = byXref.get(edge.from);
    const b = byXref.get(edge.to);
    if (!a || !b) continue;

    const from = a.x <= b.x ? a : b;
    const to = a.x <= b.x ? b : a;

    let x1 = from.x + NODE_WIDTH;
    let y1 = from.y + NODE_HEIGHT / 2;

    const union = edge.kind === 'parent' && edge.union ? unions.get(edge.union) : undefined;
    if (union) {
      const key = `${edge.union} ${to.xref}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      x1 = union.x;
      y1 = union.y;
    }

    found.push({ x1, y1, x2: to.x, y2: to.y + NODE_HEIGHT / 2 });
  }

  return found;
}

const turnsLeft = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);

function intersects(s: Segment, t: Segment): boolean {
  const s1 = { x: s.x1, y: s.y1 };
  const s2 = { x: s.x2, y: s.y2 };
  const t1 = { x: t.x1, y: t.y1 };
  const t2 = { x: t.x2, y: t.y2 };
  return (
    turnsLeft(s1, t1, t2) !== turnsLeft(s2, t1, t2) &&
    turnsLeft(s1, s2, t1) !== turnsLeft(s1, s2, t2)
  );
}

function crossings(graph: Graph): number {
  const lines = segments(graph);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (intersects(lines[i]!, lines[j]!)) count++;
    }
  }
  return count;
}

describe('against Royal92', () => {
  const royal = analyze(fixture('v5/Royal92.ged').bytes);
  const people = [...royal.xrefs.definitions]
    .filter(([, record]) => record.tag === 'INDI')
    .map(([xref]) => xref)
    .slice(0, 300);

  const measured = people
    .map((xref) => neighbourhood(royal, xref, { depth: 2 }))
    .filter((graph) => graph.nodes.length >= 3)
    .map(crossings);

  /**
   * What these figures cost, and what they turned out not to.
   *
   * There was a stage where they had to be lowered. Ordering each column
   * against its neighbours to minimise crossings reached 71% crossing-free and
   * produced a different drawing every time the selection moved, because the
   * arrangement was computed from whoever happened to be on screen; ordering by
   * birth alone held still but fell to 46%.
   *
   * Neither trade was necessary. Hanging each sibling group beneath its parents
   * and sorting by birthday *within* the group recovers the crossings without
   * consulting the view at all — the two columns then agree by construction
   * rather than by search. See graph-stability for the other half.
   */
  it('draws most neighbourhoods with no crossings at all', () => {
    const clean = measured.filter((count) => count === 0).length;
    expect(clean / measured.length).toBeGreaterThan(0.62);
  });

  it('keeps most of the rest to a couple of crossings', () => {
    const nearly = measured.filter((count) => count <= 2).length;
    expect(nearly / measured.length).toBeGreaterThan(0.8);
  });

  /**
   * Reported as a median and a percentile rather than a mean.
   *
   * The distribution is heavily skewed: most drawings have no crossings at all
   * and a handful of hub records — someone with five marriages and twenty
   * grandchildren in view — have hundreds. A mean describes neither group, and
   * moves sharply when one outlier enters or leaves the sample, which makes it
   * useless as a regression signal.
   */
  it('leaves the typical drawing clean', () => {
    const sorted = [...measured].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBe(0);
  });

  it('keeps even the crowded end of the range in hand', () => {
    const sorted = [...measured].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.9)]).toBeLessThan(6);
  });

  it('runs a generation parallel to the one below it', () => {
    // The defect this closes: two couples ordered by their own birthdays, their
    // children ordered by theirs, and every line between the columns crossing to
    // reconcile the two. Albert (1819) marries Victoria and their eldest arrives
    // in 1840; Alexander (1818) is older but his eldest arrives in 1842 — so by
    // birthday the parents come out in one order and the children in the other.
    const beatrice = [...royal.xrefs.definitions].find(
      ([, record]) =>
        record.tag === 'INDI' &&
        record.children.some((c) => c.tag === 'NAME' && /Beatrice/.test(c.payload ?? '')) &&
        record.children.some(
          (c) => c.tag === 'BIRT' && c.children.some((d) => /1884/.test(d.payload ?? '')),
        ),
    )!;

    const graph = neighbourhood(royal, beatrice[0], { depth: 2 });
    const grandparents = graph.nodes
      .filter((node) => node.generation === -2)
      .sort((a, b) => a.y - b.y)
      .map((node) => node.label);

    expect(grandparents[0]).toMatch(/Albert Augustus/);
    expect(crossings(graph)).toBe(0);
  });
});

describe('a couple and their children', () => {
  const FAMILY = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @P1@ INDI',
    '1 NAME Father /X/',
    '1 FAMS @F1@',
    '0 @P2@ INDI',
    '1 NAME Mother /X/',
    '1 FAMS @F1@',
    '0 @C1@ INDI',
    '1 FAMC @F1@',
    '0 @C2@ INDI',
    '1 FAMC @F1@',
    '0 @C3@ INDI',
    '1 FAMC @F1@',
    '0 @C4@ INDI',
    '1 FAMC @F1@',
    '0 @F1@ FAM',
    '1 HUSB @P1@',
    '1 WIFE @P2@',
    '1 CHIL @C1@',
    '1 CHIL @C2@',
    '1 CHIL @C3@',
    '1 CHIL @C4@',
    '0 TRLR',
    '',
  ].join('\n');

  const analysis = analyze(bytes(FAMILY));

  it('draws four children from one point with nothing crossing', () => {
    // Two parents fanning independently to four children makes crossings
    // unavoidable; one line per child from the marriage bar makes them impossible.
    const graph = neighbourhood(analysis, 'P1', { depth: 2 });
    expect(segments(graph)).toHaveLength(4);
    expect(crossings(graph)).toBe(0);
  });

  it('seats the couple together so the marriage bar joins them', () => {
    const graph = neighbourhood(analysis, 'P1', { depth: 2 });
    const p1 = graph.nodes.find((node) => node.xref === 'P1')!;
    const p2 = graph.nodes.find((node) => node.xref === 'P2')!;

    expect(p1.x).toBe(p2.x);
    expect(Math.abs(p1.y - p2.y)).toBe(64);
  });
});
