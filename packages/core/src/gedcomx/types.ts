/**
 * GEDCOM X conceptual model types.
 *
 * GEDCOM X is an open standard developed by FamilySearch providing JSON and XML
 * representations of genealogical data for modern web APIs.
 *
 * @see https://github.com/FamilySearch/gedcomx
 * @see https://gedcomx.org/
 */

export interface Gedcomx {
  readonly id?: string;
  readonly lang?: string;
  readonly description?: string;
  readonly attribution?: Attribution;
  readonly persons?: Person[];
  readonly relationships?: Relationship[];
  readonly sourceDescriptions?: SourceDescription[];
  readonly agents?: Agent[];
  readonly events?: Event[];
  readonly places?: PlaceDescription[];
  readonly documents?: Document[];
  readonly collections?: Collection[];
}

export interface Attribution {
  readonly contributor?: ResourceReference;
  readonly modified?: number | string;
  readonly changeMessage?: string;
  readonly created?: number | string;
  readonly creator?: ResourceReference;
}

export interface ResourceReference {
  readonly resource?: string;
  readonly resourceId?: string;
}

export interface Person {
  readonly id?: string;
  readonly extracted?: boolean;
  readonly principal?: boolean;
  readonly gender?: Gender;
  readonly names?: Name[];
  readonly facts?: Fact[];
  readonly sources?: SourceCitation[];
  readonly notes?: Note[];
  readonly attribution?: Attribution;
  readonly living?: boolean;
}

export interface Gender {
  /** Usually 'http://gedcomx.org/Male' | 'http://gedcomx.org/Female' | 'http://gedcomx.org/Unknown' or short 'Male' | 'Female' */
  readonly type?: string;
}

export interface Name {
  readonly id?: string;
  /** Usually 'http://gedcomx.org/BirthName', 'http://gedcomx.org/MarriedName', 'http://gedcomx.org/AlsoKnownAs' */
  readonly type?: string;
  readonly preferred?: boolean;
  readonly nameForms?: NameForm[];
  readonly date?: GedcomxDate;
}

export interface NameForm {
  readonly lang?: string;
  readonly fullText?: string;
  readonly parts?: NamePart[];
}

export interface NamePart {
  /** Usually 'http://gedcomx.org/Prefix', 'http://gedcomx.org/Given', 'http://gedcomx.org/Surname', 'http://gedcomx.org/Suffix' */
  readonly type?: string;
  readonly value?: string;
  readonly qualifiers?: Qualifier[];
}

export interface Fact {
  readonly id?: string;
  /** Fact type URI, e.g. 'http://gedcomx.org/Birth', 'http://gedcomx.org/Death', 'http://gedcomx.org/Marriage' */
  readonly type?: string;
  readonly date?: GedcomxDate;
  readonly place?: PlaceReference;
  readonly value?: string;
  readonly qualifiers?: Qualifier[];
  readonly primary?: boolean;
  readonly attribution?: Attribution;
}

export interface GedcomxDate {
  readonly original?: string;
  /** Formal ISO-like date, e.g. '+1900-01-01', 'A+1850' */
  readonly formal?: string;
  readonly normalized?: TextValue[];
}

export interface PlaceReference {
  readonly original?: string;
  readonly description?: string;
  readonly normalized?: TextValue[];
}

export interface Qualifier {
  readonly name?: string;
  readonly value?: string;
}

export interface Relationship {
  readonly id?: string;
  /** 'http://gedcomx.org/Couple' | 'http://gedcomx.org/ParentChild' | 'http://gedcomx.org/AdoptiveParent' */
  readonly type?: string;
  readonly person1?: ResourceReference;
  readonly person2?: ResourceReference;
  readonly facts?: Fact[];
  readonly attribution?: Attribution;
  readonly notes?: Note[];
  readonly sources?: SourceCitation[];
}

export interface SourceDescription {
  readonly id?: string;
  readonly about?: string;
  readonly citation?: string;
  readonly mediaType?: string;
  readonly titles?: TextValue[];
  readonly notes?: Note[];
  readonly attribution?: Attribution;
  readonly repository?: ResourceReference;
}

export interface SourceCitation {
  readonly description?: string;
  readonly descriptionRef?: string;
  readonly value?: string;
}

export interface Agent {
  readonly id?: string;
  readonly names?: TextValue[];
  readonly emails?: ResourceReference[];
  readonly phones?: ResourceReference[];
  readonly addresses?: Address[];
  readonly homepage?: ResourceReference;
  readonly openid?: ResourceReference;
}

export interface Note {
  readonly id?: string;
  readonly subject?: string;
  readonly text?: string;
  readonly attribution?: Attribution;
}

export interface TextValue {
  readonly lang?: string;
  readonly value?: string;
}

export interface Address {
  readonly value?: string;
  readonly city?: string;
  readonly stateOrProvince?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export interface Event {
  readonly id?: string;
  readonly type?: string;
  readonly date?: GedcomxDate;
  readonly place?: PlaceReference;
  readonly roles?: EventRole[];
}

export interface EventRole {
  readonly person?: ResourceReference;
  readonly type?: string;
}

export interface PlaceDescription {
  readonly id?: string;
  readonly names?: TextValue[];
  readonly type?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface Document {
  readonly id?: string;
  readonly type?: string;
  readonly text?: string;
}

export interface Collection {
  readonly id?: string;
  readonly title?: string;
}
