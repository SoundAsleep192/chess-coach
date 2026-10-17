import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, allowedOrigins, originAllowed } from './origin';

describe('origin check', () => {
  it('defaults to the board and the Vite dev server on both hostnames', () => {
    expect(allowedOrigins(undefined)).toEqual(DEFAULT_ORIGINS);
    expect(DEFAULT_ORIGINS).toEqual(['http://127.0.0.1:8765', 'http://localhost:8765', 'http://127.0.0.1:5173', 'http://localhost:5173']);
  });
  it('BOARD_ORIGINS replaces the list, trims and drops empties', () => {
    expect(allowedOrigins(' http://a:1 ,,http://b:2 ')).toEqual(['http://a:1', 'http://b:2']);
  });
  it('allows a missing origin and listed origins, rejects others', () => {
    expect(originAllowed(undefined, DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://localhost:8765', DEFAULT_ORIGINS)).toBe(true);
    expect(originAllowed('http://evil.example', DEFAULT_ORIGINS)).toBe(false);
    expect(originAllowed('null', DEFAULT_ORIGINS)).toBe(false);
  });
});
