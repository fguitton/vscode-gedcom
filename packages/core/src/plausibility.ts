/**
 * Genealogical plausibility and biological anomaly checks.
 *
 * Catches chronological contradictions such as death before birth, implausible
 * parent childbearing ages, marriage outside lifespan, or unrecorded deaths for
 * people born more than 120 years ago.
 */

import type { Diagnostic, Document, Structure } from './cst.ts';
import { yearOf } from './date.ts';
import { displayName } from './name.ts';
import { asPointer, type XrefIndex } from './xref.ts';

interface PersonDates {
  readonly birthYear?: number;
  readonly deathYear?: number;
  readonly hasDeath: boolean;
  readonly birthStructure?: Structure;
  readonly deathStructure?: Structure;
  readonly name: string;
}

function eventYear(structure: Structure): number | undefined {
  const dateStructure = structure.children.find((c) => c.tag === 'DATE');
  if (!dateStructure?.payload) return undefined;
  return yearOf(dateStructure.payload);
}

function personDates(record: Structure): PersonDates {
  let birthYear: number | undefined;
  let deathYear: number | undefined;
  let birthStructure: Structure | undefined;
  let deathStructure: Structure | undefined;
  let hasDeath = false;
  let name = record.xref ? `@${record.xref}@` : 'Person';

  for (const child of record.children) {
    if (child.tag === 'NAME' && child.payload) {
      name = displayName(child.payload) || name;
    } else if (child.tag === 'BIRT') {
      birthStructure = child;
      birthYear = eventYear(child);
    } else if (child.tag === 'DEAT') {
      hasDeath = true;
      deathStructure = child;
      deathYear = eventYear(child);
    }
  }

  return { birthYear, deathYear, hasDeath, birthStructure, deathStructure, name };
}

export function checkPlausibility(document: Document, _xrefs?: XrefIndex): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const datesByXref = new Map<string, PersonDates>();
  const currentYear = new Date().getFullYear();

  // Index individual lifespans
  for (const record of document.records) {
    if (record.tag !== 'INDI' || record.xref === null) continue;
    const dates = personDates(record);
    datesByXref.set(record.xref, dates);

    // 1. Death before birth
    if (
      dates.birthYear !== undefined &&
      dates.deathYear !== undefined &&
      dates.deathYear < dates.birthYear &&
      dates.deathStructure
    ) {
      diagnostics.push({
        code: 'death-before-birth',
        message: `Death year (${dates.deathYear}) is before birth year (${dates.birthYear}).`,
        severity: 'warning',
        span: dates.deathStructure.tagSpan,
      });
    }

    // 2. Implausible lifespan (> 120 years without death record)
    if (
      dates.birthYear !== undefined &&
      !dates.hasDeath &&
      currentYear - dates.birthYear > 120 &&
      dates.birthStructure
    ) {
      diagnostics.push({
        code: 'implausible-lifespan',
        message: `Person born in ${dates.birthYear} (> 120 years ago) has no death record.`,
        severity: 'hint',
        span: dates.birthStructure.tagSpan,
      });
    }
  }

  // Check family relationships
  for (const record of document.records) {
    if (record.tag !== 'FAM') continue;

    let husbXref: string | null = null;
    let wifeXref: string | null = null;
    let marrYear: number | undefined;
    let marrStructure: Structure | undefined;
    const chilXrefs: { xref: string; structure: Structure }[] = [];

    for (const child of record.children) {
      if (child.tag === 'HUSB') husbXref = asPointer(child);
      else if (child.tag === 'WIFE') wifeXref = asPointer(child);
      else if (child.tag === 'MARR') {
        marrStructure = child;
        marrYear = eventYear(child);
      } else if (child.tag === 'CHIL') {
        const ptr = asPointer(child);
        if (ptr) chilXrefs.push({ xref: ptr, structure: child });
      }
    }

    const husband = husbXref ? datesByXref.get(husbXref) : undefined;
    const wife = wifeXref ? datesByXref.get(wifeXref) : undefined;

    // 3. Marriage before birth or after death
    if (marrYear !== undefined && marrStructure) {
      for (const spouse of [husband, wife]) {
        if (!spouse) continue;
        if (spouse.birthYear !== undefined && marrYear < spouse.birthYear) {
          diagnostics.push({
            code: 'marriage-before-birth',
            message: `Marriage year (${marrYear}) is before ${spouse.name}'s birth year (${spouse.birthYear}).`,
            severity: 'warning',
            span: marrStructure.tagSpan,
          });
        }
        if (spouse.deathYear !== undefined && marrYear > spouse.deathYear) {
          diagnostics.push({
            code: 'marriage-after-death',
            message: `Marriage year (${marrYear}) is after ${spouse.name}'s death year (${spouse.deathYear}).`,
            severity: 'warning',
            span: marrStructure.tagSpan,
          });
        }
      }
    }

    // 4. Parent ages at child birth & post-mortem births
    for (const { xref, structure } of chilXrefs) {
      const child = datesByXref.get(xref);
      if (!child || child.birthYear === undefined) continue;

      const cYear = child.birthYear;

      // Mother checks
      if (wife) {
        if (wife.birthYear !== undefined) {
          const motherAge = cYear - wife.birthYear;
          if (motherAge < 12 || motherAge > 55) {
            diagnostics.push({
              code: 'implausible-parent-age',
              message: `Mother was ${motherAge} years old at child's birth in ${cYear} (mother born in ${wife.birthYear}).`,
              severity: 'warning',
              span: structure.tagSpan,
            });
          }
        }
        if (wife.deathYear !== undefined && cYear > wife.deathYear) {
          diagnostics.push({
            code: 'child-born-after-parent-death',
            message: `Child was born in ${cYear}, after mother's death in ${wife.deathYear}.`,
            severity: 'warning',
            span: structure.tagSpan,
          });
        }
      }

      // Father checks
      if (husband) {
        if (husband.birthYear !== undefined) {
          const fatherAge = cYear - husband.birthYear;
          if (fatherAge < 12 || fatherAge > 80) {
            diagnostics.push({
              code: 'implausible-parent-age',
              message: `Father was ${fatherAge} years old at child's birth in ${cYear} (father born in ${husband.birthYear}).`,
              severity: 'warning',
              span: structure.tagSpan,
            });
          }
        }
        if (husband.deathYear !== undefined && cYear > husband.deathYear + 1) {
          diagnostics.push({
            code: 'child-born-after-parent-death',
            message: `Child was born in ${cYear}, after father's death in ${husband.deathYear}.`,
            severity: 'warning',
            span: structure.tagSpan,
          });
        }
      }
    }
  }

  return diagnostics;
}
