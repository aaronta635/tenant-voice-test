import { describe, expect, it } from 'vitest';
import { abnProblem, formatAbn, isValidAbn } from './abn';

describe('isValidAbn', () => {
  it.each(['51 824 753 556', '51824753556', '48 123 123 124', '88 000 014 675', ' 53 004 085 616 '])('accepts %s, which passes the ABR checksum', (abn) => {
    expect(isValidAbn(abn)).toBe(true);
  });

  it.each([
    ['one digit off', '51 824 753 557'],
    ['wrong check digits', '12 345 678 901'],
    ['ten digits', '5182475355'],
    ['twelve digits', '518247535560'],
    ['check digits starting with 0', '01 824 753 556'],
    ['dashes', '51-824-753-556'],
    ['letters', 'ABN 51824753556'],
    ['full-width digits', '５１８２４７５３５５６'],
  ])('refuses %s', (_case, abn) => {
    expect(isValidAbn(abn)).toBe(false);
  });
});

describe('formatAbn', () => {
  it('groups the digits as the ABR prints them', () => {
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
    expect(formatAbn(' 51 8247 53556 ')).toBe('51 824 753 556');
  });

  it('leaves anything that is not eleven digits as typed', () => {
    expect(formatAbn(' pending ')).toBe('pending');
  });
});

describe('abnProblem', () => {
  it('lets a blank ABN through: it is optional', () => {
    expect(abnProblem('')).toBeNull();
    expect(abnProblem('   ')).toBeNull();
  });

  it('names the problem with a number that fails the check', () => {
    expect(abnProblem('51 824 753 557')).toMatch(/valid 11-digit ABN/);
    expect(abnProblem('51 824 753 556')).toBeNull();
  });
});
