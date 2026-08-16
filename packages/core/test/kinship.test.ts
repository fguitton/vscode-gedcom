/**
 * Kinship and relationship calculation tests.
 */

import { describe, expect, it } from 'vitest';
import { analyze, calculateKinship } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

const TREE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  // Grandparents
  '0 @GP_M@ INDI',
  '1 NAME Arthur /Pendleton/',
  '1 SEX M',
  '1 FAMS @F_GP@',
  '0 @GP_F@ INDI',
  '1 NAME Beatrice /Cole/',
  '1 SEX F',
  '1 FAMS @F_GP@',
  '0 @F_GP@ FAM',
  '1 HUSB @GP_M@',
  '1 WIFE @GP_F@',
  '1 CHIL @FATHER@',
  '1 CHIL @UNCLE@',
  // Father & Uncle
  '0 @FATHER@ INDI',
  '1 NAME Charles /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_GP@',
  '1 FAMS @F_MAIN@',
  '0 @UNCLE@ INDI',
  '1 NAME David /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_GP@',
  '1 FAMS @F_UNCLE@',
  // Mother
  '0 @MOTHER@ INDI',
  '1 NAME Eleanor /Vance/',
  '1 SEX F',
  '1 FAMS @F_MAIN@',
  '0 @F_MAIN@ FAM',
  '1 HUSB @FATHER@',
  '1 WIFE @MOTHER@',
  '1 CHIL @SELF@',
  '1 CHIL @SISTER@',
  // Uncle Family & Cousin
  '0 @AUNT@ INDI',
  '1 NAME Fiona /Grey/',
  '1 SEX F',
  '1 FAMS @F_UNCLE@',
  '0 @F_UNCLE@ FAM',
  '1 HUSB @UNCLE@',
  '1 WIFE @AUNT@',
  '1 CHIL @COUSIN@',
  // Main Children
  '0 @SELF@ INDI',
  '1 NAME George /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_MAIN@',
  '1 FAMS @F_OWN@',
  '0 @SISTER@ INDI',
  '1 NAME Harriet /Pendleton/',
  '1 SEX F',
  '1 FAMC @F_MAIN@',
  // Cousin & 2nd Gen
  '0 @COUSIN@ INDI',
  '1 NAME Ian /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_UNCLE@',
  '1 FAMS @F_COUSIN@',
  '0 @COUSIN_SPOUSE@ INDI',
  '1 NAME Julia /Hart/',
  '1 SEX F',
  '1 FAMS @F_COUSIN@',
  '0 @F_COUSIN@ FAM',
  '1 HUSB @COUSIN@',
  '1 WIFE @COUSIN_SPOUSE@',
  '1 CHIL @COUSIN_CHILD@',
  '0 @COUSIN_CHILD@ INDI',
  '1 NAME Kevin /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_COUSIN@',
  // Self Family & Son
  '0 @WIFE@ INDI',
  '1 NAME Lucy /Stone/',
  '1 SEX F',
  '1 FAMS @F_OWN@',
  '0 @F_OWN@ FAM',
  '1 HUSB @SELF@',
  '1 WIFE @WIFE@',
  '1 CHIL @SON@',
  '0 @SON@ INDI',
  '1 NAME Mark /Pendleton/',
  '1 SEX M',
  '1 FAMC @F_OWN@',
  '0 TRLR',
].join('\n');

describe('calculateKinship', () => {
  const analysis = analyze(bytes(TREE));

  it('calculates identity (Self)', () => {
    const k = calculateKinship(analysis, '@SELF@', '@SELF@');
    expect(k).toBeDefined();
    expect(k?.relationship).toBe('Self');
    expect(k?.distance).toBe(0);
    expect(k?.path).toEqual(['SELF']);
  });

  it('calculates Parent and Child', () => {
    const father = calculateKinship(analysis, '@SELF@', '@FATHER@');
    expect(father?.relationship).toBe('Father');
    expect(father?.commonAncestors).toContain('FATHER');

    const son = calculateKinship(analysis, '@SELF@', '@SON@');
    expect(son?.relationship).toBe('Son');
    expect(son?.commonAncestors).toContain('SELF');
  });

  it('calculates Grandparents', () => {
    const gpM = calculateKinship(analysis, '@SELF@', '@GP_M@');
    expect(gpM?.relationship).toBe('Grandfather');

    const gpF = calculateKinship(analysis, '@SELF@', '@GP_F@');
    expect(gpF?.relationship).toBe('Grandmother');
  });

  it('calculates Siblings', () => {
    const sister = calculateKinship(analysis, '@SELF@', '@SISTER@');
    expect(sister?.relationship).toBe('Sister');
    expect(sister?.commonAncestors).toHaveLength(2); // Father & Mother
  });

  it('calculates Uncle and Aunt', () => {
    const uncle = calculateKinship(analysis, '@SELF@', '@UNCLE@');
    expect(uncle?.relationship).toBe('Uncle');
  });

  it('calculates First Cousins', () => {
    const cousin = calculateKinship(analysis, '@SELF@', '@COUSIN@');
    expect(cousin?.relationship).toBe('1st cousin');
    expect(cousin?.commonAncestors).toContain('GP_M');
  });

  it('calculates First Cousin Once Removed', () => {
    const removed = calculateKinship(analysis, '@SELF@', '@COUSIN_CHILD@');
    expect(removed?.relationship).toBe('1st cousin once removed');
  });

  it('calculates Direct Spouse', () => {
    const wife = calculateKinship(analysis, '@SELF@', '@WIFE@');
    expect(wife?.relationship).toBe('Wife');
    expect(wife?.commonAncestors).toHaveLength(0);
  });

  it('calculates In-law relationships', () => {
    const auntByMarriage = calculateKinship(analysis, '@SELF@', '@AUNT@');
    expect(auntByMarriage).toBeDefined();
    expect(auntByMarriage?.commonAncestors).toHaveLength(0);
  });

  it('finds relationships in Royal92 benchmark dataset', () => {
    const royalAnalysis = analyze(fixture('v5/Royal92.ged').bytes);

    // Queen Victoria (I1) and Prince Albert (I2) are 1st Cousins
    const victoriaAlbert = calculateKinship(royalAnalysis, 'I1', 'I2');
    expect(victoriaAlbert).toBeDefined();
    expect(victoriaAlbert?.relationship.toLowerCase()).toContain('cousin');
    expect(victoriaAlbert?.path.length).toBeGreaterThan(3);

    // Queen Victoria (I1) and Princess Victoria Adelaide Mary (I3)
    const victoriaChild = calculateKinship(royalAnalysis, 'I1', 'I3');
    expect(victoriaChild?.relationship).toBe('Daughter');
  });
});
