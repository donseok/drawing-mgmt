// R36 — Rule matcher unit tests.
//
// `matchRule` is the single entry point for the rule-based responder. We
// verify each layer of the contract §2 ladder:
//   (a) intent regex     — search intent + (도면|품번)
//   (b) page keyword     — 결재함 → /approvals
//   (c) FAQ dictionary   — 단축키 → shortcuts FAQ
//   (d) final fallback   — gibberish input

import { describe, it, expect } from 'vitest';
import { matchRule } from '../rules';

describe('matchRule', () => {
  it('routes search intent to the search page', () => {
    const r = matchRule('도면 좀 검색해줘');
    expect(r.ruleId).toBe('intent-search');
    expect(r.actions.some((a) => a.kind === 'navigate' && a.href === '/search')).toBe(true);
  });

  it('routes "결재함" keyword to /approvals', () => {
    const r = matchRule('결재함 어디서 봐?');
    expect(r.ruleId).toBe('page:/approvals');
    expect(r.actions[0]?.href).toBe('/approvals');
  });

  it('returns the FAQ entry for shortcuts', () => {
    const r = matchRule('단축키 알려줘');
    expect(r.ruleId).toBe('faq:shortcuts');
    expect(r.response).toMatch(/⌘K|Ctrl\+K/);
  });

  it('falls back when no rule matches', () => {
    const r = matchRule('asdf zxcv qwerty');
    expect(r.ruleId).toBe('fallback');
    // Fallback must always provide at least one navigation chip so the user
    // can escape the dead end.
    expect(r.actions.length).toBeGreaterThan(0);
  });
});
