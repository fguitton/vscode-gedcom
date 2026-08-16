/**
 * Life event timeline tests.
 */

import { describe, expect, it } from 'vitest';
import { analyze, individualTimeline } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

const TREE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 10 JAN 1900',
  '2 PLAC London, England',
  '1 OCCU Blacksmith',
  '2 DATE 1920',
  '1 RESI',
  '2 DATE 1930',
  '2 PLAC York, England',
  '1 DEAT',
  '2 DATE 15 MAY 1975',
  '2 PLAC Oxford, England',
  '1 BURI',
  '2 DATE 18 MAY 1975',
  '1 FAMS @F1@',
  '0 @W1@ INDI',
  '1 NAME Mary /Jones/',
  '1 SEX F',
  '1 FAMS @F1@',
  '0 @C1@ INDI',
  '1 NAME Alice /Smith/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 1925',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @W1@',
  '1 MARR',
  '2 DATE 1924',
  '2 PLAC London, England',
  '1 CHIL @C1@',
  '0 TRLR',
].join('\n');

describe('individualTimeline', () => {
  const analysis = analyze(bytes(TREE));

  it('gathers all personal and family events in chronological order', () => {
    const timeline = individualTimeline(analysis, 'I1');
    expect(timeline.length).toBeGreaterThanOrEqual(6);

    // 1st: Birth (1900)
    expect(timeline[0]?.tag).toBe('BIRT');
    expect(timeline[0]?.year).toBe(1900);
    expect(timeline[0]?.age).toBe('Age 0');

    // 2nd: Occupation (1920)
    const occu = timeline.find((e) => e.tag === 'OCCU');
    expect(occu).toBeDefined();
    expect(occu?.year).toBe(1920);
    expect(occu?.age).toBe('Age 20');

    // 3rd: Marriage (1924)
    const marr = timeline.find((e) => e.tag === 'MARR');
    expect(marr).toBeDefined();
    expect(marr?.label).toContain('Mary Jones');
    expect(marr?.year).toBe(1924);
    expect(marr?.age).toBe('Age 24');

    // 4th: Birth of child Alice (1925)
    const child = timeline.find((e) => e.tag === 'CHIL');
    expect(child).toBeDefined();
    expect(child?.label).toContain('Alice Smith');
    expect(child?.year).toBe(1925);
    expect(child?.age).toBe('Age 25');

    // 5th: Residence (1930)
    const resi = timeline.find((e) => e.tag === 'RESI');
    expect(resi).toBeDefined();
    expect(resi?.year).toBe(1930);
    expect(resi?.age).toBe('Age 30');

    // 6th: Death (1975)
    const deat = timeline.find((e) => e.tag === 'DEAT');
    expect(deat).toBeDefined();
    expect(deat?.year).toBe(1975);
    expect(deat?.age).toBe('Age 75');

    // 7th: Burial (1975)
    const buri = timeline.find((e) => e.tag === 'BURI');
    expect(buri).toBeDefined();
    expect(buri?.year).toBe(1975);
  });

  it('synthesizes timeline for Queen Victoria in Royal92 benchmark', () => {
    const royalAnalysis = analyze(fixture('v5/Royal92.ged').bytes);
    const timeline = individualTimeline(royalAnalysis, 'I1');
    expect(timeline.length).toBeGreaterThanOrEqual(10);

    const birth = timeline.find((e) => e.tag === 'BIRT');
    expect(birth?.year).toBe(1819);

    const death = timeline.find((e) => e.tag === 'DEAT');
    expect(death?.year).toBe(1901);
    expect(death?.age).toBe('Age 82');

    const children = timeline.filter((e) => e.tag === 'CHIL');
    expect(children.length).toBeGreaterThan(0);
  });
});
