import { describe, expect, it } from 'vitest';
import { MAX_POSTER_CHARACTERS, POSTER_WIDTH } from './poster-quality';
import { posterLayout } from './poster';

describe('严格高清海报', () => {
  it('始终固定1920宽，支持100位，不截取超过上限的角色', () => {
    expect(POSTER_WIDTH).toBe(1920);
    expect(MAX_POSTER_CHARACTERS).toBe(100);
    expect(posterLayout(100).width).toBe(1920);
    expect(() => posterLayout(101)).toThrow('最多支持100位');
  });
});
