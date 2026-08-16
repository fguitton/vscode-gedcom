/**
 * Fan chart builder tests.
 */

import { describe, expect, it } from 'vitest';
import { analyze, buildFanChart } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

const TREE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME Root /Person/',
  '1 SEX M',
  '1 FAMC @F1@',
  '0 @I2@ INDI',
  '1 NAME Father /Person/',
  '1 SEX M',
  '1 FAMC @F2@',
  '0 @I3@ INDI',
  '1 NAME Mother /Person/',
  '1 SEX F',
  '0 @I4@ INDI',
  '1 NAME Paternal /Grandfather/',
  '1 SEX M',
  '0 @I5@ INDI',
  '1 NAME Paternal /Grandmother/',
  '1 SEX F',
  '0 @F1@ FAM',
  '1 HUSB @I2@',
  '1 WIFE @I3@',
  '1 CHIL @I1@',
  '0 @F2@ FAM',
  '1 HUSB @I4@',
  '1 WIFE @I5@',
  '1 CHIL @I2@',
  '0 TRLR',
].join('\n');

describe('buildFanChart', () => {
  const analysis = analyze(bytes(TREE));

  it('builds ancestor sectors with accurate Ahnentafel numbering and slots', () => {
    const fan = buildFanChart(analysis, 'I1', 4);
    expect(fan.nodes.length).toBe(5);

    // Root (Ahnentafel #1)
    const root = fan.nodes.find((n) => n.ahnentafel === 1);
    expect(root?.xref).toBe('I1');
    expect(root?.generation).toBe(0);
    expect(root?.slot).toBe(0);

    // Father (Ahnentafel #2)
    const father = fan.nodes.find((n) => n.ahnentafel === 2);
    expect(father?.xref).toBe('I2');
    expect(father?.generation).toBe(1);
    expect(father?.slot).toBe(0);

    // Mother (Ahnentafel #3)
    const mother = fan.nodes.find((n) => n.ahnentafel === 3);
    expect(mother?.xref).toBe('I3');
    expect(mother?.generation).toBe(1);
    expect(mother?.slot).toBe(1);

    // Paternal Grandfather (Ahnentafel #4)
    const patGf = fan.nodes.find((n) => n.ahnentafel === 4);
    expect(patGf?.xref).toBe('I4');
    expect(patGf?.generation).toBe(2);
    expect(patGf?.slot).toBe(0);

    // Paternal Grandmother (Ahnentafel #5)
    const patGm = fan.nodes.find((n) => n.ahnentafel === 5);
    expect(patGm?.xref).toBe('I5');
    expect(patGm?.generation).toBe(2);
    expect(patGm?.slot).toBe(1);
  });

  it('generates fan chart for Queen Victoria in Royal92 benchmark', () => {
    const royalAnalysis = analyze(fixture('v5/Royal92.ged').bytes);
    const fan = buildFanChart(royalAnalysis, 'I1', 5);

    expect(fan.nodes.length).toBeGreaterThan(15);
    expect(fan.nodes[0]?.label).toContain('Victoria');
  });
});
