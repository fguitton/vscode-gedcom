/**
 * The details panel's content.
 *
 * Two rules shape all of it. Anything the graph already draws is left out, so
 * the panel spends its space on what the chart had to discard. And composition
 * is generic rather than a list of tags we thought of, so a file using something
 * unanticipated still shows it rather than dropping it silently — which is the
 * failure nobody notices.
 */

import { describe, expect, it } from 'vitest';

import { documentDetails, escapeDepth, recordDetails, type Details } from '../src/details.ts';
import { analyze } from '../src/index.ts';
import { bytes, fixture } from './corpus.ts';

/** Flattens a rendering into `Section/Label` → value, for readable assertions. */
function fields(details: Details): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const section of details.sections) {
    for (const field of section.fields) flat[`${section.title}/${field.label}`] = field.value;
  }
  return flat;
}

const PERSON = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 SUBM @U1@',
  '1 NOTE Compiled from parish registers.',
  '0 @U1@ SUBM',
  '1 NAME Alice Archivist',
  '1 EMAIL alice@example.org',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '2 PLAC Chelsea, London, England',
  '1 OCCU Blacksmith',
  '2 PLAC Sheffield',
  '1 DEAT Y',
  '2 DATE 3 MAR 1975',
  '1 FAMS @F1@',
  '1 NOTE Identified from a photograph.',
  '1 SOUR @S1@',
  '2 PAGE page 14',
  '1 REFN 4471',
  '0 @I2@ INDI',
  '1 NAME Jane /Doe/',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '0 @S1@ SOUR',
  '1 TITL Parish register of St Luke',
  '0 TRLR',
  '',
].join('\n');

const analysis = analyze(bytes(PERSON));

describe('a record', () => {
  const details = recordDetails(analysis, 'I1')!;
  const flat = fields(details);

  it('is titled by name and says what kind of record it is', () => {
    expect(details.title).toBe('John Smith');
    expect(details.subtitle).toBe('Individual');
  });

  it('reads an event as one line rather than as its parts', () => {
    // The payload alone is half the fact: an event keeps its detail in
    // substructures, so it has to be read as a whole to say anything.
    // The month is written out: the panel is prose, not the file.
    expect(flat['Facts/Birth']).toBe('12 August 1901 · Chelsea, London, England');
    expect(flat['Facts/Occupation']).toBe('Blacksmith · Sheffield');
  });

  it('drops the bare Y once there is a real date to show', () => {
    // `1 DEAT Y` asserts only that it happened, which is noise beside a date.
    expect(flat['Facts/Death']).toBe('3 March 1975');
  });

  it('leaves out what the graph is already drawing', () => {
    expect(Object.keys(flat).some((key) => key.includes('Family spouse'))).toBe(false);
  });

  it('separates notes, sources and identifiers from facts', () => {
    expect(flat['Notes/Note']).toBe('Identified from a photograph.');
    expect(flat['Sources/Source']).toBe('Parish register of St Luke · page 14');
    expect(flat['Identifiers/Reference']).toBe('4471');
  });

  it('gives each field a line, so the panel can reveal it', () => {
    for (const section of details.sections) {
      for (const field of section.fields) expect(field.line).toBeTypeOf('number');
    }
  });

  it('has nothing to say about a record that does not exist', () => {
    expect(recordDetails(analysis, 'NOPE')).toBeUndefined();
  });
});

describe('the file', () => {
  const flat = fields(documentDetails(analysis));

  it('counts what is in it', () => {
    // The label agrees in number with the count beside it.
    expect(flat['Contents/Individuals']).toBe('2');
    expect(flat['Contents/Family']).toBe('1');
  });

  it('describes the submitter, who is nobody in the family', () => {
    // A submitter drawn into the graph became a box with no generation and no
    // relationships, hanging off the side of a tree it has nothing to do with.
    expect(flat['Submitter/Name']).toBe('Alice Archivist');
    expect(flat['Submitter/Email']).toBe('alice@example.org');
  });

  it('carries the header notes', () => {
    expect(flat['Notes/File note']).toBe('Compiled from parish registers.');
  });
});

describe('against Royal92', () => {
  const royal = analyze(fixture('v5/Royal92.ged').bytes);
  const flat = fields(documentDetails(royal));

  it('finds a submitter that nothing points at', () => {
    // PAF-era files carry a SUBM record with no pointer from the header, and
    // Linguist's own sample is one of them.
    expect(flat['Submitter/Name']).toBe('Denis R. Reid');
    expect(flat['Submitter/Address']).toContain('Kimrose Lane');
  });

  it('keeps a custom tag rather than dropping it silently', () => {
    // The file's provenance is recorded under a non-standard `COMM`.
    expect(flat['Submitter/Comment']).toContain('Denis Reid');
  });

  it('keeps every line of folded text, not just the first', () => {
    // `CONT` reassembly works; it was this layer that used to throw the rest
    // away. The posting runs to twenty-eight lines and the signature is at the
    // very bottom of it.
    const comm = flat['Submitter/Comment']!;
    expect(comm.split('\n')).toHaveLength(28);
    expect(comm).toContain('MERRY CHRISTMAS');
    expect(comm.trimEnd().endsWith('Thanks for your interest.   Denis Reid')).toBe(true);
  });

  it('marks folded text as a block, so a panel can lay it out as text', () => {
    const submitter = documentDetails(royal).sections.find((s) => s.title === 'Submitter')!;
    const byLabel = (label: string) => submitter.fields.find((f) => f.label === label);

    // The line breaks in an address and in correspondence *are* the layout.
    expect(byLabel('Comment')?.block).toBe(true);
    expect(byLabel('Address')?.block).toBe(true);
    // A single-line value stays an ordinary labelled row.
    expect(byLabel('Phone')?.block).toBeFalsy();
  });

  it('names the program that wrote the file', () => {
    expect(flat['File/Written by']).toBe('PAF 2.2');
    expect(flat['File/Character set']).toBe('ANSEL');
  });

  describe('the submitter as a record in its own right', () => {
    // Selecting @S1@ goes through recordDetails rather than documentDetails, and
    // that path used to cut every payload down to its first line.
    const details = recordDetails(royal, 'S1')!;
    const byLabel = (label: string) =>
      details.sections.flatMap((section) => section.fields).find((f) => f.label === label);

    it('keeps folded text whole here too', () => {
      expect(byLabel('Comment')?.value.split('\n')).toHaveLength(28);
      expect(byLabel('Address')?.value.split('\n')).toHaveLength(3);
    });

    it('marks that text as a block', () => {
      expect(byLabel('Comment')?.block).toBe(true);
      expect(byLabel('Address')?.block).toBe(true);
      expect(byLabel('Phone')?.block).toBeFalsy();
    });

    it('names a vendor tag in English instead of showing the tag', () => {
      // No specification defines COMM; it is PAF's comment field, and it is what
      // carries this file's provenance.
      expect(byLabel('COMM')).toBeUndefined();
      expect(byLabel('Comment')).toBeDefined();
    });
  });
});

describe('names', () => {
  const person = (...lines: string[]) =>
    recordDetails(
      analyze(
        bytes(['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @I1@ INDI', ...lines, '0 TRLR', ''].join('\n')),
      ),
      'I1',
    )!;

  it('reads the slashes rather than printing them', () => {
    // The slashes are how GEDCOM marks the surname, not punctuation in the name.
    const flat = fields(person('1 NAME Harriet Mae /Ashworth/'));
    expect(flat['Facts/Name']).toBe('Harriet Mae Ashworth');
    expect(flat['Facts/Given name']).toBe('Harriet Mae');
    expect(flat['Facts/Surname']).toBe('Ashworth');
  });

  it('keeps the order the file wrote', () => {
    // A name recorded surname-first was recorded that way on purpose, and the
    // format exists to carry names from cultures that do exactly that.
    expect(fields(person('1 NAME /Ashworth/ Harriet'))['Facts/Name']).toBe('Ashworth Harriet');
  });

  it('says nothing about parts when no surname is marked', () => {
    // Mononyms are real, and plenty of exporters simply never wrote the slashes;
    // repeating the whole payload as "given name" would say the same thing twice.
    const flat = fields(person('1 NAME Pocahontas'));
    expect(flat['Facts/Name']).toBe('Pocahontas');
    expect(flat['Facts/Given name']).toBeUndefined();
    expect(flat['Facts/Surname']).toBeUndefined();
  });

  it('prefers the parts the file states over its own reading of the string', () => {
    const flat = fields(
      person('1 NAME Harriet Mae /Ashworth/', '2 GIVN Harriet', '2 SURN Ashworth-Hale'),
    );
    expect(flat['Facts/Given name']).toBe('Harriet');
    expect(flat['Facts/Surname']).toBe('Ashworth-Hale');
  });

  it('tells two names apart by their type', () => {
    // A person may hold several; two rows both labelled "Name" say nothing about
    // which is which.
    const flat = fields(
      person(
        '1 NAME /Family/ Personal',
        '2 TYPE PROFESSIONAL',
        '1 NAME King /Kong/',
        '2 TYPE Screen',
      ),
    );
    expect(flat['Facts/Professional name']).toBe('Family Personal');
    expect(flat['Facts/Name (Screen)']).toBe('King Kong');
  });
});

describe('a structure that carries nothing', () => {
  it('is marked empty rather than given a word the file never said', () => {
    // `1 _MAYBE` with no payload and nothing beneath it is a tag somebody wrote
    // and left blank. Dropping the row hides it; filling it in invents content.
    const details = recordDetails(
      analyze(
        bytes(
          ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @I1@ INDI', '1 _MAYBE', '0 TRLR', ''].join('\n'),
        ),
      ),
      'I1',
    )!;

    const field = details.sections.flatMap((section) => section.fields)[0];
    expect(field?.value).toBe('');
    expect(field?.empty).toBe(true);
  });
});

describe('a date with a time under it', () => {
  it('shows the time as part of the date', () => {
    // TIME hangs under DATE rather than beside it, in 5.5.1 and in 7.0 alike, so
    // a reader of the DATE alone drops it — and a change record exists to say
    // exactly when.
    const details = recordDetails(
      analyze(
        bytes(
          [
            '0 HEAD',
            '1 GEDC',
            '2 VERS 5.5.1',
            '0 @I1@ INDI',
            '1 CHAN',
            '2 DATE 14 FEB 1998',
            '3 TIME 09:22:41',
            '0 TRLR',
            '',
          ].join('\n'),
        ),
      ),
      'I1',
    )!;

    expect(fields(details)['Facts/Change']).toBe('14 February 1998 at 09:22:41');
  });
});

describe('media the file points at', () => {
  const media = (source: string) => {
    const details = recordDetails(analyze(bytes(source)), 'I1')!;
    return details.sections.find((section) => section.title === 'Media')?.fields ?? [];
  };

  const file = (...object: string[]) =>
    ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @I1@ INDI', ...object, '0 TRLR', ''].join('\n');

  it('offers a URL as something to open', () => {
    const [field] = media(
      file(
        '1 OBJE',
        '2 FORM image/jpeg',
        '2 FILE https://example.org/photo.jpg',
        '2 TITL Grandmother at the fair',
      ),
    );

    expect(field?.label).toBe('Grandmother at the fair');
    expect(field?.url).toBe('https://example.org/photo.jpg');
    expect(field?.mediaType).toBe('image/jpeg');
  });

  it('reads the type from the extension when no FORM says', () => {
    // FORM is optional in GEDCOM 7 and frequently absent in 5.5.1 files that
    // otherwise parse; the path is then the only evidence of what the thing is.
    const [field] = media(file('1 OBJE', '2 FILE https://example.org/scan.PNG'));
    expect(field?.mediaType).toBe('image/png');
    expect(field?.value).toContain('PNG image');
  });

  it('resolves the legacy spelling of a format', () => {
    const [field] = media(file('1 OBJE', '2 FORM jpeg', '2 FILE https://example.org/a.dat'));
    expect(field?.mediaType).toBe('image/jpeg');
  });

  it('offers nothing to open for a path that is not a URL', () => {
    // A great many files name a folder on a machine retired two decades ago.
    const [field] = media(file('1 OBJE', '2 FORM jpg', '2 FILE C:\\Family\\Scans\\gran.jpg'));
    expect(field?.value).toContain('gran.jpg');
    expect(field?.url).toBeUndefined();
  });

  it('refuses a scheme that is not the web', () => {
    // The payload is free text from a document the reader may merely have been
    // sent, and the panel hands whatever it is given to the operating system.
    for (const path of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'vscode://ms-vscode.node-debug',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const [field] = media(file('1 OBJE', '2 FORM image/png', `2 FILE ${path}`));
      expect(field?.url, `${path} must not be offered as a link`).toBeUndefined();
    }
  });
});

describe('a source citation', () => {
  const cited = (...lines: string[]) => {
    const details = recordDetails(
      analyze(
        bytes(
          ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', ...lines, '0 TRLR', ''].join('\n'),
        ),
      ),
      'I1',
    )!;
    return details.sections.find((s) => s.title === 'Sources')?.fields ?? [];
  };

  const LONG =
    'https://www.myheritage.com/research/record-10678-3369500/harold-l-vass-in-1939-register-of-england-wales?s=781598791';

  it('keeps a long URL whole, so the link still resolves', () => {
    // Truncated to eighty characters and then linkified, a citation URL became a
    // link with an ellipsis in the middle of it, going nowhere.
    const [field] = cited('1 SOUR @S1@', `2 PAGE ${LONG}`);
    expect(field?.url).toBe(LONG);
    expect(field?.value).toContain(LONG);
    expect(field?.value).not.toContain('…');
  });

  it('says how much the citation is worth', () => {
    expect(cited('1 SOUR @S1@', '2 QUAY 3')[0]?.value).toContain('quality: primary');
  });

  it('shows a confidence code even when it is not one of the four', () => {
    // MyHeritage writes `QUAY 4`, which the specification does not define.
    // Hiding it would hide that the file claims something unreadable.
    expect(cited('1 SOUR @S1@', '2 QUAY 4')[0]?.value).toContain('quality: 4');
  });

  it('shows the transcription the exporter attached', () => {
    const fields = cited('1 SOUR @S1@', '2 DATA', '3 TEXT Added by confirming a Smart Match');
    expect(fields.some((f) => f.value.includes('Smart Match'))).toBe(true);
  });
});

describe('markup that reached the file escaped', () => {
  it('counts how many times, so a panel can decode exactly that far', () => {
    expect(escapeDepth('<p>Plain markup</p>')).toBe(0);
    expect(escapeDepth('&lt;p&gt;Escaped once&lt;/p&gt;')).toBe(1);
    // MyHeritage escapes citation text as HTML and then again as text.
    expect(escapeDepth('&amp;lt;br&amp;gt;Escaped twice')).toBe(2);
  });

  it('says nothing was escaped when nothing was markup', () => {
    expect(escapeDepth('Marks &amp; Spencer, a shop')).toBe(0);
    expect(escapeDepth('5 < 7 and 7 > 5')).toBe(0);
    expect(escapeDepth('')).toBe(0);
  });

  it('leaves markup written plainly alone', () => {
    // Decoding this would turn an ampersand the author wrote deliberately into
    // one the file never held.
    expect(escapeDepth('<p>Marks &amp; Spencer</p>')).toBe(0);
  });

  it('offers the switch on a citation transcription, not only on a note', () => {
    const details = recordDetails(
      analyze(
        bytes(
          [
            '0 HEAD',
            '1 GEDC',
            '2 VERS 5.5.1',
            '0 @I1@ INDI',
            '1 SOUR @S1@',
            '2 DATA',
            '3 TEXT Harold L Vass&amp;lt;br&amp;gt;Gender: Male',
            '0 @S1@ SOUR',
            '0 TRLR',
            '',
          ].join('\n'),
        ),
      ),
      'I1',
    )!;

    const text = details.sections.flatMap((s) => s.fields).find((f) => f.label.endsWith('text'));

    expect(text?.html).toBe(true);
    expect(text?.escapeDepth).toBe(2);
  });
});
