/**
 * English kinship language formatter.
 */

import type { AffinityDescription, KinshipFormatter } from '../types.ts';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] || 'th');
}

export const enFormatter: KinshipFormatter = {
  locale: 'en',

  describeIdentity(name: string): string {
    return `${name} is the same person.`;
  },

  describeConsanguinity(dA: number, dB: number, sex: 'M' | 'F' | 'U', isHalf: boolean): string {
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
      if (dA === 2)
        return sex === 'M' ? 'Grandfather' : sex === 'F' ? 'Grandmother' : 'Grandparent';
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
  },

  describeAffinity(
    kind: 'spouse' | 'stepparent' | 'in-law',
    sex: 'M' | 'F' | 'U',
  ): AffinityDescription {
    if (kind === 'spouse') {
      const title = sex === 'M' ? 'Husband' : sex === 'F' ? 'Wife' : 'Spouse';
      return {
        title,
        description: (target, source) => `${target} is the ${title.toLowerCase()} of ${source}.`,
      };
    }

    if (kind === 'stepparent') {
      const title = sex === 'M' ? 'Stepfather' : sex === 'F' ? 'Stepmother' : 'Stepparent';
      return {
        title,
        description: (target, source) => `${target} is the ${title.toLowerCase()} of ${source}.`,
      };
    }

    const title =
      sex === 'M' ? 'Relative by marriage' : sex === 'F' ? 'Relative by marriage' : 'In-law';
    return {
      title,
      description: (target, source) => `${target} is related to ${source} by marriage.`,
    };
  },

  formatConsanguinityDescription(
    targetName: string,
    sourceName: string,
    relationshipTitle: string,
    _sex: 'M' | 'F' | 'U',
    ancestorNames: readonly string[],
  ): string {
    const ancStr = ancestorNames.join(' & ');
    return `${targetName} is the ${relationshipTitle.toLowerCase()} of ${sourceName} (Common Ancestor: ${ancStr}).`;
  },
};
