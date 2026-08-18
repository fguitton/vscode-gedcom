import { afterEach, describe, expect, it } from 'vitest';
import { getClientBundle, setLocale, t } from '../src/l10n.ts';

describe('client l10n', () => {
  afterEach(() => {
    setLocale(undefined);
  });

  it('returns original English text by default when language is not French', () => {
    expect(t('Open a GEDCOM file to calculate relationships.')).toBe(
      'Open a GEDCOM file to calculate relationships.',
    );
  });

  it('substitutes positional placeholders', () => {
    expect(t('Successfully modernized file to GEDCOM 7.0 ({0} modifications applied).', 42)).toBe(
      'Successfully modernized file to GEDCOM 7.0 (42 modifications applied).',
    );
  });

  it('translates to French when locale is set to French', () => {
    setLocale('fr');
    expect(t('Open a GEDCOM file to calculate relationships.')).toBe(
      'Ouvrez un fichier GEDCOM pour calculer les liens de parenté.',
    );
    expect(t('Successfully modernized file to GEDCOM 7.0 ({0} modifications applied).', 5)).toBe(
      'Fichier modernisé avec succès vers GEDCOM 7.0 (5 modifications appliquées).',
    );
  });

  it('returns French bundle when requested', () => {
    const frBundle = getClientBundle('fr');
    expect(frBundle['Open a GEDCOM file to calculate relationships.']).toBe(
      'Ouvrez un fichier GEDCOM pour calculer les liens de parenté.',
    );
  });

  it('returns empty bundle for English', () => {
    const enBundle = getClientBundle('en');
    expect(Object.keys(enBundle)).toHaveLength(0);
  });
});
