import type { KeyboardLayout } from '../../types';

export interface TechniqueContext {
  /** ASCII public suffix of the primary domain, e.g. "com" or "co.uk". */
  suffix: string;
  keyboards: KeyboardLayout[];
  /** ASCII TLDs for tld-swap. */
  tlds: string[];
  dictionary: string[];
}

/**
 * Maps a Unicode registrable label to variant labels (tld-swap alone returns
 * suffixes). Output is deduplicated, in a fixed order, and never contains the
 * input itself or an empty string. Validation is the engine's job.
 */
export type TechniqueFn = (label: string, ctx: TechniqueContext) => string[];

/** Runs `fill` and returns what it added, deduplicated in first-seen order, minus `label` and "". */
export function collect(label: string, fill: (add: (variant: string) => void) => void): string[] {
  const out = new Set<string>();
  fill((v) => {
    if (v && v !== label) out.add(v);
  });
  return [...out];
}

/** Code points, so IDN seeds such as "café" are handled per character. */
export const chars = (label: string): string[] => Array.from(label);

/** `cs` with the character at `i` replaced by `s`. */
export const replaceAt = (cs: string[], i: number, s: string): string => cs.slice(0, i).join('') + s + cs.slice(i + 1).join('');

/** `cs` with `s` inserted before index `i`. */
export const insertAt = (cs: string[], i: number, s: string): string => cs.slice(0, i).join('') + s + cs.slice(i).join('');
