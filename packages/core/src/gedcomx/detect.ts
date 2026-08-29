/**
 * Format and detection helpers for GEDCOM X.
 */

/** Identifies whether a given text or byte stream is GEDCOM X format. */
export function isGedcomX(input: string | Uint8Array): boolean {
  return detectGedcomXFormat(input) !== null;
}

/**
 * Returns 'json' if input is GEDCOM X JSON, 'xml' if input is GEDCOM X XML, or null otherwise.
 */
export function detectGedcomXFormat(input: string | Uint8Array): 'json' | 'xml' | null {
  const text =
    typeof input === 'string'
      ? input.trim()
      : new TextDecoder('utf-8').decode(input.subarray(0, 4096)).trim();

  if (text.startsWith('{')) {
    // JSON check
    if (
      text.includes('"persons"') ||
      text.includes('"relationships"') ||
      text.includes('"sourceDescriptions"') ||
      text.includes('"agents"') ||
      text.includes('"events"') ||
      text.includes('"places"') ||
      text.includes('"documents"') ||
      text.includes('"collections"') ||
      text.includes('gedcomx.org') ||
      text.includes('"attribution"')
    ) {
      try {
        const parsed = JSON.parse(
          typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input),
        );
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (
            Array.isArray(parsed.persons) ||
            Array.isArray(parsed.relationships) ||
            Array.isArray(parsed.sourceDescriptions) ||
            Array.isArray(parsed.agents) ||
            Array.isArray(parsed.events) ||
            Array.isArray(parsed.places) ||
            Array.isArray(parsed.documents) ||
            Array.isArray(parsed.collections)
          ) {
            return 'json';
          }
          if (
            parsed.attribution &&
            typeof parsed.attribution === 'object' &&
            (parsed.attribution.contributor ||
              parsed.attribution.changeMessage ||
              parsed.attribution.creator ||
              parsed.attribution.modified)
          ) {
            return 'json';
          }
          // Single person or relationship payload
          if (
            (Array.isArray(parsed.names) || Array.isArray(parsed.facts)) &&
            (parsed.gender !== undefined || parsed.extracted !== undefined)
          ) {
            return 'json';
          }
          if (
            (parsed.person1 || parsed.person2) &&
            typeof parsed.type === 'string' &&
            parsed.type.includes('gedcomx')
          ) {
            return 'json';
          }
        }
      } catch {
        // Incomplete or invalid JSON
        if (
          (text.includes('"persons"') && text.includes('"names"')) ||
          (text.includes('"relationships"') && text.includes('"person1"'))
        ) {
          return 'json';
        }
      }
    }
  } else if (text.startsWith('<')) {
    // XML check
    if (
      /<(?:\w+:)?gedcomx\b/i.test(text) ||
      text.includes('http://gedcomx.org/v1/') ||
      text.includes('xmlns:gx="http://gedcomx.org/v1/"')
    ) {
      return 'xml';
    }
  }

  return null;
}
