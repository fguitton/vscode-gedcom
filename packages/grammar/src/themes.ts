/**
 * Theme data and TextMate scope resolution.
 *
 * Shared by the preview script and by the test that asserts the semantic classes
 * actually resolve to different colours. Declaring the palettes here rather than
 * downloading them keeps both reproducible offline; the point is relative
 * distinctness, not pixel fidelity.
 */

export interface ThemeRule {
  scope?: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

export interface Theme {
  name: string;
  background: string;
  foreground: string;
  rules: ThemeRule[];
}

/**
 * Themes are declared here rather than downloaded so the preview is reproducible
 * offline. The values are the published defaults for each theme's syntax colours;
 * the point is relative distinctness, not pixel fidelity.
 */
export const THEMES: Theme[] = [
  {
    name: 'Dark+ (VS Code default)',
    background: '#1f1f1f',
    foreground: '#cccccc',
    rules: [
      { scope: 'comment', settings: { foreground: '#6a9955', fontStyle: 'italic' } },
      { scope: 'keyword', settings: { foreground: '#c586c0' } },
      { scope: 'keyword.control', settings: { foreground: '#c586c0' } },
      { scope: 'keyword.operator', settings: { foreground: '#d4d4d4' } },
      { scope: 'constant.numeric', settings: { foreground: '#b5cea8' } },
      { scope: 'constant.language', settings: { foreground: '#569cd6' } },
      { scope: 'constant.character.escape', settings: { foreground: '#d7ba7d' } },
      { scope: 'entity.name.type', settings: { foreground: '#4ec9b0' } },
      { scope: 'entity.name.tag', settings: { foreground: '#569cd6' } },
      { scope: 'entity.name.function', settings: { foreground: '#dcdcaa' } },
      { scope: 'support.function', settings: { foreground: '#dcdcaa' } },
      { scope: 'variable', settings: { foreground: '#9cdcfe' } },
      { scope: 'variable.other', settings: { foreground: '#9cdcfe' } },
      { scope: 'string', settings: { foreground: '#ce9178' } },
      { scope: 'markup.quote', settings: { foreground: '#6a9955' } },
      { scope: 'invalid', settings: { foreground: '#f44747' } },
    ],
  },
  {
    name: 'Light+ (VS Code default)',
    background: '#ffffff',
    foreground: '#3b3b3b',
    rules: [
      { scope: 'comment', settings: { foreground: '#008000', fontStyle: 'italic' } },
      { scope: 'keyword', settings: { foreground: '#af00db' } },
      { scope: 'keyword.control', settings: { foreground: '#af00db' } },
      { scope: 'keyword.operator', settings: { foreground: '#000000' } },
      { scope: 'constant.numeric', settings: { foreground: '#098658' } },
      { scope: 'constant.language', settings: { foreground: '#0000ff' } },
      { scope: 'constant.character.escape', settings: { foreground: '#ee0000' } },
      { scope: 'entity.name.type', settings: { foreground: '#267f99' } },
      { scope: 'entity.name.tag', settings: { foreground: '#800000' } },
      { scope: 'entity.name.function', settings: { foreground: '#795e26' } },
      { scope: 'support.function', settings: { foreground: '#795e26' } },
      { scope: 'variable', settings: { foreground: '#001080' } },
      { scope: 'variable.other', settings: { foreground: '#001080' } },
      { scope: 'string', settings: { foreground: '#a31515' } },
      { scope: 'markup.quote', settings: { foreground: '#008000' } },
      { scope: 'invalid', settings: { foreground: '#cd3131' } },
    ],
  },
  // GitHub used to be approximated here, by a palette written from memory. It is
  // now taken from the real thing instead — see prettylights.ts, which runs the
  // grammar through GitHub's own highlighter and colours it from GitHub's own
  // published tokens. The approximation flattered the design: it showed six
  // distinct colours where the real palette gives four.
];

/**
 * TextMate scope matching: the most specific rule wins, where specificity is the
 * number of dot-separated segments a rule's scope shares as a prefix.
 */
export function resolve(
  scopes: readonly string[],
  theme: Theme,
): { color: string; italic: boolean } {
  let best = { color: theme.foreground, italic: false, score: -1 };

  for (const scope of scopes) {
    for (const rule of theme.rules) {
      const selectors = Array.isArray(rule.scope) ? rule.scope : rule.scope ? [rule.scope] : [];
      for (const selector of selectors) {
        if (scope !== selector && !scope.startsWith(`${selector}.`)) continue;
        const score = selector.split('.').length;
        if (score < best.score) continue;
        best = {
          color: rule.settings.foreground ?? best.color,
          italic: rule.settings.fontStyle?.includes('italic') ?? false,
          score,
        };
      }
    }
  }

  return { color: best.color, italic: best.italic };
}
