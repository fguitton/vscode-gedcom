/**
 * The genealogical graph, and a layout for drawing part of it.
 *
 * A GEDCOM file *is* a graph, but not the graph anybody wants to look at. The
 * file's graph has a `FAM` record sitting between every pair of relatives,
 * because that is how the format stores a marriage and its children — one join
 * record, pointed at from both sides. Drawn literally, a grandparent is four hops
 * from a grandchild, half the boxes on screen are join records with no names in
 * them, and the reader is being shown the storage schema rather than the family.
 *
 * So families are collapsed. Nodes are people; edges are relationships between
 * people, derived by joining through the `FAM` records and then discarding them.
 * The one exception is a family the reader is actually looking at, which is shown
 * with its members around it.
 *
 * Layout lives here rather than in the webview because it is the part worth
 * testing, and because the same code then positions the graph whether it is drawn
 * in the editor, on vscode.dev, or in a test.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { yearOf } from './date.ts';
import { modelFor, tagLabel } from './spec/index.ts';
import { asPointer } from './xref.ts';

/** What connects two records. Drives both the label and the drawing. */
export type RelationKind =
  | 'spouse'
  | 'parent'
  | 'sibling'
  /** A non-family pointer: a citation, an associate, an object. */
  | 'reference';

export interface GraphNode {
  /** Cross-reference identifier, without at-signs. */
  readonly xref: string;
  readonly tag: string;
  /** The record type in English — "Individual" rather than `INDI`. */
  readonly kind: string;
  /** A human-readable summary — a name, a title, or the tag as a fallback. */
  readonly label: string;
  /** Lifespan for a person, or the record type for anything else. */
  readonly detail: string;
  /** Hops from the focus. Zero is the focus itself. */
  readonly distance: number;
  /**
   * Generations from the focus: negative for ancestors, positive for
   * descendants, zero for the focus, its spouses and its siblings.
   *
   * This, not the hop count, is what a column means. Laid out by distance, a
   * sibling and a grandparent share a column because both are two hops away,
   * which puts two generations side by side and reads as nonsense.
   */
  readonly generation: number;
  /** Line the record is defined on, for revealing it in the editor. */
  readonly line: number;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: RelationKind;
  /** How `to` relates to `from` — "Child", "Spouse". */
  readonly label: string;
  /** How `from` relates to `to`, for when the edge is drawn the other way round. */
  readonly reverseLabel: string;
  /** Line the relationship is written on. */
  readonly line: number;
}

export interface PositionedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
}

export interface Graph {
  /** The record the cursor is in. Not always drawn: a family never is. */
  readonly focus: string | null;
  /**
   * The nodes to highlight. Usually just the focus, but the cursor sitting in a
   * family highlights everyone in it, since the family itself has no box.
   */
  readonly focused: readonly string[];
  readonly nodes: PositionedNode[];
  readonly edges: GraphEdge[];
  /** Nodes omitted because the neighbourhood was truncated, by node. */
  readonly elided: ReadonlyMap<string, number>;
  readonly width: number;
  readonly height: number;
}

const EMPTY: Graph = {
  focus: null,
  focused: [],
  nodes: [],
  edges: [],
  elided: new Map(),
  width: 0,
  height: 0,
};

/** The tags that exist only to wire a family together, and are collapsed away. */
const FAMILY_TAGS = new Set(['FAMC', 'FAMS', 'HUSB', 'WIFE', 'CHIL']);

interface Link {
  readonly to: string;
  readonly kind: RelationKind;
  readonly label: string;
  readonly reverseLabel: string;
  /** Generations crossed by following this link: -1 up, +1 down, 0 sideways. */
  readonly step: number;
  readonly line: number;
}

/** A short description of a record, used as its label in the graph. */
function labelFor(record: Structure): string {
  const name = record.children.find((c) => c.tag === 'NAME')?.payload;
  if (name) return name.replace(/\//g, '').trim();

  const title = record.children.find((c) => c.tag === 'TITL')?.payload;
  if (title) return title.slice(0, 40);

  if (record.payload) return record.payload.split('\n')[0]!.slice(0, 40);
  return record.tag;
}

/** Pointer payloads of a record's direct children bearing the given tag. */
function pointers(record: Structure, tag: string): string[] {
  const found: string[] = [];
  for (const child of record.children) {
    if (child.tag !== tag) continue;
    const pointer = asPointer(child);
    if (pointer !== null && pointer !== 'VOID') found.push(pointer);
  }
  return found;
}

const lineOf = (record: Structure, tag: string): number =>
  record.children.find((c) => c.tag === tag)?.span.line ?? record.span.line;

/**
 * Birth and death years, which are what tells two people of the same name apart.
 *
 * The single most useful thing a box can carry beyond the name: a tree full of
 * Louis and Alexandra is unreadable without dates, and the reader would otherwise
 * have to click each one to find out which generation it belongs to.
 */
function lifespanOf(record: Structure): string | undefined {
  const yearOfEvent = (tag: string): number | undefined => {
    const date = record.children.find((c) => c.tag === tag)?.children.find((c) => c.tag === 'DATE');
    return date?.payload ? yearOf(date.payload) : undefined;
  };

  const birth = yearOfEvent('BIRT') ?? yearOfEvent('BAPM') ?? yearOfEvent('CHR');
  const death = yearOfEvent('DEAT') ?? yearOfEvent('BURI');

  if (birth === undefined && death === undefined) return undefined;
  if (birth !== undefined && death !== undefined) return `${birth}–${death}`;
  if (birth !== undefined) return `b. ${birth}`;
  return `d. ${death}`;
}

/** The year a couple married, for labelling the edge between them. */
function marriageYear(family: Structure): number | undefined {
  const date = family.children
    .find((c) => c.tag === 'MARR')
    ?.children.find((c) => c.tag === 'DATE');
  return date?.payload ? yearOf(date.payload) : undefined;
}

/**
 * Relationships between people, with the family records joined out.
 *
 * Both directions of every relationship are recorded, because the drawing decides
 * later which way round to run each edge and the label has to follow.
 */
function relationships(analysis: Analysis): Map<string, Link[]> {
  const links = new Map<string, Link[]>();

  const add = (from: string, link: Link): void => {
    links.set(from, [...(links.get(from) ?? []), link]);
  };

  /** Records a relationship from both ends, with the generation step inverted. */
  const pair = (
    a: string,
    b: string,
    kind: RelationKind,
    aToB: string,
    bToA: string,
    line: number,
    step: number,
  ): void => {
    if (a === b) return;
    add(a, { to: b, kind, label: aToB, reverseLabel: bToA, line, step });
    add(b, { to: a, kind, label: bToA, reverseLabel: aToB, line, step: -step });
  };

  for (const [, record] of analysis.xrefs.definitions) {
    if (record.tag !== 'FAM') continue;

    const partners = [...pointers(record, 'HUSB'), ...pointers(record, 'WIFE')];
    const children = pointers(record, 'CHIL');

    const married = marriageYear(record);
    const spouseLabel = married === undefined ? 'Spouse' : `Married ${married}`;

    for (const [index, a] of partners.entries()) {
      for (const b of partners.slice(index + 1)) {
        pair(a, b, 'spouse', spouseLabel, spouseLabel, lineOf(record, 'MARR'), 0);
      }
    }

    for (const parent of partners) {
      for (const child of children) {
        pair(parent, child, 'parent', 'Child', 'Parent', lineOf(record, 'CHIL'), 1);
      }
    }

    // Siblings are normally reachable through a shared parent in two hops, and
    // drawing them as well would add a complete graph among every set of
    // siblings for no new information. A family with no recorded parents has no
    // such route, so there the sibling edges are the only thing holding the
    // group together.
    if (partners.length === 0) {
      for (const [index, a] of children.entries()) {
        for (const b of children.slice(index + 1)) {
          pair(a, b, 'sibling', 'Sibling', 'Sibling', lineOf(record, 'CHIL'), 0);
        }
      }
    }
  }

  return links;
}

/**
 * Pointers that are not family wiring: citations, associates, media.
 *
 * These stay as they are written, because there is no join to collapse — a
 * source really is a separate thing that a record points at.
 */
function references(analysis: Analysis, model: ReturnType<typeof modelFor>): Map<string, Link[]> {
  const links = new Map<string, Link[]>();

  const add = (from: string, link: Link): void => {
    links.set(from, [...(links.get(from) ?? []), link]);
  };

  const visit = (owner: string, structure: Structure): void => {
    const pointer = asPointer(structure);
    if (pointer !== null && pointer !== 'VOID' && !FAMILY_TAGS.has(structure.tag)) {
      const label = tagLabel(model, structure.tag);
      // A citation is not a generation, so it stays in the same column.
      const shared = { kind: 'reference' as const, label, reverseLabel: label, step: 0 };
      add(owner, { ...shared, to: pointer, line: structure.span.line });
      add(pointer, { ...shared, to: owner, line: structure.span.line });
    }
    for (const child of structure.children) visit(owner, child);
  };

  for (const [xref, record] of analysis.xrefs.definitions) {
    // A family's own pointers are its wiring, already collapsed into
    // relationships; anything else it cites belongs to the couple, not the graph.
    if (record.tag === 'FAM') continue;
    for (const child of record.children) visit(xref, child);
  }

  return links;
}

/**
 * The people a family record is about, and which generation each sits in.
 *
 * A `FAM` is never drawn, not even when it is the record under the cursor. It is
 * a join, not a person: it has no name, no dates, and nothing to say that its
 * members do not say better. Putting the cursor in one asks to see *that family*,
 * and a family is a couple joined by a marriage bar with their children beside
 * them — which is exactly what the person graph already draws.
 */
function familySeeds(family: Structure): { xref: string; generation: number }[] {
  return [
    ...pointers(family, 'HUSB').map((xref) => ({ xref, generation: 0 })),
    ...pointers(family, 'WIFE').map((xref) => ({ xref, generation: 0 })),
    ...pointers(family, 'CHIL').map((xref) => ({ xref, generation: 1 })),
  ];
}

/**
 * Which way to travel through the generations.
 *
 * A tree read in both directions at once is the densest it can be, and often not
 * what the reader is doing: tracing a line back is a different task from
 * following it forward, and each one is half the graph.
 */
export type Direction = 'both' | 'ancestors' | 'descendants';

export interface NeighbourhoodOptions {
  /** How many hops to include. Two shows a person, their family and their in-laws. */
  readonly depth?: number;
  /** Defaults to `both`. Spouses are kept whichever way the reader is travelling. */
  readonly direction?: Direction;
  /**
   * Cap on nodes. A well-connected record in a large file can pull in hundreds
   * at depth two, which is neither readable nor quick to draw.
   */
  readonly maxNodes?: number;
  /**
   * Include citations, associates and media alongside relatives. Off by default:
   * a well-sourced person cites dozens of records, and they crowd out the family
   * the panel exists to show.
   */
  readonly includeReferences?: boolean;
}

/**
 * Extracts the neighbourhood around a record.
 *
 * Relationships run in both directions by construction, so a person is connected
 * to their parents and their children alike without the caller caring which way
 * the file happens to write each pointer.
 */
export function neighbourhood(
  analysis: Analysis,
  focusXref: string | null,
  options: NeighbourhoodOptions = {},
): Graph {
  if (focusXref === null) return EMPTY;

  const focusRecord = analysis.xrefs.definitions.get(focusXref);
  if (!focusRecord) return EMPTY;

  const depth = options.depth ?? 2;
  const maxNodes = options.maxNodes ?? 60;
  const model = modelFor(analysis.version);

  const family = relationships(analysis);
  const cited = options.includeReferences ? references(analysis, model) : new Map<string, Link[]>();

  // Putting the cursor in a family asks to see that family, so its members are
  // what the search starts from. The family record itself is never drawn.
  const seeds = (
    focusRecord.tag === 'FAM' ? familySeeds(focusRecord) : [{ xref: focusXref, generation: 0 }]
  ).filter((seed) => analysis.xrefs.definitions.has(seed.xref));

  if (seeds.length === 0) return EMPTY;

  const direction = options.direction ?? 'both';

  /**
   * Whether a link runs the way the reader is travelling.
   *
   * A parent link's label says which end the neighbour is at, so the test is
   * simply which word it carries. Spouses and everything else are kept in both
   * directions: a marriage belongs to a line of descent as much as to a line of
   * ancestry, and dropping it would leave half of every couple unexplained.
   */
  const travels = (link: Link): boolean => {
    if (direction === 'both' || link.kind !== 'parent') return true;
    return direction === 'ancestors' ? link.label === 'Parent' : link.label === 'Child';
  };

  // Families are collapsed away entirely, so one can never appear as a node.
  const neighboursOf = (xref: string): Link[] =>
    [...(family.get(xref) ?? []), ...(cited.get(xref) ?? [])].filter(travels);

  const distances = new Map<string, number>();
  // Generation runs alongside distance because they answer different questions:
  // distance bounds the search, generation decides which column a person is in.
  const generations = new Map<string, number>();
  const order: string[] = [];
  const elided = new Map<string, number>();

  for (const seed of seeds) {
    if (distances.has(seed.xref)) continue;
    distances.set(seed.xref, 0);
    generations.set(seed.xref, seed.generation);
    order.push(seed.xref);
  }

  for (let index = 0; index < order.length; index++) {
    const xref = order[index]!;
    const distance = distances.get(xref)!;
    if (distance >= depth) continue;

    let skipped = 0;
    for (const link of neighboursOf(xref)) {
      if (distances.has(link.to)) continue;
      if (!analysis.xrefs.definitions.has(link.to)) continue;

      if (order.length >= maxNodes) {
        skipped++;
        continue;
      }
      distances.set(link.to, distance + 1);
      generations.set(link.to, generations.get(xref)! + link.step);
      order.push(link.to);
    }

    if (skipped > 0) elided.set(xref, skipped);
  }

  const included = new Set(order);
  const nodes: GraphNode[] = order.map((xref) => {
    const record = analysis.xrefs.definitions.get(xref)!;
    const kind = tagLabel(model, record.tag, analysis.validation.resolutions.get(record)?.slug);
    return {
      xref,
      tag: record.tag,
      kind,
      label: labelFor(record),
      detail: (record.tag === 'INDI' ? lifespanOf(record) : undefined) ?? kind,
      distance: distances.get(xref)!,
      generation: generations.get(xref)!,
      line: record.span.line,
    };
  });

  // One edge per pair. Relationships are symmetric here by construction, so
  // without this every one would be drawn twice, along the same path, with the
  // two labels landing on the same point.
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const xref of order) {
    for (const link of neighboursOf(xref)) {
      if (!included.has(link.to)) continue;
      const key = [xref, link.to].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: xref,
        to: link.to,
        kind: link.kind,
        label: link.label,
        reverseLabel: link.reverseLabel,
        line: link.line,
      });
    }
  }

  return {
    focus: focusXref,
    focused: seeds.map((seed) => seed.xref),
    ...layout(nodes, edges),
    edges,
    elided,
  };
}

/**
 * Wide enough for a relationship label to sit in the gutter between two columns.
 * At 220 the gutter was fifty pixels and "Married 1874" was drawn over the boxes.
 */
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 64;
const MARGIN = 24;

/**
 * Positions nodes in columns by generation.
 *
 * By generation rather than by hop count, which is the same distinction a
 * pedigree chart makes. Laid out by hops, a sibling and a grandparent share a
 * column because both are two steps away — so two generations sit side by side
 * and the drawing says something false about the family. Ancestors now run left
 * of the focus and descendants right, which is also the direction people read a
 * family tree in.
 *
 * Deliberately deterministic. A force-directed layout would look livelier and
 * settle somewhere different every time it ran, which is the wrong trade for a
 * panel that redraws as the cursor moves: a node jumping position on every
 * keystroke is worse than a plain arrangement that holds still.
 */
function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: PositionedNode[]; width: number; height: number } {
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    columns.set(node.generation, [...(columns.get(node.generation) ?? []), node]);
  }

  const ordered = [...columns.entries()].sort((a, b) => a[0] - b[0]);

  // Sort within a column so ordering does not depend on traversal order.
  for (const [, column] of ordered) {
    column.sort((a, b) => a.tag.localeCompare(b.tag) || a.label.localeCompare(b.label));
  }

  reduceCrossings(ordered, edges);

  const tallest = Math.max(...ordered.map(([, column]) => column.length), 1);
  const height = tallest * ROW_HEIGHT + MARGIN * 2;

  // Generations are relative to the focus and go negative for ancestors; the
  // leftmost becomes column zero.
  const earliest = ordered[0]?.[0] ?? 0;

  const positioned: PositionedNode[] = [];
  for (const [generation, column] of ordered) {
    // Centre each column vertically so the focus sits in the middle.
    const offset = (tallest - column.length) / 2;
    column.forEach((node, index) => {
      positioned.push({
        ...node,
        x: MARGIN + (generation - earliest) * COLUMN_WIDTH,
        y: MARGIN + (offset + index) * ROW_HEIGHT,
      });
    });
  }

  const width = ordered.length * COLUMN_WIDTH + MARGIN;
  return { nodes: positioned, width, height };
}

/**
 * Orders each column so the lines between columns cross as little as possible.
 *
 * The barycentre heuristic — put each thing at the average position of what it
 * connects to — with two adaptations that matter for a family tree.
 *
 * The first is that a **couple is one unit**, not two nodes. Their children all
 * descend from a single point on the marriage bar between them, so they have to
 * stay adjacent for the drawing to read; and ordering them independently is
 * self-defeating anyway, since both partners are pulled towards exactly the same
 * children and land wherever the average puts them.
 *
 * The second is that it **sweeps both ways, several times**. One left-to-right
 * pass only ever accounts for the column behind, so the leftmost ancestors never
 * move at all and everything downstream inherits their arbitrary order.
 *
 * A fixed number of sweeps with deterministic tie-breaking, never iteration to
 * convergence: the panel redraws as the cursor moves, and a node that settles
 * somewhere different on each keystroke is worse than a few crossings.
 */
const SWEEPS = 4;

interface Unit {
  readonly members: GraphNode[];
  /** Keeps ties in the order they arrived, so sorting is a total order. */
  readonly seed: number;
}

function reduceCrossings(columns: [number, GraphNode[]][], edges: GraphEdge[]): void {
  const partners = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind !== 'spouse') continue;
    // First marriage wins: someone married twice cannot sit beside both, and
    // picking deterministically beats letting traversal order decide.
    if (!partners.has(edge.from)) partners.set(edge.from, edge.to);
    if (!partners.has(edge.to)) partners.set(edge.to, edge.from);
  }

  /** Neighbours of each node, for the barycentre. */
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === 'spouse') continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }

  /** A column as units: couples merged, everyone else alone. */
  const unitsOf = (column: GraphNode[]): Unit[] => {
    const present = new Map(column.map((node) => [node.xref, node]));
    const taken = new Set<string>();
    const units: Unit[] = [];

    for (const node of column) {
      if (taken.has(node.xref)) continue;
      taken.add(node.xref);

      const partner = partners.get(node.xref);
      const beside = partner === undefined ? undefined : present.get(partner);
      if (beside && !taken.has(beside.xref)) {
        taken.add(beside.xref);
        units.push({ members: [node, beside], seed: units.length });
      } else {
        units.push({ members: [node], seed: units.length });
      }
    }

    return units;
  };

  const rank = new Map<string, number>();
  const recordRanks = (column: GraphNode[]): void => {
    column.forEach((node, position) => rank.set(node.xref, position));
  };

  for (const [, column] of columns) recordRanks(column);

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    // Alternate direction so every column is eventually ordered against both of
    // its neighbours rather than only the one behind it.
    const order = sweep % 2 === 0 ? columns : [...columns].reverse();

    for (const [, column] of order) {
      const units = unitsOf(column);

      const barycentre = new Map<Unit, number>();
      for (const unit of units) {
        const positions: number[] = [];
        for (const member of unit.members) {
          for (const other of adjacency.get(member.xref) ?? []) {
            const placed = rank.get(other);
            if (placed !== undefined) positions.push(placed);
          }
        }
        barycentre.set(
          unit,
          // Anything with nothing placed keeps the slot it already had rather
          // than being swept to the top.
          positions.length === 0
            ? unit.seed
            : positions.reduce((sum, value) => sum + value, 0) / positions.length,
        );
      }

      units.sort((a, b) => barycentre.get(a)! - barycentre.get(b)! || a.seed - b.seed);

      const flattened = units.flatMap((unit) => unit.members);
      column.splice(0, column.length, ...flattened);
      recordRanks(column);
    }
  }
}

/**
 * The record containing a position — the graph's focus follows the cursor, and
 * the cursor is usually inside a record rather than on its first line.
 */
export function recordAt(analysis: Analysis, line: number): string | null {
  let found: string | null = null;
  for (const record of analysis.document.records) {
    if (record.span.line > line) break;
    if (record.xref !== null) found = record.xref;
    else found = null;
  }
  return found;
}
