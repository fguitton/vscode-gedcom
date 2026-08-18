/**
 * Types and interfaces for pluggable kinship language formatting.
 */

export interface AffinityDescription {
  readonly title: string;
  readonly description: (targetName: string, sourceName: string) => string;
}

export interface KinshipFormatter {
  /** Language identifier (e.g. 'en', 'fr'). */
  readonly locale: string;

  /** Description when source and target are the same individual. */
  describeIdentity(name: string): string;

  /**
   * Title for a consanguineous relationship based on ancestor generation distance.
   * @param dA Distance in generations from Source to common ancestor (0 = source is ancestor)
   * @param dB Distance in generations from Target to common ancestor (0 = target is ancestor)
   * @param sex Biological sex of the target ('M' | 'F' | 'U')
   * @param isHalf Whether the relationship is through a single parent
   */
  describeConsanguinity(dA: number, dB: number, sex: 'M' | 'F' | 'U', isHalf: boolean): string;

  /**
   * Title and description for affinity/marriage relationships.
   */
  describeAffinity(
    kind: 'spouse' | 'stepparent' | 'in-law',
    sex: 'M' | 'F' | 'U',
  ): AffinityDescription;

  /**
   * Full descriptive sentence for consanguineous relation including common ancestors.
   */
  formatConsanguinityDescription(
    targetName: string,
    sourceName: string,
    relationshipTitle: string,
    sex: 'M' | 'F' | 'U',
    ancestorNames: readonly string[],
  ): string;
}
