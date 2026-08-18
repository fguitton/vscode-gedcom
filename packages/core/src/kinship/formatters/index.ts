/**
 * Formatter registry for kinship localization.
 */

import type { KinshipFormatter } from '../types.ts';
import { enFormatter } from './en.ts';
import { frFormatter } from './fr.ts';

const FORMATTERS = new Map<string, KinshipFormatter>([
  ['en', enFormatter],
  ['fr', frFormatter],
]);

export function getFormatter(locale?: string): KinshipFormatter {
  const lang = (locale || 'en').slice(0, 2).toLowerCase();
  return FORMATTERS.get(lang) ?? enFormatter;
}

export { enFormatter } from './en.ts';
export { frFormatter } from './fr.ts';
