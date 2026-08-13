/**
 * Language tags and media types.
 *
 * GEDCOM 7 replaced the old free-text language names with BCP 47 tags, which are
 * precise and unreadable in equal measure: `1 LANG yi-Latn-DE` is a complete and
 * correct description of a language nobody can name at a glance.
 *
 * `Intl.DisplayNames` already knows the answer and ships in every runtime this
 * package targets, so there is no table to maintain — only the fallbacks for the
 * older, tagless forms.
 */

/**
 * The language a BCP 47 tag names, in the reader's own locale.
 *
 * Returns nothing when the tag is unknown. `Intl.DisplayNames` echoes an
 * unrecognised tag straight back, which would render `1 LANG xx` as "xx" — worse
 * than silence, because it looks like an answer.
 */
export function describeLanguage(tag: string): string | undefined {
  const clean = tag.trim();
  if (clean.length === 0) return undefined;

  try {
    const names = new Intl.DisplayNames(undefined, { type: 'language', fallback: 'none' });
    const name = names.of(clean);
    return name && name !== clean ? name : undefined;
  } catch {
    // An ill-formed tag throws rather than returning undefined.
    return undefined;
  }
}

/**
 * GEDCOM 5.5.1 named formats by extension rather than by media type. Files written
 * that way are still the majority of what exists, so both spellings resolve.
 */
const LEGACY_FORMATS: Record<string, string> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  ole: 'application/octet-stream',
  pcx: 'image/x-pcx',
  pdf: 'application/pdf',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  wav: 'audio/vnd.wave',
};

const MEDIA_TYPES: Record<string, string> = {
  'application/pdf': 'PDF document',
  'application/octet-stream': 'binary data of unstated kind',
  'audio/mpeg': 'MP3 audio',
  'audio/vnd.wave': 'WAV audio',
  'image/bmp': 'BMP image',
  'image/gif': 'GIF image',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/tiff': 'TIFF image',
  'image/x-pcx': 'PCX image',
  'text/html': 'HTML document',
  'text/plain': 'plain text',
  'video/mp4': 'MP4 video',
  'video/quicktime': 'QuickTime video',
};

/** The media type a `FORM` payload names, in either the modern or the legacy spelling. */
export function resolveMediaType(payload: string): string | undefined {
  const clean = payload.trim().toLowerCase();
  if (clean.length === 0) return undefined;
  if (clean.includes('/')) return clean;
  return LEGACY_FORMATS[clean];
}

/** What a media type is, in words. Falls back to the type's own top-level kind. */
export function describeMediaType(payload: string): string | undefined {
  const type = resolveMediaType(payload);
  if (!type) return undefined;

  const known = MEDIA_TYPES[type];
  if (known) return known;

  const [kind, subtype] = type.split('/');
  if (!kind || !subtype) return undefined;

  // Enough of a description to be useful without pretending to a full IANA table.
  const suffix = subtype.replace(/^x-|^vnd\./, '').toUpperCase();
  switch (kind) {
    case 'image':
      return `${suffix} image`;
    case 'audio':
      return `${suffix} audio`;
    case 'video':
      return `${suffix} video`;
    case 'text':
      return `${suffix} text`;
    default:
      return undefined;
  }
}

/**
 * Formats a path may carry that no `FORM` payload ever names.
 *
 * Kept apart from the legacy table above, which is a record of what 5.5.1
 * allowed in a `FORM` and should stay that.
 */
const PATH_FORMATS: Record<string, string> = {
  avif: 'image/avif',
  heic: 'image/heic',
  htm: 'text/html',
  html: 'text/html',
  jpe: 'image/jpeg',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
};

/**
 * What a path's extension implies it holds.
 *
 * A `FORM` is the authority where one is written, but it is optional in GEDCOM 7
 * and often missing in practice, and the extension is then the only evidence
 * there is — enough to know whether something is worth showing as a picture.
 */
export function mediaTypeOfPath(path: string): string | undefined {
  // Query and fragment are not part of the name, and a URL may carry both.
  const name = path.trim().split(/[?#]/)[0] ?? '';
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  if (!extension) return undefined;

  return LEGACY_FORMATS[extension] ?? PATH_FORMATS[extension];
}
