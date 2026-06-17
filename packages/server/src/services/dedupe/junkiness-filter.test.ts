import { describe, it, expect } from 'vitest';
import { junkinessScore, isJunky } from './junkiness-filter.js';

describe('junkinessScore', () => {
  it('returns 0 for normal paragraph text', () => {
    const text = 'Twake est une suite collaborative open source développée par Linagora. Elle intègre messagerie, visioconférence et gestion documentaire dans une interface unifiée.';
    expect(junkinessScore(text)).toBeLessThan(0.3);
  });

  it('returns high score for pure separator line', () => {
    expect(junkinessScore('---')).toBeGreaterThan(0.8);
    expect(junkinessScore('===')).toBeGreaterThan(0.8);
    expect(junkinessScore('.............')).toBeGreaterThan(0.8);
  });

  it('returns high score for very short text (< 30 chars)', () => {
    expect(junkinessScore('Titre')).toBeGreaterThan(0.5);
    expect(junkinessScore('OK')).toBeGreaterThan(0.5);
  });

  it('returns high score for TOC / annexe patterns', () => {
    const toc = 'Table des matières\n1. Introduction..............3\n2. Contexte.................7\n3. Annexes.................15';
    expect(junkinessScore(toc)).toBeGreaterThan(0.5);
  });

  it('returns high score when most chars are separator chars', () => {
    // 50% dots — typical of dot-leader TOC lines
    const dotLeader = 'Introduction ........................... 3';
    expect(junkinessScore(dotLeader)).toBeGreaterThan(0.4);
  });
});

describe('isJunky', () => {
  it('returns false for normal content', () => {
    const text = 'Twake est une suite collaborative open source développée par Linagora. Elle intègre messagerie, visioconférence et gestion documentaire dans une interface unifiée.';
    expect(isJunky(text)).toBe(false);
  });

  it('returns true for separator line', () => {
    expect(isJunky('---')).toBe(true);
  });

  it('returns true for very short fragment', () => {
    expect(isJunky('Titre')).toBe(true);
  });
});
