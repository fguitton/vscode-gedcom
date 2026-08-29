/**
 * The content security policy the panels are served under.
 *
 * Kept apart from the panels themselves, and free of any VS Code import, so it
 * can be asserted on directly. What it permits is the whole of the difference
 * between a panel that can reach the network and one that cannot, and that is
 * not a promise to make in a template literal nobody can test.
 *
 * The default is `none`: every source a panel needs is then granted explicitly,
 * so a capability can only appear here on purpose.
 */

export interface Policy {
  /** The nonce carried by the panel's own inline style and script. */
  readonly nonce: string;
  /**
   * Permit images fetched over `https` and local workspace webview URIs.
   *
   * Only ever true where the reader has asked for previews. `http` is not
   * offered at any setting: a thumbnail does not justify a plaintext request
   * announcing which file is being read, and to whom.
   */
  readonly images?: boolean;
  /** The webview's CSP source for loading local workspace resources. */
  readonly cspSource?: string;
}

export function contentSecurityPolicy({ nonce, images = false, cspSource }: Policy): string {
  const imageSources = ['https:'];
  if (cspSource) imageSources.push(cspSource);

  return [
    "default-src 'none'",
    ...(images ? [`img-src ${imageSources.join(' ')}`] : []),
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
}
