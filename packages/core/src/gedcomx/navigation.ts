/**
 * Navigation helpers for GEDCOM X files (JSON and XML).
 *
 * Resolves definitions, references, highlights, and links across JSON and XML documents.
 */

export interface SourceSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export interface NavigationLink extends SourceSpan {
  readonly target: string;
  readonly isInternal: boolean;
  readonly targetLine?: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the definition span for a record ID in a GEDCOM X JSON or XML document.
 */
export function findGedcomXDefinition(text: string, id: string): SourceSpan | null {
  const cleanId = id.replace(/^#/, '');
  const escaped = escapeRegex(cleanId);
  const defRegex = new RegExp(`(?:id)["\\s:=]+["']${escaped}["']`);
  const lines = text.split('\n');

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l]!;
    const match = defRegex.exec(lineText);
    if (match) {
      const start = match.index;
      const end = match.index + match[0].length;
      return { line: l, start, end };
    }
  }

  // XML opening tag with id attribute
  const xmlTagRegex = new RegExp(`<[a-zA-Z0-9_-]+[^>]*\\bid=["']${escaped}["']`);
  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l]!;
    const match = xmlTagRegex.exec(lineText);
    if (match) {
      const start = match.index;
      const end = match.index + match[0].length;
      return { line: l, start, end };
    }
  }

  return null;
}

/**
 * Returns the identifier under a line & character position in a GEDCOM X document.
 */
export function getGedcomXIdentifierAt(
  text: string,
  line: number,
  character: number,
): string | null {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length) return null;
  const lineText = lines[line]!;

  // 1. Pointer reference (#id)
  const refRegex = /(?:resource|descriptionRef|about)?["\s:=]*#([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(lineText)) !== null) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return match[1]!;
    }
  }

  // 2. Definition (id="...")
  const defRegex = /(?:id)["\s:=]+["']([a-zA-Z0-9_-]+)["']/g;
  while ((match = defRegex.exec(lineText)) !== null) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return match[1]!;
    }
  }

  // 3. Fallback word search
  const wordRegex = /#?([a-zA-Z0-9_-]+)/g;
  while ((match = wordRegex.exec(lineText)) !== null) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return match[1]!;
    }
  }

  return null;
}

/**
 * Finds all reference spans pointing to an ID in a GEDCOM X document.
 */
export function findGedcomXReferences(text: string, id: string): SourceSpan[] {
  const cleanId = id.replace(/^#/, '');
  const escaped = escapeRegex(cleanId);
  const refRegex = new RegExp(
    `(?:resource|descriptionRef|about)?["\\s:=]*#${escaped}(?![a-zA-Z0-9_-])`,
    'g',
  );

  const lines = text.split('\n');
  const results: SourceSpan[] = [];

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l]!;
    let match: RegExpExecArray | null;
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(lineText)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      results.push({ line: l, start, end });
    }
  }

  return results;
}

/**
 * Extracts all document links (both internal #id jumps and external URLs).
 */
export function findGedcomXLinks(text: string): NavigationLink[] {
  const lines = text.split('\n');
  const links: NavigationLink[] = [];

  const urlRegex = /https?:\/\/[^\s"'>]+/g;
  const refRegex = /(?:resource|descriptionRef|about)["\s:=]+["']?#([a-zA-Z0-9_-]+)["']?/g;

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l]!;

    // Internal #id links
    let match: RegExpExecArray | null;
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(lineText)) !== null) {
      const id = match[1]!;
      const def = findGedcomXDefinition(text, id);
      const hashIdx = lineText.indexOf('#' + id, match.index);
      const start = hashIdx >= 0 ? hashIdx : match.index;
      const end = start + ('#' + id).length;

      links.push({
        line: l,
        start,
        end,
        target: '#' + id,
        isInternal: true,
        targetLine: def?.line,
      });
    }

    // External http:// URLs
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(lineText)) !== null) {
      const urlStr = match[0];
      if (urlStr.startsWith('http://gedcomx.org')) continue;
      links.push({
        line: l,
        start: match.index,
        end: match.index + urlStr.length,
        target: urlStr,
        isInternal: false,
      });
    }
  }

  return links;
}
