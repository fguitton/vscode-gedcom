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

export function formatTimelineChildBirth(childName: string, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return `Naissance de l'enfant ${childName}`;
  }
  return `Birth of child ${childName}`;
}

export function formatSpouseEdge(marriageYear?: number, locale?: string): string {
  if (isFrenchLocale(locale)) {
    return marriageYear === undefined ? 'Conjoint(e)' : `Marié en ${marriageYear}`;
  }
  return marriageYear === undefined ? 'Spouse' : `Married ${marriageYear}`;
}

export function formatParentEdge(locale?: string): string {
  if (isFrenchLocale(locale)) return 'Parent';
  return 'Parent';
}

export function formatChildEdge(locale?: string): string {
  if (isFrenchLocale(locale)) return 'Enfant';
  return 'Child';
}

export function formatSiblingEdge(locale?: string): string {
  if (isFrenchLocale(locale)) return 'Fratrie';
  return 'Sibling';
}
