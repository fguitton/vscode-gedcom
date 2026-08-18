/**
 * Kinship and relationship calculation engine.
 *
 * Computes exact degrees of consanguinity (blood) and affinity (marriage/in-law)
 * between two individuals in a GEDCOM family tree, with common ancestor tracking
 * and full connection path reconstruction.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { getFormatter } from './kinship/formatters/index.ts';
import type { KinshipFormatter } from './kinship/types.ts';
import { displayName } from './name.ts';
import { relationsOf } from './relations.ts';
import { asPointer } from './xref.ts';

export type { KinshipFormatter } from './kinship/types.ts';
export { getFormatter } from './kinship/formatters/index.ts';

export interface Kinship {
  /** Relationship title in the requested language (e.g. "First cousin once removed", "Père", "Époux"). */
  readonly relationship: string;
  /** Detailed description sentence. */
  readonly description: string;
  /** Common ancestor individual XREFs (empty if relation is by affinity/marriage). */
  readonly commonAncestors: readonly string[];
  /** Detailed connection path between the two individuals. */
  readonly path: readonly string[];
  /** Graph distance in hops. */
  readonly distance: number;
}

export interface KinshipOptions {
  /** Output language for relationship titles and descriptions. Defaults to 'en'. */
  readonly locale?: string;
  /** Custom kinship formatter implementation. Overrides locale if provided. */
  readonly formatter?: KinshipFormatter;
}

interface AncestorEntry {
  readonly xref: string;
  readonly depth: number;
  /** Path from starting person up to this ancestor (including intermediate FAM records). */
  readonly path: string[];
}

const norm = (xref: string) => xref.replace(/^@|@$/g, '');

function nameOf(analysis: Analysis, xref: string): string {
  const record = analysis.xrefs.definitions.get(norm(xref));
  if (!record) return xref;
  const name = record.children.find((c) => c.tag === 'NAME')?.payload;
  return name ? displayName(name) : xref;
}

function sexOf(analysis: Analysis, xref: string): 'M' | 'F' | 'U' {
  const record = analysis.xrefs.definitions.get(norm(xref));
  const sex = record?.children
    .find((c) => c.tag === 'SEX')
    ?.payload?.trim()
    .toUpperCase();
  if (sex === 'M' || sex === 'MALE') return 'M';
  if (sex === 'F' || sex === 'FEMALE') return 'F';
  return 'U';
}

function pointers(record: Structure, tag: string): string[] {
  const found: string[] = [];
  for (const child of record.children) {
    if (child.tag !== tag) continue;
    const pointer = asPointer(child);
    if (pointer !== null && pointer !== 'VOID') found.push(pointer);
  }
  return found;
}

/** Traces all ancestors of an individual with generation depth and traversal path. */
function collectAncestors(analysis: Analysis, startXref: string): Map<string, AncestorEntry[]> {
  const map = new Map<string, AncestorEntry[]>();
  const queue: { xref: string; depth: number; path: string[] }[] = [
    { xref: startXref, depth: 0, path: [startXref] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const existing = map.get(current.xref) || [];
    existing.push(current);
    map.set(current.xref, existing);

    const rels = relationsOf(analysis, current.xref);
    for (const famc of rels.childFamilies) {
      const fam = analysis.xrefs.definitions.get(famc);
      if (!fam) continue;
      const parents = [...pointers(fam, 'HUSB'), ...pointers(fam, 'WIFE')];
      for (const parent of parents) {
        if (!current.path.includes(parent)) {
          queue.push({
            xref: parent,
            depth: current.depth + 1,
            path: [...current.path, famc, parent],
          });
        }
      }
    }
  }

  return map;
}

/** General BFS on family graph to find shortest path for affinity/in-law relationships. */
function shortestGraphPath(
  analysis: Analysis,
  startXref: string,
  targetXref: string,
): string[] | undefined {
  if (startXref === targetXref) return [startXref];

  const visited = new Set<string>([startXref]);
  const queue: { xref: string; path: string[] }[] = [{ xref: startXref, path: [startXref] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const structure = analysis.xrefs.definitions.get(current.xref);
    const isIndi = structure?.tag === 'INDI';

    if (current.xref === targetXref) {
      return current.path;
    }

    if (isIndi) {
      const rels = relationsOf(analysis, current.xref);
      const fams = [...rels.spouseFamilies, ...rels.childFamilies];
      for (const fam of fams) {
        if (!visited.has(fam)) {
          visited.add(fam);
          queue.push({ xref: fam, path: [...current.path, fam] });
        }
      }
    } else {
      // It's a FAM record
      if (structure) {
        const members = [
          ...pointers(structure, 'HUSB'),
          ...pointers(structure, 'WIFE'),
          ...pointers(structure, 'CHIL'),
        ];
        for (const m of members) {
          if (!visited.has(m)) {
            visited.add(m);
            queue.push({ xref: m, path: [...current.path, m] });
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Calculates the exact genealogical relationship between two individuals in the tree.
 */
export function calculateKinship(
  analysis: Analysis,
  sourceXref: string,
  targetXref: string,
  options?: KinshipOptions,
): Kinship | undefined {
  const formatter = options?.formatter ?? getFormatter(options?.locale);
  const src = norm(sourceXref);
  const tgt = norm(targetXref);

  const sourceRecord = analysis.xrefs.definitions.get(src);
  const targetRecord = analysis.xrefs.definitions.get(tgt);

  if (!sourceRecord || !targetRecord) return undefined;

  const sourceName = nameOf(analysis, src);
  const targetName = nameOf(analysis, tgt);
  const targetSex = sexOf(analysis, tgt);

  if (src === tgt) {
    return {
      relationship: formatter.describeConsanguinity(0, 0, targetSex, false),
      description: formatter.describeIdentity(sourceName),
      commonAncestors: [src],
      path: [src],
      distance: 0,
    };
  }

  // 1. Check Consanguinity (Common Ancestors)
  const ancestorsA = collectAncestors(analysis, src);
  const ancestorsB = collectAncestors(analysis, tgt);

  let bestCommonAncestors: string[] = [];
  let bestDist = Infinity;
  let bestDA = 0;
  let bestDB = 0;
  let bestPath: string[] = [];

  for (const [ancXref, entriesA] of ancestorsA) {
    const entriesB = ancestorsB.get(ancXref);
    if (!entriesB) continue;

    for (const eA of entriesA) {
      for (const eB of entriesB) {
        const totalDist = eA.depth + eB.depth;
        if (totalDist < bestDist) {
          bestDist = totalDist;
          bestCommonAncestors = [ancXref];
          bestDA = eA.depth;
          bestDB = eB.depth;
          // Path from A to Anc, then from Anc to B
          const pathDown = [...eB.path].reverse();
          bestPath = [...eA.path.slice(0, -1), ...pathDown];
        } else if (totalDist === bestDist && !bestCommonAncestors.includes(ancXref)) {
          bestCommonAncestors.push(ancXref);
        }
      }
    }
  }

  if (bestCommonAncestors.length > 0) {
    // Check if half-relationship (sharing only 1 parent vs 2 parents)
    const isHalf =
      (bestDA === 1 && bestDB === 1 && bestCommonAncestors.length === 1) ||
      (bestDA > 1 && bestDB > 1 && bestCommonAncestors.length === 1);

    const relTitle = formatter.describeConsanguinity(bestDA, bestDB, targetSex, isHalf);
    const ancNames = bestCommonAncestors.map((x) => nameOf(analysis, x));
    const description = formatter.formatConsanguinityDescription(
      targetName,
      sourceName,
      relTitle,
      targetSex,
      ancNames,
    );

    return {
      relationship: relTitle,
      description,
      commonAncestors: bestCommonAncestors,
      path: bestPath,
      distance: bestDist,
    };
  }

  // 2. Check Affinity / Marriage / In-law via shortest graph path
  const path = shortestGraphPath(analysis, src, tgt);
  if (path) {
    // Determine direct spouse or in-law
    const sourceRels = relationsOf(analysis, src);
    if (sourceRels.spouses.includes(tgt)) {
      const affinity = formatter.describeAffinity('spouse', targetSex);
      return {
        relationship: affinity.title,
        description: affinity.description(targetName, sourceName),
        commonAncestors: [],
        path,
        distance: path.filter((x) => analysis.xrefs.definitions.get(x)?.tag === 'INDI').length - 1,
      };
    }

    // Step-parent
    for (const famc of sourceRels.childFamilies) {
      const fam = analysis.xrefs.definitions.get(famc);
      if (fam) {
        const parents = [...pointers(fam, 'HUSB'), ...pointers(fam, 'WIFE')];
        for (const p of parents) {
          const pRels = relationsOf(analysis, p);
          if (pRels.spouses.includes(tgt) && !parents.includes(tgt)) {
            const affinity = formatter.describeAffinity('stepparent', targetSex);
            return {
              relationship: affinity.title,
              description: affinity.description(targetName, sourceName),
              commonAncestors: [],
              path,
              distance: 2,
            };
          }
        }
      }
    }

    // In-law (Spouse's Sibling or Sibling's Spouse)
    const affinity = formatter.describeAffinity('in-law', targetSex);
    return {
      relationship: affinity.title,
      description: affinity.description(targetName, sourceName),
      commonAncestors: [],
      path,
      distance: path.filter((x) => analysis.xrefs.definitions.get(x)?.tag === 'INDI').length - 1,
    };
  }

  return undefined;
}
