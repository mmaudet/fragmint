import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('removes accents and special chars', () => {
    expect(slugify('Réseau & sécurité!')).toBe('reseau-securite');
  });
  it('collapses repeated dashes', () => {
    expect(slugify('a---b')).toBe('a-b');
  });
  it('trims leading/trailing dashes', () => {
    expect(slugify('---a---')).toBe('a');
  });
  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
  it('returns "plan" when input slugs to empty', () => {
    expect(slugify('!!!')).toBe('plan');
    expect(slugify('   ')).toBe('plan');
    expect(slugify('')).toBe('plan');
  });
});
