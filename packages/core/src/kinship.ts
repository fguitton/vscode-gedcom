/**
 * Kinship and relationship calculation engine.
 *
 * Computes exact degrees of consanguinity (blood) and affinity (marriage/in-law)
 * between two individuals in a GEDCOM family tree, with common ancestor tracking
 * and full connection path reconstruction.
 */

import type { Analysis } from './index.ts';
import type { Structure } from './cst.ts';
import { relationsOf } from './relations.ts';
import { asPointer } from './xref.ts';

export interface Kinship {
  /** Canonical English relationship title (e.g. "First cousin once removed", "Paternal Grandfather", "Spouse"). */
  readonly relationship: string;
  /** Detailed description (e.g. "Queen Victoria is the 3rd cousin of Prince Philip through Francis, Duke of Saxe-Coburg-Saalfeld"). */
  readonly description: string;
  /** Common ancestor individual XREFs (empty if relation is by affinity/marriage). */
  readonly commonAncestors: readonly string[];
  /** Complete path of alternating individual and family XREFs connecting source to target. */
  readonly path: readonly string[];
  /** Graph distance in hops. */
  readonly distance: number;
}

export interface KinshipOptions {
  /** Output language for relationship titles and descriptions. Defaults to 'en'. */
  readonly locale?: string;
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
  const name = record.children
    .find((c) => c.tag === 'NAME')
    ?.payload?.replace(/\//g, '')
    .trim();
  return name || xref;
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] || 'th');
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

function describeConsanguinityEn(
  dA: number,
  dB: number,
  sex: 'M' | 'F' | 'U',
  isHalf: boolean,
): string {
  const prefix = isHalf ? 'Half-' : '';

  if (dA === 0 && dB === 0) return 'Self';

  // Target is Descendant of Source (dA = 0, dB > 0)
  if (dA === 0) {
    if (dB === 1) return sex === 'M' ? 'Son' : sex === 'F' ? 'Daughter' : 'Child';
    if (dB === 2) return sex === 'M' ? 'Grandson' : sex === 'F' ? 'Granddaughter' : 'Grandchild';
    if (dB === 3)
      return sex === 'M'
        ? 'Great-grandson'
        : sex === 'F'
          ? 'Great-granddaughter'
          : 'Great-grandchild';
    const greats = dB - 2;
    return `${ordinal(greats)} Great-${sex === 'M' ? 'grandson' : sex === 'F' ? 'granddaughter' : 'grandchild'}`;
  }

  // Target is Ancestor of Source (dA > 0, dB = 0)
  if (dB === 0) {
    if (dA === 1) return sex === 'M' ? 'Father' : sex === 'F' ? 'Mother' : 'Parent';
    if (dA === 2) return sex === 'M' ? 'Grandfather' : sex === 'F' ? 'Grandmother' : 'Grandparent';
    if (dA === 3)
      return sex === 'M'
        ? 'Great-grandfather'
        : sex === 'F'
          ? 'Great-grandmother'
          : 'Great-grandparent';
    const greats = dA - 2;
    return `${ordinal(greats)} Great-${sex === 'M' ? 'grandfather' : sex === 'F' ? 'grandmother' : 'grandparent'}`;
  }

  // Siblings (dA = 1, dB = 1)
  if (dA === 1 && dB === 1) {
    const siblingTerm = sex === 'M' ? 'Brother' : sex === 'F' ? 'Sister' : 'Sibling';
    return isHalf ? `Half-${siblingTerm.toLowerCase()}` : siblingTerm;
  }

  // Aunt / Uncle (dA > 1, dB = 1) -> Target is child of Source's ancestor
  if (dB === 1) {
    if (dA === 2) {
      const term = sex === 'M' ? 'Uncle' : sex === 'F' ? 'Aunt' : 'Pibling';
      return isHalf ? `Half-${term.toLowerCase()}` : term;
    }
    if (dA === 3) {
      const term = sex === 'M' ? 'Great-uncle' : sex === 'F' ? 'Great-aunt' : 'Great-pibling';
      return isHalf ? `Half-${term.toLowerCase()}` : term;
    }
    const greats = dA - 2;
    const term = sex === 'M' ? 'Great-uncle' : sex === 'F' ? 'Great-aunt' : 'Great-pibling';
    return `${prefix}${ordinal(greats)} ${term}`;
  }

  // Niece / Nephew (dA = 1, dB > 1) -> Target is child of Source's sibling
  if (dA === 1) {
    if (dB === 2) {
      const term = sex === 'M' ? 'Nephew' : sex === 'F' ? 'Niece' : 'Nibling';
      return isHalf ? `Half-${term.toLowerCase()}` : term;
    }
    if (dB === 3) {
      const term = sex === 'M' ? 'Great-nephew' : sex === 'F' ? 'Great-niece' : 'Great-nibling';
      return isHalf ? `Half-${term.toLowerCase()}` : term;
    }
    const greats = dB - 2;
    const term = sex === 'M' ? 'Great-nephew' : sex === 'F' ? 'Great-niece' : 'Great-nibling';
    return `${prefix}${ordinal(greats)} ${term}`;
  }

  // Cousins (dA >= 2, dB >= 2)
  const cousinDegree = Math.min(dA, dB) - 1;
  const removal = Math.abs(dA - dB);

  let cousinTitle = `${ordinal(cousinDegree)} cousin`;
  if (isHalf) cousinTitle = `Half-${cousinTitle}`;

  if (removal === 0) return cousinTitle;
  if (removal === 1) return `${cousinTitle} once removed`;
  if (removal === 2) return `${cousinTitle} twice removed`;
  return `${cousinTitle} ${removal} times removed`;
}

function describeConsanguinityFr(
  dA: number,
  dB: number,
  sex: 'M' | 'F' | 'U',
  isHalf: boolean,
): string {
  if (dA === 0 && dB === 0) return 'Même personne';

  // Target is Descendant of Source (dA = 0, dB > 0)
  if (dA === 0) {
    if (dB === 1) return sex === 'M' ? 'Fils' : sex === 'F' ? 'Fille' : 'Enfant';
    if (dB === 2) return sex === 'M' ? 'Petit-fils' : sex === 'F' ? 'Petite-fille' : 'Petit-enfant';
    if (dB === 3)
      return sex === 'M'
        ? 'Arrière-petit-fils'
        : sex === 'F'
          ? 'Arrière-petite-fille'
          : 'Arrière-petit-enfant';
    const greats = dB - 2;
    return `Arrière-petit-${sex === 'M' ? 'fils' : sex === 'F' ? 'fille' : 'enfant'} au ${greats}e degré`;
  }

  // Target is Ancestor of Source (dA > 0, dB = 0)
  if (dB === 0) {
    if (dA === 1) return sex === 'M' ? 'Père' : sex === 'F' ? 'Mère' : 'Parent';
    if (dA === 2) return sex === 'M' ? 'Grand-père' : sex === 'F' ? 'Grand-mère' : 'Grand-parent';
    if (dA === 3)
      return sex === 'M'
        ? 'Arrière-grand-père'
        : sex === 'F'
          ? 'Arrière-grand-mère'
          : 'Arrière-grand-parent';
    const greats = dA - 2;
    return `Arrière-grand-${sex === 'M' ? 'père' : sex === 'F' ? 'mère' : 'parent'} au ${greats}e degré`;
  }

  // Siblings (dA = 1, dB = 1)
  if (dA === 1 && dB === 1) {
    if (isHalf) {
      return sex === 'M' ? 'Demi-frère' : sex === 'F' ? 'Demi-sœur' : 'Demi-frère ou demi-sœur';
    }
    return sex === 'M' ? 'Frère' : sex === 'F' ? 'Sœur' : 'Frère ou sœur';
  }

  // Aunt / Uncle (dA > 1, dB = 1) -> Target is child of Source's ancestor
  if (dB === 1) {
    if (dA === 2) {
      if (isHalf)
        return sex === 'M' ? 'Demi-oncle' : sex === 'F' ? 'Demi-tante' : 'Demi-oncle ou demi-tante';
      return sex === 'M' ? 'Oncle' : sex === 'F' ? 'Tante' : 'Oncle ou tante';
    }
    if (dA === 3) {
      if (isHalf)
        return sex === 'M'
          ? 'Demi-grand-oncle'
          : sex === 'F'
            ? 'Demi-grand-tante'
            : 'Demi-grand-oncle ou demi-grand-tante';
      return sex === 'M'
        ? 'Grand-oncle'
        : sex === 'F'
          ? 'Grand-tante'
          : 'Grand-oncle ou grand-tante';
    }
    const greats = dA - 2;
    const term = sex === 'M' ? 'oncle' : sex === 'F' ? 'tante' : 'oncle ou tante';
    return `${isHalf ? 'Demi-' : ''}Arrière-grand-${term} au ${greats}e degré`;
  }

  // Niece / Nephew (dA = 1, dB > 1) -> Target is child of Source's sibling
  if (dA === 1) {
    if (dB === 2) {
      if (isHalf)
        return sex === 'M' ? 'Demi-neveu' : sex === 'F' ? 'Demi-nièce' : 'Demi-neveu ou demi-nièce';
      return sex === 'M' ? 'Neveu' : sex === 'F' ? 'Nièce' : 'Neveu ou nièce';
    }
    if (dB === 3) {
      if (isHalf)
        return sex === 'M'
          ? 'Demi-petit-neveu'
          : sex === 'F'
            ? 'Demi-petite-nièce'
            : 'Demi-petit-neveu ou demi-petite-nièce';
      return sex === 'M'
        ? 'Petit-neveu'
        : sex === 'F'
          ? 'Petite-nièce'
          : 'Petit-neveu ou petite-nièce';
    }
    const greats = dB - 2;
    const term = sex === 'M' ? 'neveu' : sex === 'F' ? 'nièce' : 'neveu ou nièce';
    return `${isHalf ? 'Demi-' : ''}Arrière-petit-${term} au ${greats}e degré`;
  }

  // Cousins (dA >= 2, dB >= 2)
  const cousinDegree = Math.min(dA, dB) - 1;
  const removal = Math.abs(dA - dB);

  let cousinTitle = '';
  if (cousinDegree === 1) {
    cousinTitle = sex === 'F' ? 'Cousine germaine' : 'Cousin germain';
  } else if (cousinDegree === 2) {
    cousinTitle = sex === 'F' ? 'Cousine issue de germains' : 'Cousin issu de germains';
  } else {
    cousinTitle =
      sex === 'F' ? `Cousine au ${cousinDegree}e degré` : `Cousin au ${cousinDegree}e degré`;
  }

  if (isHalf) {
    cousinTitle = `Demi-${cousinTitle.toLowerCase()}`;
    cousinTitle = cousinTitle.charAt(0).toUpperCase() + cousinTitle.slice(1);
  }

  if (removal === 0) return cousinTitle;
  if (removal === 1) return `${cousinTitle} (1 génération d'écart)`;
  return `${cousinTitle} (${removal} générations d'écart)`;
}

function frenchArticle(word: string, sex: 'M' | 'F' | 'U'): string {
  const first = word.charAt(0).toLowerCase();
  if ('aeiouyéèêâîôû'.includes(first)) return "l'";
  return sex === 'F' ? 'la ' : 'le ';
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
  const isFr = (options?.locale || 'en').startsWith('fr');
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
      relationship: isFr ? 'Même personne' : 'Self',
      description: isFr
        ? `${sourceName} est la même personne.`
        : `${sourceName} is the same person.`,
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

    const relTitle = isFr
      ? describeConsanguinityFr(bestDA, bestDB, targetSex, isHalf)
      : describeConsanguinityEn(bestDA, bestDB, targetSex, isHalf);
    const ancNames = bestCommonAncestors.map((x) => nameOf(analysis, x)).join(' & ');

    const description = isFr
      ? `${targetName} est ${frenchArticle(relTitle, targetSex)}${relTitle.toLowerCase()} de ${sourceName} (${bestCommonAncestors.length > 1 ? 'Ancêtres communs' : 'Ancêtre commun'} : ${ancNames}).`
      : `${targetName} is the ${relTitle.toLowerCase()} of ${sourceName} (Common Ancestor: ${ancNames}).`;

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
      const title = isFr
        ? targetSex === 'M'
          ? 'Époux'
          : targetSex === 'F'
            ? 'Épouse'
            : 'Conjoint(e)'
        : targetSex === 'M'
          ? 'Husband'
          : targetSex === 'F'
            ? 'Wife'
            : 'Spouse';
      return {
        relationship: title,
        description: isFr
          ? `${targetName} est ${frenchArticle(title, targetSex)}${title.toLowerCase()} de ${sourceName}.`
          : `${targetName} is the ${title.toLowerCase()} of ${sourceName}.`,
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
            const title = isFr
              ? targetSex === 'M'
                ? 'Beau-père'
                : targetSex === 'F'
                  ? 'Belle-mère'
                  : 'Beau-parent'
              : targetSex === 'M'
                ? 'Stepfather'
                : targetSex === 'F'
                  ? 'Stepmother'
                  : 'Stepparent';
            return {
              relationship: title,
              description: isFr
                ? `${targetName} est ${frenchArticle(title, targetSex)}${title.toLowerCase()} de ${sourceName}.`
                : `${targetName} is the ${title.toLowerCase()} of ${sourceName}.`,
              commonAncestors: [],
              path,
              distance: 2,
            };
          }
        }
      }
    }

    // In-law (Spouse's Sibling or Sibling's Spouse)
    const title = isFr
      ? targetSex === 'F'
        ? 'Parente par alliance'
        : 'Parent par alliance'
      : targetSex === 'M'
        ? 'Relative by marriage'
        : targetSex === 'F'
          ? 'Relative by marriage'
          : 'In-law';
    return {
      relationship: title,
      description: isFr
        ? `${targetName} est lié(e) à ${sourceName} par alliance.`
        : `${targetName} is related to ${sourceName} by marriage.`,
      commonAncestors: [],
      path,
      distance: path.filter((x) => analysis.xrefs.definitions.get(x)?.tag === 'INDI').length - 1,
    };
  }

  return undefined;
}
