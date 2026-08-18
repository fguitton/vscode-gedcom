/**
 * Core localization helpers for genealogical labels, tags, dates, and relationships.
 */

import {
  FR_CALENDAR_NAMES,
  FR_ENUM_VALUES,
  FR_KEYWORD_WORDS,
  FR_MONTH_NAMES,
  FR_RECORD_NOUNS,
  FR_SECTION_TITLES,
  FR_TAG_LABELS,
} from './fr.ts';

export function isFrenchLocale(locale?: string): boolean {
  if (!locale) return false;
  return locale.toLowerCase().startsWith('fr');
}

export function translateTag(tag: string, fallback: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_TAG_LABELS[tag] || fallback;
  }
  return fallback;
}

export function translateSection(section: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_SECTION_TITLES[section] || section;
  }
  return section;
}

export function translateEnum(value: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_ENUM_VALUES[value] || value;
  }
  return value;
}

export function translateRecordNoun(
  tag: string,
  count: number,
  fallback: string,
  locale?: string,
): string {
  if (isFrenchLocale(locale)) {
    const known = FR_RECORD_NOUNS[tag];
    if (known) return count === 1 ? known[0] : known[1];
  }
  return fallback;
}

export function translateMonth(monthCode: string, fallback: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_MONTH_NAMES[monthCode] || fallback;
  }
  return fallback;
}

export function translateDateKeyword(kw: string, fallback: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_KEYWORD_WORDS[kw] || fallback;
  }
  return fallback;
}

export function translateCalendar(cal: string, fallback: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return FR_CALENDAR_NAMES[cal] || fallback;
  }
  return fallback;
}

export function formatTimelineAge(age: number, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return `Âge ${age}`;
  }
  return `Age ${age}`;
}

export function formatTimelineMarriage(partnerName: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return `Mariage avec ${partnerName}`;
  }
  return `Marriage to ${partnerName}`;
}

export function formatTimelineChildBirth(
  childName: string,
  childSex?: 'M' | 'F' | 'U',
  locale?: string,
): string {
  if (isFrenchLocale(locale)) {
    if (childSex === 'F') return `Naissance de la fille ${childName}`;
    if (childSex === 'M') return `Naissance du fils ${childName}`;
    return `Naissance de l'enfant ${childName}`;
  }
  if (childSex === 'F') return `Birth of daughter ${childName}`;
  if (childSex === 'M') return `Birth of son ${childName}`;
  return `Birth of child ${childName}`;
}

export function formatSpouseEdge(
  marriageYear?: number,
  sexA?: 'M' | 'F' | 'U',
  sexB?: 'M' | 'F' | 'U',
  locale?: string,
): string {
  if (isFrenchLocale(locale)) {
    const isBothFemale = sexA === 'F' && sexB === 'F';
    if (marriageYear !== undefined) {
      return isBothFemale ? `Mariées en ${marriageYear}` : `Mariés en ${marriageYear}`;
    }
    return isBothFemale ? 'Mariées' : 'Mariés';
  }
  return marriageYear === undefined ? 'Spouse' : `Married ${marriageYear}`;
}

export function formatParentEdge(parentSex?: 'M' | 'F' | 'U', locale?: string): string {
  if (isFrenchLocale(locale)) {
    if (parentSex === 'F') return 'Mère';
    if (parentSex === 'M') return 'Père';
    return 'Parent';
  }
  return 'Parent';
}

export function formatChildEdge(childSex?: 'M' | 'F' | 'U', locale?: string): string {
  if (isFrenchLocale(locale)) {
    if (childSex === 'F') return 'Fille';
    if (childSex === 'M') return 'Fils';
    return 'Enfant';
  }
  return 'Child';
}

export function formatSiblingEdge(targetSex?: 'M' | 'F' | 'U', locale?: string): string {
  if (isFrenchLocale(locale)) {
    if (targetSex === 'F') return 'Sœur';
    if (targetSex === 'M') return 'Frère';
    return 'Fratrie';
  }
  return 'Sibling';
}
