// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._tld), list order preserved.

import type { TechniqueFn } from './context';

/** Returns SUFFIXES, not labels: every configured TLD except the primary domain's own suffix. */
export const tldSwap: TechniqueFn = (_label, ctx) => [...new Set(ctx.tlds)].filter((t) => t && t !== ctx.suffix);
