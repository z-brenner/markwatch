import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/core/util';

describe('util', () => {
  it('sha256Hex matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('canonicalJson sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
});
