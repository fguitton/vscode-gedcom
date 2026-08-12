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
  {
    // The one that matters for GitHub. PrettyLights has far fewer buckets than a
    // VS Code theme, which is the constraint the scope mapping was designed
    // against — two classes collapsing here would be invisible on github.com.
    name: 'GitHub Primer (dark) — approximates PrettyLights',
    background: '#0d1117',
    foreground: '#e6edf3',
    rules: [
      { scope: 'comment', settings: { foreground: '#8b949e' } },
      { scope: 'keyword', settings: { foreground: '#ff7b72' } },
      { scope: 'constant', settings: { foreground: '#79c0ff' } },
      { scope: 'support', settings: { foreground: '#79c0ff' } },
      { scope: 'entity.name.tag', settings: { foreground: '#7ee787' } },
      { scope: 'entity', settings: { foreground: '#d2a8ff' } },
      { scope: 'variable', settings: { foreground: '#ffa657' } },
      { scope: 'string', settings: { foreground: '#a5d6ff' } },
      { scope: 'markup.quote', settings: { foreground: '#a5d6ff' } },
      { scope: 'invalid', settings: { foreground: '#f85149' } },
    ],
  },
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
