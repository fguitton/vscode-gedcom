/**
 * Computes exact line spans for GEDCOM X entities (persons, relationships, sources, agents)
 * in original JSON and XML files.
 */

export interface EntitySpan {
  readonly startLine: number;
  readonly endLine: number;
  readonly xref: string;
  readonly tag: 'INDI' | 'FAM' | 'SOUR' | 'SUBM';
}

export function toGedcomXref(rawId: string, prefix: 'I' | 'F' | 'S' | 'U', index = 0): string {
  if (!rawId) return `${prefix}${index}`;
  const sanitized = rawId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${prefix}_${sanitized}`;
}

/**
 * Computes line spans for entities in a GEDCOM X JSON or XML document.
 */
export function computeGedcomXEntitySpans(text: string, format: 'json' | 'xml'): EntitySpan[] {
  if (format === 'xml') {
    return computeXmlSpans(text);
  }
  return computeJsonSpans(text);
}

function computeXmlSpans(text: string): EntitySpan[] {
  const spans: EntitySpan[] = [];
  const lines = text.split(/\r?\n/);

  interface OpenTag {
    tagType: 'person' | 'relationship' | 'sourceDescription' | 'agent';
    id: string;
    startLine: number;
  }

  let current: OpenTag | null = null;
  let relIndex = 1;
  let personIndex = 1;
  let sourceIndex = 1;
  let agentIndex = 1;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    if (!current) {
      const personMatch = /<person\b([^>]*)>/i.exec(line);
      if (personMatch) {
        const attrs = personMatch[1] ?? '';
        const idMatch = /\bid="([^"]+)"/i.exec(attrs);
        const id = idMatch ? idMatch[1]! : `P_${personIndex++}`;
        if (attrs.endsWith('/') || line.includes('</person>')) {
          spans.push({
            startLine: lineIdx,
            endLine: lineIdx,
            xref: toGedcomXref(id, 'I'),
            tag: 'INDI',
          });
        } else {
          current = { tagType: 'person', id, startLine: lineIdx };
        }
        continue;
      }

      const relMatch = /<relationship\b([^>]*)>/i.exec(line);
      if (relMatch) {
        const attrs = relMatch[1] ?? '';
        const idMatch = /\bid="([^"]+)"/i.exec(attrs);
        const id = idMatch ? idMatch[1]! : `R_${relIndex++}`;
        if (attrs.endsWith('/') || line.includes('</relationship>')) {
          spans.push({
            startLine: lineIdx,
            endLine: lineIdx,
            xref: toGedcomXref(id, 'F'),
            tag: 'FAM',
          });
        } else {
          current = { tagType: 'relationship', id, startLine: lineIdx };
        }
        continue;
      }

      const sourceMatch = /<sourceDescription\b([^>]*)>/i.exec(line);
      if (sourceMatch) {
        const attrs = sourceMatch[1] ?? '';
        const idMatch = /\bid="([^"]+)"/i.exec(attrs);
        const id = idMatch ? idMatch[1]! : `S_${sourceIndex++}`;
        if (attrs.endsWith('/') || line.includes('</sourceDescription>')) {
          spans.push({
            startLine: lineIdx,
            endLine: lineIdx,
            xref: toGedcomXref(id, 'S'),
            tag: 'SOUR',
          });
        } else {
          current = { tagType: 'sourceDescription', id, startLine: lineIdx };
        }
        continue;
      }

      const agentMatch = /<agent\b([^>]*)>/i.exec(line);
      if (agentMatch) {
        const attrs = agentMatch[1] ?? '';
        const idMatch = /\bid="([^"]+)"/i.exec(attrs);
        const id = idMatch ? idMatch[1]! : `A_${agentIndex++}`;
        if (attrs.endsWith('/') || line.includes('</agent>')) {
          spans.push({
            startLine: lineIdx,
            endLine: lineIdx,
            xref: toGedcomXref(id, 'U'),
            tag: 'SUBM',
          });
        } else {
          current = { tagType: 'agent', id, startLine: lineIdx };
        }
        continue;
      }
    } else {
      const closingTag = `</${current.tagType}>`;
      if (line.includes(closingTag)) {
        const tagMap: Record<string, 'INDI' | 'FAM' | 'SOUR' | 'SUBM'> = {
          person: 'INDI',
          relationship: 'FAM',
          sourceDescription: 'SOUR',
          agent: 'SUBM',
        };
        const prefixMap: Record<string, 'I' | 'F' | 'S' | 'U'> = {
          person: 'I',
          relationship: 'F',
          sourceDescription: 'S',
          agent: 'U',
        };
        spans.push({
          startLine: current.startLine,
          endLine: lineIdx,
          xref: toGedcomXref(current.id, prefixMap[current.tagType]!),
          tag: tagMap[current.tagType]!,
        });
        current = null;
      }
    }
  }

  return spans;
}

function computeJsonSpans(text: string): EntitySpan[] {
  const spans: EntitySpan[] = [];
  const lines = text.split(/\r?\n/);

  type SectionType = 'persons' | 'relationships' | 'sourceDescriptions' | 'agents' | null;
  let currentSection: SectionType = null;
  let objectDepth = 0;
  let arrayDepth = 0;
  let objStartLine = -1;
  let objLines: string[] = [];
  let relIndex = 1;
  let personIndex = 1;
  let sourceIndex = 1;
  let agentIndex = 1;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    if (!currentSection) {
      if (/"persons"\s*:\s*\[/.test(line)) {
        currentSection = 'persons';
        arrayDepth = 1;
      } else if (/"relationships"\s*:\s*\[/.test(line)) {
        currentSection = 'relationships';
        arrayDepth = 1;
      } else if (/"sourceDescriptions"\s*:\s*\[/.test(line)) {
        currentSection = 'sourceDescriptions';
        arrayDepth = 1;
      } else if (/"agents"\s*:\s*\[/.test(line)) {
        currentSection = 'agents';
        arrayDepth = 1;
      }
    }

    if (currentSection) {
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '{') {
          if (objectDepth === 0) {
            objStartLine = lineIdx;
            objLines = [];
          }
          objectDepth++;
        } else if (ch === '}') {
          objectDepth--;
          if (objectDepth === 0 && objStartLine !== -1) {
            objLines.push(line);
            const objText = objLines.join('\n');
            const idMatch = /"id"\s*:\s*"([^"]+)"/.exec(objText);

            if (currentSection === 'persons') {
              const id = idMatch ? idMatch[1]! : `P_${personIndex++}`;
              spans.push({
                startLine: objStartLine,
                endLine: lineIdx,
                xref: toGedcomXref(id, 'I'),
                tag: 'INDI',
              });
            } else if (currentSection === 'relationships') {
              const id = idMatch ? idMatch[1]! : `R_${relIndex++}`;
              spans.push({
                startLine: objStartLine,
                endLine: lineIdx,
                xref: toGedcomXref(id, 'F'),
                tag: 'FAM',
              });
            } else if (currentSection === 'sourceDescriptions') {
              const id = idMatch ? idMatch[1]! : `S_${sourceIndex++}`;
              spans.push({
                startLine: objStartLine,
                endLine: lineIdx,
                xref: toGedcomXref(id, 'S'),
                tag: 'SOUR',
              });
            } else if (currentSection === 'agents') {
              const id = idMatch ? idMatch[1]! : `A_${agentIndex++}`;
              spans.push({
                startLine: objStartLine,
                endLine: lineIdx,
                xref: toGedcomXref(id, 'U'),
                tag: 'SUBM',
              });
            }

            objStartLine = -1;
            objLines = [];
          }
        } else if (ch === ']') {
          if (objectDepth === 0) {
            arrayDepth--;
            if (arrayDepth <= 0) {
              currentSection = null;
            }
          }
        }
      }

      if (objectDepth > 0) {
        objLines.push(line);
      }
    }
  }

  return spans;
}
