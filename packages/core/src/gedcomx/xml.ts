/**
 * Zero-dependency XML parser and serializer for GEDCOM X.
 */

import type {
  Agent,
  Attribution,
  Fact,
  Gender,
  Gedcomx,
  Name,
  NameForm,
  NamePart,
  Note,
  Person,
  Relationship,
  SourceCitation,
  SourceDescription,
} from './types.ts';

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

/** Simple, robust zero-dependency XML tokenizer & tree builder */
function parseXmlTree(xml: string): XmlNode {
  // Strip XML declaration, comments, and doctype
  const clean = xml
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();

  const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)([^>]*?)(\/)?>|([^<]+)/g;
  const root: XmlNode = { tag: '__root__', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(clean)) !== null) {
    const isClosing = match[1] === '/';
    const rawTagName = match[2];
    const attrString = match[3];
    const isSelfClosing = match[4] === '/';
    const textContent = match[5];

    if (textContent !== undefined) {
      const decoded = decodeXmlEntities(textContent.trim());
      if (decoded && stack.length > 0) {
        stack[stack.length - 1]!.text += (stack[stack.length - 1]!.text ? ' ' : '') + decoded;
      }
      continue;
    }

    if (!rawTagName) continue;

    // Normalize tag name by stripping namespace prefix (e.g. 'gx:person' -> 'person')
    const tagName = rawTagName.includes(':') ? rawTagName.split(':')[1]! : rawTagName;

    if (isClosing) {
      if (
        stack.length > 1 &&
        stack[stack.length - 1]!.tag.toLowerCase() === tagName.toLowerCase()
      ) {
        stack.pop();
      }
    } else {
      const attrs = parseAttributes(attrString ?? '');
      const node: XmlNode = { tag: tagName, attrs, children: [], text: '' };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(node);
      }
      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  const first = root.children[0];
  if (!first) {
    throw new Error('Invalid XML: no root element found');
  }
  return first;
}

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrStr)) !== null) {
    const rawKey = match[1]!;
    const key = rawKey.includes(':') ? rawKey.split(':')[1]! : rawKey;
    const value = match[2] ?? match[3] ?? '';
    attrs[key] = decodeXmlEntities(value);
  }
  return attrs;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function encodeXmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  const lower = tag.toLowerCase();
  return node.children.find((c) => c.tag.toLowerCase() === lower);
}

function findChildren(node: XmlNode, tag: string): XmlNode[] {
  const lower = tag.toLowerCase();
  return node.children.filter((c) => c.tag.toLowerCase() === lower);
}

/**
 * Parses a GEDCOM X XML string into a structured Gedcomx document.
 */
export function parseGedcomXXml(xmlText: string): Gedcomx {
  const root = parseXmlTree(xmlText);

  const gedcomx: Gedcomx = {
    id: root.attrs.id,
    lang: root.attrs.lang,
    description: root.attrs.description,
  };

  const persons: Person[] = [];
  const relationships: Relationship[] = [];
  const sourceDescriptions: SourceDescription[] = [];
  const agents: Agent[] = [];

  // Parse Attribution
  const attrNode = findChild(root, 'attribution');
  let attribution: Attribution | undefined;
  if (attrNode) {
    const contrib = findChild(attrNode, 'contributor');
    attribution = {
      contributor: contrib
        ? { resource: contrib.attrs.resource, resourceId: contrib.attrs.resourceId }
        : undefined,
      modified: findChild(attrNode, 'modified')?.text,
      changeMessage: findChild(attrNode, 'changeMessage')?.text,
      created: findChild(attrNode, 'created')?.text,
    };
  }

  // Parse Persons
  for (const pNode of findChildren(root, 'person')) {
    const person: Person = {
      id: pNode.attrs.id,
      principal: pNode.attrs.principal === 'true',
      living: pNode.attrs.living === 'true',
      extracted: pNode.attrs.extracted === 'true',
    };

    // Gender
    const genderNode = findChild(pNode, 'gender');
    if (genderNode) {
      (person as { gender: Gender }).gender = {
        type: genderNode.attrs.type,
      };
    }

    // Names
    const names: Name[] = [];
    for (const nNode of findChildren(pNode, 'name')) {
      const nameForms: NameForm[] = [];
      for (const nfNode of findChildren(nNode, 'nameForm')) {
        const parts: NamePart[] = [];
        for (const partNode of findChildren(nfNode, 'part')) {
          parts.push({
            type: partNode.attrs.type,
            value: partNode.attrs.value || partNode.text,
          });
        }
        nameForms.push({
          lang: nfNode.attrs.lang,
          fullText: findChild(nfNode, 'fullText')?.text || nfNode.text,
          parts: parts.length > 0 ? parts : undefined,
        });
      }

      names.push({
        id: nNode.attrs.id,
        type: nNode.attrs.type,
        preferred: nNode.attrs.preferred === 'true',
        nameForms: nameForms.length > 0 ? nameForms : undefined,
      });
    }
    if (names.length > 0) {
      (person as { names: Name[] }).names = names;
    }

    // Facts
    const facts: Fact[] = [];
    for (const fNode of findChildren(pNode, 'fact')) {
      const dateNode = findChild(fNode, 'date');
      const placeNode = findChild(fNode, 'place');
      const fact: Fact = {
        id: fNode.attrs.id,
        type: fNode.attrs.type,
        value: fNode.attrs.value || findChild(fNode, 'value')?.text || undefined,
        primary: fNode.attrs.primary === 'true',
        date: dateNode
          ? {
              original: findChild(dateNode, 'original')?.text || dateNode.text || undefined,
              formal: dateNode.attrs.formal || findChild(dateNode, 'formal')?.text || undefined,
            }
          : undefined,
        place: placeNode
          ? {
              original: findChild(placeNode, 'original')?.text || placeNode.text || undefined,
              description: placeNode.attrs.description,
            }
          : undefined,
      };
      facts.push(fact);
    }
    if (facts.length > 0) {
      (person as { facts: Fact[] }).facts = facts;
    }

    // Notes
    const notes: Note[] = [];
    for (const noteNode of findChildren(pNode, 'note')) {
      notes.push({
        id: noteNode.attrs.id,
        subject: noteNode.attrs.subject || findChild(noteNode, 'subject')?.text,
        text: findChild(noteNode, 'text')?.text || noteNode.text,
      });
    }
    if (notes.length > 0) {
      (person as { notes: Note[] }).notes = notes;
    }

    // Sources
    const sources: SourceCitation[] = [];
    for (const srcNode of findChildren(pNode, 'source')) {
      sources.push({
        descriptionRef: srcNode.attrs.description,
        value: srcNode.text || undefined,
      });
    }
    if (sources.length > 0) {
      (person as { sources: SourceCitation[] }).sources = sources;
    }

    persons.push(person);
  }

  // Parse Relationships
  for (const rNode of findChildren(root, 'relationship')) {
    const p1Node = findChild(rNode, 'person1');
    const p2Node = findChild(rNode, 'person2');

    const facts: Fact[] = [];
    for (const fNode of findChildren(rNode, 'fact')) {
      const dateNode = findChild(fNode, 'date');
      const placeNode = findChild(fNode, 'place');
      facts.push({
        id: fNode.attrs.id,
        type: fNode.attrs.type,
        value: fNode.attrs.value || findChild(fNode, 'value')?.text || undefined,
        date: dateNode
          ? {
              original: findChild(dateNode, 'original')?.text || dateNode.text || undefined,
              formal: dateNode.attrs.formal || findChild(dateNode, 'formal')?.text || undefined,
            }
          : undefined,
        place: placeNode
          ? {
              original: findChild(placeNode, 'original')?.text || placeNode.text || undefined,
              description: placeNode.attrs.description,
            }
          : undefined,
      });
    }

    relationships.push({
      id: rNode.attrs.id,
      type: rNode.attrs.type,
      person1: p1Node
        ? { resource: p1Node.attrs.resource, resourceId: p1Node.attrs.resourceId }
        : undefined,
      person2: p2Node
        ? { resource: p2Node.attrs.resource, resourceId: p2Node.attrs.resourceId }
        : undefined,
      facts: facts.length > 0 ? facts : undefined,
    });
  }

  // Parse Source Descriptions
  for (const sNode of findChildren(root, 'sourceDescription')) {
    sourceDescriptions.push({
      id: sNode.attrs.id,
      about: sNode.attrs.about,
      citation: findChild(sNode, 'citation')?.text,
      titles: findChild(sNode, 'title') ? [{ value: findChild(sNode, 'title')!.text }] : undefined,
    });
  }

  // Parse Agents
  for (const aNode of findChildren(root, 'agent')) {
    agents.push({
      id: aNode.attrs.id,
      names: findChild(aNode, 'name') ? [{ value: findChild(aNode, 'name')!.text }] : undefined,
    });
  }

  return {
    ...gedcomx,
    attribution,
    persons: persons.length > 0 ? persons : undefined,
    relationships: relationships.length > 0 ? relationships : undefined,
    sourceDescriptions: sourceDescriptions.length > 0 ? sourceDescriptions : undefined,
    agents: agents.length > 0 ? agents : undefined,
  };
}

/**
 * Serializes a Gedcomx document to XML string.
 */
export function toGedcomXXml(gedcomx: Gedcomx): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<gedcomx xmlns="http://gedcomx.org/v1/">');

  if (gedcomx.attribution) {
    lines.push('  <attribution>');
    if (gedcomx.attribution.contributor?.resource) {
      lines.push(
        `    <contributor resource="${encodeXmlEntities(gedcomx.attribution.contributor.resource)}"/>`,
      );
    }
    if (gedcomx.attribution.modified) {
      lines.push(
        `    <modified>${encodeXmlEntities(String(gedcomx.attribution.modified))}</modified>`,
      );
    }
    if (gedcomx.attribution.changeMessage) {
      lines.push(
        `    <changeMessage>${encodeXmlEntities(gedcomx.attribution.changeMessage)}</changeMessage>`,
      );
    }
    lines.push('  </attribution>');
  }

  if (gedcomx.persons) {
    for (const p of gedcomx.persons) {
      const attrs = [`id="${encodeXmlEntities(p.id ?? '')}"`];
      if (p.principal) attrs.push('principal="true"');
      if (p.living !== undefined) attrs.push(`living="${p.living}"`);
      lines.push(`  <person ${attrs.join(' ')}>`);

      if (p.gender?.type) {
        lines.push(`    <gender type="${encodeXmlEntities(p.gender.type)}"/>`);
      }

      if (p.names) {
        for (const name of p.names) {
          const nAttrs = [];
          if (name.type) nAttrs.push(`type="${encodeXmlEntities(name.type)}"`);
          if (name.preferred) nAttrs.push('preferred="true"');
          lines.push(`    <name${nAttrs.length ? ' ' + nAttrs.join(' ') : ''}>`);
          if (name.nameForms) {
            for (const nf of name.nameForms) {
              lines.push('      <nameForm>');
              if (nf.fullText) {
                lines.push(`        <fullText>${encodeXmlEntities(nf.fullText)}</fullText>`);
              }
              if (nf.parts) {
                for (const part of nf.parts) {
                  lines.push(
                    `        <part type="${encodeXmlEntities(part.type ?? '')}" value="${encodeXmlEntities(part.value ?? '')}"/>`,
                  );
                }
              }
              lines.push('      </nameForm>');
            }
          }
          lines.push('    </name>');
        }
      }

      if (p.facts) {
        for (const fact of p.facts) {
          lines.push(`    <fact type="${encodeXmlEntities(fact.type ?? '')}">`);
          if (fact.value) {
            lines.push(`      <value>${encodeXmlEntities(fact.value)}</value>`);
          }
          if (fact.date) {
            const dAttrs = fact.date.formal
              ? ` formal="${encodeXmlEntities(fact.date.formal)}"`
              : '';
            lines.push(`      <date${dAttrs}>`);
            if (fact.date.original) {
              lines.push(`        <original>${encodeXmlEntities(fact.date.original)}</original>`);
            }
            lines.push('      </date>');
          }
          if (fact.place) {
            lines.push('      <place>');
            if (fact.place.original) {
              lines.push(`        <original>${encodeXmlEntities(fact.place.original)}</original>`);
            }
            lines.push('      </place>');
          }
          lines.push('    </fact>');
        }
      }

      if (p.notes) {
        for (const note of p.notes) {
          lines.push('    <note>');
          if (note.text) {
            lines.push(`      <text>${encodeXmlEntities(note.text)}</text>`);
          }
          lines.push('    </note>');
        }
      }

      lines.push('  </person>');
    }
  }

  if (gedcomx.relationships) {
    for (const rel of gedcomx.relationships) {
      lines.push(`  <relationship type="${encodeXmlEntities(rel.type ?? '')}">`);
      if (rel.person1?.resource) {
        lines.push(`    <person1 resource="${encodeXmlEntities(rel.person1.resource)}"/>`);
      }
      if (rel.person2?.resource) {
        lines.push(`    <person2 resource="${encodeXmlEntities(rel.person2.resource)}"/>`);
      }
      if (rel.facts) {
        for (const fact of rel.facts) {
          lines.push(`    <fact type="${encodeXmlEntities(fact.type ?? '')}">`);
          if (fact.date?.original) {
            lines.push(
              `      <date><original>${encodeXmlEntities(fact.date.original)}</original></date>`,
            );
          }
          lines.push('    </fact>');
        }
      }
      lines.push('  </relationship>');
    }
  }

  if (gedcomx.sourceDescriptions) {
    for (const src of gedcomx.sourceDescriptions) {
      lines.push(`  <sourceDescription id="${encodeXmlEntities(src.id ?? '')}">`);
      if (src.citation) {
        lines.push(`    <citation>${encodeXmlEntities(src.citation)}</citation>`);
      }
      lines.push('  </sourceDescription>');
    }
  }

  if (gedcomx.agents) {
    for (const agent of gedcomx.agents) {
      lines.push(`  <agent id="${encodeXmlEntities(agent.id ?? '')}">`);
      if (agent.names?.[0]?.value) {
        lines.push(`    <name>${encodeXmlEntities(agent.names[0].value)}</name>`);
      }
      lines.push('  </agent>');
    }
  }

  lines.push('</gedcomx>');
  return lines.join('\n');
}
