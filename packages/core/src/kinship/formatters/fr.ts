/**
 * French kinship language formatter.
 */

import type { AffinityDescription, KinshipFormatter } from '../types.ts';

function frenchArticle(word: string, sex: 'M' | 'F' | 'U'): string {
  const first = word.charAt(0).toLowerCase();
  if ('aeiouyéèêâîôû'.includes(first)) return "l'";
  return sex === 'F' ? 'la ' : 'le ';
}

export const frFormatter: KinshipFormatter = {
  locale: 'fr',

  describeIdentity(name: string): string {
    return `${name} est la même personne.`;
  },

  describeConsanguinity(dA: number, dB: number, sex: 'M' | 'F' | 'U', isHalf: boolean): string {
    if (dA === 0 && dB === 0) return 'Même personne';

    // Target is Descendant of Source (dA = 0, dB > 0)
    if (dA === 0) {
      if (dB === 1) return sex === 'M' ? 'Fils' : sex === 'F' ? 'Fille' : 'Enfant';
      if (dB === 2)
        return sex === 'M' ? 'Petit-fils' : sex === 'F' ? 'Petite-fille' : 'Petit-enfant';
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
          return sex === 'M'
            ? 'Demi-oncle'
            : sex === 'F'
              ? 'Demi-tante'
              : 'Demi-oncle ou demi-tante';
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
          return sex === 'M'
            ? 'Demi-neveu'
            : sex === 'F'
              ? 'Demi-nièce'
              : 'Demi-neveu ou demi-nièce';
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
  },

  describeAffinity(
    kind: 'spouse' | 'stepparent' | 'in-law',
    sex: 'M' | 'F' | 'U',
  ): AffinityDescription {
    if (kind === 'spouse') {
      const title = sex === 'M' ? 'Époux' : sex === 'F' ? 'Épouse' : 'Conjoint(e)';
      return {
        title,
        description: (target, source) =>
          `${target} est ${frenchArticle(title, sex)}${title.toLowerCase()} de ${source}.`,
      };
    }

    if (kind === 'stepparent') {
      const title = sex === 'M' ? 'Beau-père' : sex === 'F' ? 'Belle-mère' : 'Beau-parent';
      return {
        title,
        description: (target, source) =>
          `${target} est ${frenchArticle(title, sex)}${title.toLowerCase()} de ${source}.`,
      };
    }

    const title = sex === 'F' ? 'Parente par alliance' : 'Parent par alliance';
    return {
      title,
      description: (target, source) => `${target} est lié(e) à ${source} par alliance.`,
    };
  },

  formatConsanguinityDescription(
    targetName: string,
    sourceName: string,
    relationshipTitle: string,
    sex: 'M' | 'F' | 'U',
    ancestorNames: readonly string[],
  ): string {
    const art = frenchArticle(relationshipTitle, sex);
    const prefix = ancestorNames.length > 1 ? 'Ancêtres communs' : 'Ancêtre commun';
    const ancStr = ancestorNames.join(' & ');
    return `${targetName} est ${art}${relationshipTitle.toLowerCase()} de ${sourceName} (${prefix} : ${ancStr}).`;
  },
};
