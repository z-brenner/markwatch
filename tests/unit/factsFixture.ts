import type { DomainFacts } from '../../src/core/types';

export function facts(over: Partial<DomainFacts> = {}): DomainFacts {
  return {
    verdict: 'registered',
    verdictReason: 'test',
    ns: [],
    a: [],
    aaaa: [],
    mx: [],
    txt: [],
    networks: {},
    abusix: {},
    providers: [],
    ct: [],
    ...over,
  };
}
