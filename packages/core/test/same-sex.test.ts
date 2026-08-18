/**
 * Same-sex unions, multi-partner, and gender agreement tests.
 *
 * Tests the same-sex unions fixture covering female couples (Mariées / Mariées en ...),
 * male couples (Mariés / Mariés en ...), non-binary partners, remarriages,
 * gendered timeline events, parent/child edges, and kinship calculation.
 */

import { describe, expect, it } from 'vitest';

import {
  analyze,
  buildFanChart,
  calculateKinship,
  individualTimeline,
  neighbourhood,
} from '../src/index.ts';
import { fixture } from './corpus.ts';

describe('same-sex unions and gender agreement', () => {
  const analysis = analyze(fixture('v7/same-sex-unions.ged').bytes);

  describe('tree graph spouse and relative edges in French', () => {
    it('labels female same-sex marriage with feminine plural "Mariées en ..."', () => {
      const graph = neighbourhood(analysis, 'I_ALICE', { depth: 2, locale: 'fr' });
      const spouseEdge = graph.edges.find((e) => e.kind === 'spouse' && e.union === 'FAM_LES1');
      expect(spouseEdge).toBeDefined();
      expect(spouseEdge?.label).toBe('Mariées en 2014');
    });

    it('labels female same-sex union without date with feminine plural "Mariées"', () => {
      const graph = neighbourhood(analysis, 'I_HELEN', { depth: 2, locale: 'fr' });
      const spouseEdge = graph.edges.find(
        (e) => e.kind === 'spouse' && e.union === 'FAM_LES_NODATE',
      );
      expect(spouseEdge).toBeDefined();
      expect(spouseEdge?.label).toBe('Mariées');
    });

    it('labels male same-sex marriage with masculine plural "Mariés en ..."', () => {
      const graph = neighbourhood(analysis, 'I_EMILE', { depth: 2, locale: 'fr' });
      const gayEdge = graph.edges.find((e) => e.kind === 'spouse' && e.union === 'FAM_GAY1');
      expect(gayEdge).toBeDefined();
      expect(gayEdge?.label).toBe('Mariés en 2018');
    });

    it('labels male same-sex union without date with masculine plural "Mariés"', () => {
      const graph = neighbourhood(analysis, 'I_JULIEN', { depth: 2, locale: 'fr' });
      const gayEdge = graph.edges.find((e) => e.kind === 'spouse' && e.union === 'FAM_GAY_NODATE');
      expect(gayEdge).toBeDefined();
      expect(gayEdge?.label).toBe('Mariés');
    });

    it('labels non-binary/other sex partner union with masculine/generic plural "Mariés en ..."', () => {
      const graph = neighbourhood(analysis, 'I_LEO', { depth: 2, locale: 'fr' });
      const edge = graph.edges.find((e) => e.kind === 'spouse' && e.union === 'FAM_NONBINARY');
      expect(edge).toBeDefined();
      expect(edge?.label).toBe('Mariés en 2021');
    });

    it('labels parent and child edges with proper gender in French', () => {
      const graph = neighbourhood(analysis, 'I_ALICE', { depth: 2, locale: 'fr' });

      // Chloe is female -> Fille from parent
      const chloeEdge = graph.edges.find((e) => e.to === 'I_CHLOE' && e.kind === 'parent');
      expect(chloeEdge?.label).toBe('Fille');

      // David is male -> Fils from parent
      const davidEdge = graph.edges.find((e) => e.to === 'I_DAVID' && e.kind === 'parent');
      expect(davidEdge?.label).toBe('Fils');

      // Alice is female -> Mère from child
      expect(chloeEdge?.reverseLabel).toBe('Mère');
    });
  });

  describe('tree graph in English', () => {
    it('uses standard English labels for same-sex spouses and children', () => {
      const graph = neighbourhood(analysis, 'I_ALICE', { depth: 2, locale: 'en' });
      const spouseEdge = graph.edges.find((e) => e.kind === 'spouse' && e.union === 'FAM_LES1');
      expect(spouseEdge?.label).toBe('Married 2014');

      const chloeEdge = graph.edges.find((e) => e.to === 'I_CHLOE' && e.kind === 'parent');
      expect(chloeEdge?.label).toBe('Child');
      expect(chloeEdge?.reverseLabel).toBe('Parent');
    });
  });

  describe('life timeline with same-sex unions and gender agreement', () => {
    it('formats French timeline events with daughter/son distinctions', () => {
      const timeline = individualTimeline(analysis, 'I_ALICE', { locale: 'fr' });

      // Marriage event with Beatrice
      const marr = timeline.find((e) => e.tag === 'MARR');
      expect(marr?.label).toBe('Mariage avec Beatrice Dubois');
      expect(marr?.year).toBe(2014);

      // Birth of daughter Chloe
      const chloe = timeline.find((e) => e.tag === 'CHIL' && e.label.includes('Chloe'));
      expect(chloe?.label).toBe('Naissance de la fille Chloe Martin Dubois');
      expect(chloe?.year).toBe(2016);

      // Birth of son David
      const david = timeline.find((e) => e.tag === 'CHIL' && e.label.includes('David'));
      expect(david?.label).toBe('Naissance du fils David Martin Dubois');
      expect(david?.year).toBe(2019);
    });

    it('formats timeline for person with previous heterosexual marriage and subsequent male same-sex marriage', () => {
      const timeline = individualTimeline(analysis, 'I_EMILE', { locale: 'fr' });

      const marriages = timeline.filter((e) => e.tag === 'MARR');
      expect(marriages.length).toBe(2);
      expect(marriages[0]?.label).toBe('Mariage avec Clara Bernard');
      expect(marriages[0]?.year).toBe(2005);
      expect(marriages[1]?.label).toBe('Mariage avec Felix Moreau');
      expect(marriages[1]?.year).toBe(2018);

      const hugo = timeline.find((e) => e.tag === 'CHIL' && e.label.includes('Hugo'));
      expect(hugo?.label).toBe('Naissance du fils Hugo Laurent Bernard');

      const gabriel = timeline.find((e) => e.tag === 'CHIL' && e.label.includes('Gabriel'));
      expect(gabriel?.label).toBe('Naissance du fils Gabriel Laurent Moreau');
    });
  });

  describe('kinship calculations with same-sex and blended families', () => {
    it('calculates relationship between spouses in same-sex marriages in French', () => {
      const aliceBeatrice = calculateKinship(analysis, 'I_ALICE', 'I_BEATRICE', { locale: 'fr' });
      expect(aliceBeatrice?.relationship).toBe('Épouse');

      const emileFelix = calculateKinship(analysis, 'I_EMILE', 'I_FELIX', { locale: 'fr' });
      expect(emileFelix?.relationship).toBe('Époux');
    });

    it('calculates half-sibling relationship between children of different marriages', () => {
      const kinship = calculateKinship(analysis, 'I_HUGO', 'I_GABRIEL', { locale: 'fr' });
      expect(kinship?.relationship).toBe('Demi-frère');
    });

    it('calculates mother-child relationship in female same-sex union', () => {
      const kinship = calculateKinship(analysis, 'I_CHLOE', 'I_ALICE', { locale: 'fr' });
      expect(kinship?.relationship).toBe('Mère');
    });
  });

  describe('fan chart ancestor traversal through same-sex unions', () => {
    it('builds ancestor fan chart for child of female same-sex marriage', () => {
      const fan = buildFanChart(analysis, 'I_CHLOE', 3);
      expect(fan.nodes.length).toBeGreaterThanOrEqual(3);
      // Both mothers are in the pedigree
      const alice = fan.nodes.find((n) => n.xref === 'I_ALICE');
      const beatrice = fan.nodes.find((n) => n.xref === 'I_BEATRICE');
      expect(alice ?? beatrice).toBeDefined();
    });
  });
});
