import { describe, expect, it } from 'vitest';

import { isChunkLoadError } from './chunkLoadError';

// 청크 로드 실패 판정(WP-2021) — 브라우저별 문구와 이름으로 가리고, 그 밖의 오류는 아니라고 본다.
describe('isChunkLoadError', () => {
  it('브라우저별 동적 import 실패 문구를 청크 실패로 본다', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true);
  });

  it('ChunkLoadError 이름이면 문구와 상관없이 청크 실패다', () => {
    const e = new Error('x');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it('일반 렌더 오류·Error 가 아닌 값은 청크 실패가 아니다', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
