// Single import point for the discovery module's dependencies, so the
// pipeline does not care how core/domain and core/permute are laid out.
export { normalizeDomain, registrableDomain, splitDomain, markToSeeds, matchInventory, parseDomainList } from '../core/domain';
export { generatePermutations } from '../core/permute';
