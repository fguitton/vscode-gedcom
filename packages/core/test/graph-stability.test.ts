/**
 * Whether the drawing holds still.
 *
 * Selecting somebody redraws the graph around them, and a reader clicking along
 * a row of relatives sees one drawing after another in quick succession. If the
 * same people appear in a different order each time, the reader is tracking
 * movement instead of reading a family, and the panel is worse than useless —
 * it is actively misleading about who sits where.
 *
 * Ordering is therefore built from facts about the people, not from the shape of
 * the current view. These tests hold that line.
 */

import { describe, expect, it } from 'vitest';

import { neighbourhood } from '../src/graph.ts';
import { analyze } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

const SIBLINGS = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @P1@ INDI',
  '1 NAME Father /X/',
  '1 FAMS @F1@',
  '0 @P2@ INDI',
  '1 NAME Mother /X/',
  '1 FAMS @F1@',
  // Deliberately written youngest first, so document order and birth order
  // disagree and only one of them can be what the layout used.
  '0 @C3@ INDI',
  '1 NAME Zoe /X/',
  '1 BIRT',
  '2 DATE 1935',
  '1 FAMC @F1@',
  '0 @C1@ INDI',
  '1 NAME Adam /X/',
  '1 BIRT',
  '2 DATE 1925',
  '1 FAMC @F1@',
  '0 @C2@ INDI',
  '1 NAME Mary /X/',
  '1 BIRT',
  '2 DATE 1930',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @P1@',
  '1 WIFE @P2@',
  '1 CHIL @C3@',
  '1 CHIL @C1@',
  '1 CHIL @C2@',
  '0 TRLR',
  '',
].join('\n');

const family = analyze(bytes(SIBLINGS));

/** The people of one column, top to bottom. */
const column = (graph: ReturnType<typeof neighbourhood>, generation: number): string[] =>
  graph.nodes
    .filter((node) => node.generation === generation)
    .sort((a, b) => a.y - b.y)
    .map((node) => node.xref);

describe('siblings', () => {
  it('run oldest first, whatever order the file lists them in', () => {
    const graph = neighbourhood(family, 'C1', { depth: 2 });
    expect(column(graph, 0)).toEqual(['C1', 'C2', 'C3']);
  });

  it('keep that order whichever of them is selected', () => {
    // The complaint this answers: siblings jumping about as the selection moved.
    for (const focus of ['C1', 'C2', 'C3', 'P1', 'P2']) {
      const graph = neighbourhood(family, focus, { depth: 2 });
      const children = graph.nodes
        .filter((node) => ['C1', 'C2', 'C3'].includes(node.xref))
        .sort((a, b) => a.y - b.y)
        .map((node) => node.xref);

      expect(children).toEqual(['C1', 'C2', 'C3']);
    }
  });
});

describe('a couple', () => {
  it('stays together whoever is selected', () => {
    for (const focus of ['C1', 'C2', 'C3', 'P1', 'P2']) {
      const graph = neighbourhood(family, focus, { depth: 2 });
      const husband = graph.nodes.find((node) => node.xref === 'P1');
      const wife = graph.nodes.find((node) => node.xref === 'P2');
      if (!husband || !wife) continue;

      expect(husband.x).toBe(wife.x);
      expect(Math.abs(husband.y - wife.y)).toBe(64);
    }
  });
});

describe('two marriages', () => {
  const TWICE = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @H@ INDI',
    '1 NAME Twice /Married/',
    '1 BIRT',
    '2 DATE 1800',
    '1 FAMS @FA@',
    '1 FAMS @FB@',
    '0 @W1@ INDI',
    '1 NAME First /Wife/',
    '1 BIRT',
    '2 DATE 1802',
    '1 FAMS @FA@',
    '0 @W2@ INDI',
    '1 NAME Second /Wife/',
    '1 BIRT',
    '2 DATE 1820',
    '1 FAMS @FB@',
    '0 @A@ INDI',
    '1 NAME Child /OfFirst/',
    '1 FAMC @FA@',
    '0 @B@ INDI',
    '1 NAME Child /OfSecond/',
    '1 FAMC @FB@',
    '0 @FA@ FAM',
    '1 HUSB @H@',
    '1 WIFE @W1@',
    '1 CHIL @A@',
    '0 @FB@ FAM',
    '1 HUSB @H@',
    '1 WIFE @W2@',
    '1 CHIL @B@',
    '0 TRLR',
    '',
  ].join('\n');

  const twice = analyze(bytes(TWICE));

  it('tells the two families apart on the edges', () => {
    // Without this the drawing cannot know which marriage a child belongs to,
    // and every child ends up leaving from whichever union was recorded last.
    const graph = neighbourhood(twice, 'H', { depth: 2 });
    const childEdge = (child: string) =>
      graph.edges.find(
        (edge) => edge.kind === 'parent' && (edge.to === child || edge.from === child),
      );

    expect(childEdge('A')?.union).toBe('FA');
    expect(childEdge('B')?.union).toBe('FB');
  });

  it('gives each marriage its own edge', () => {
    const graph = neighbourhood(twice, 'H', { depth: 2 });
    const marriages = graph.edges.filter((edge) => edge.kind === 'spouse');
    expect(
      marriages.map((edge) => edge.union).sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual(['FA', 'FB']);
  });
});

describe('against Royal92', () => {
  const royal = analyze(fixture('v5/Royal92.ged').bytes);

  /**
   * Redraws the neighbourhood around each of a person's relatives in turn, and
   * asks whether the people common to both drawings kept their order.
   *
   * Not every case can hold: two drawings centred on different people contain
   * different sets of relatives, and somebody's spouse appearing for the first
   * time genuinely does take up a row. The figures below are what the intrinsic
   * ordering achieves — a floor to defend and to raise, not a claim that the
   * problem is solved. Ordering against neighbouring columns instead, which is
   * the textbook way to minimise crossings, scored around 40% here.
   */
  function agreement(pick: (graph: ReturnType<typeof neighbourhood>) => Map<string, unknown[]>) {
    const people = [...royal.xrefs.definitions]
      .filter(([, record]) => record.tag === 'INDI')
      .map(([xref]) => xref)
      .slice(0, 120);

    let compared = 0;
    let unchanged = 0;

    for (const xref of people) {
      const base = neighbourhood(royal, xref, { depth: 2 });
      const where = new Map(base.nodes.map((node) => [node.xref, node.y]));

      for (const relative of base.nodes.filter((node) => node.xref !== xref).slice(0, 3)) {
        const next = neighbourhood(royal, relative.xref, { depth: 2 });

        for (const [, group] of pick(next)) {
          const shared = (group as { xref: string; y: number }[]).filter((node) =>
            where.has(node.xref),
          );
          if (shared.length < 2) continue;

          const before = [...shared]
            .sort((a, b) => where.get(a.xref)! - where.get(b.xref)!)
            .map((node) => node.xref)
            .join(' ');
          const after = [...shared]
            .sort((a, b) => a.y - b.y)
            .map((node) => node.xref)
            .join(' ');

          compared++;
          if (before === after) unchanged++;
        }
      }
    }

    return { compared, ratio: unchanged / compared };
  }

  it('keeps a set of siblings in the same order as the selection moves', () => {
    const { compared, ratio } = agreement((graph) => {
      const byFamily = new Map<string, typeof graph.nodes>();
      for (const node of graph.nodes) {
        if (node.family === undefined) continue;
        byFamily.set(node.family, [...(byFamily.get(node.family) ?? []), node]);
      }
      return byFamily;
    });

    expect(compared).toBeGreaterThan(100);
    expect(ratio).toBeGreaterThan(0.73);
  });

  it('keeps a whole column in the same order as the selection moves', () => {
    const { compared, ratio } = agreement((graph) => {
      const byColumn = new Map<number, typeof graph.nodes>();
      for (const node of graph.nodes) {
        byColumn.set(node.generation, [...(byColumn.get(node.generation) ?? []), node]);
      }
      return byColumn as unknown as Map<string, unknown[]>;
    });

    expect(compared).toBeGreaterThan(500);
    expect(ratio).toBeGreaterThan(0.87);
  });
});
