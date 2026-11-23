// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHUNK_RELOAD_KEY, clearChunkReload, isChunkFailureAfterReload, isChunkLoadError, markChunkReload } from './chunkLoadError';

// 청크 로드 실패 판정(WP-2021) — 브라우저별 문구와 이름으로 가리고, 그 밖의 오류는 아니라고 본다.
describe('isChunkLoadError', () => {
  it('브라우저별 동적 import 실패 문구를 청크 실패로 본다', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true);
    // Vite 가 CSS 청크를 못 받았을 때 던지는 문구(vite:preloadError)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/MailLayout-abc.css'))).toBe(true);
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

// 새로고침 직후 되풀이 판정(WP-2021 리뷰 후속) — 같은 청크가 1분 안에 또 실패할 때만 되풀이로 본다.
describe('isChunkFailureAfterReload', () => {
  const failA = () => new TypeError('Failed to fetch dynamically imported module: http://x/a.js');
  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it('새로고침 표시를 남긴 뒤 1분 안에 같은 청크가 실패하면 되풀이다', () => {
    markChunkReload(failA());
    expect(isChunkFailureAfterReload(failA())).toBe(true);
    // 읽기만 하므로 다시 물어도 같다
    expect(isChunkFailureAfterReload(failA())).toBe(true);
    clearChunkReload();
    expect(isChunkFailureAfterReload(failA())).toBe(false);
  });

  it('다른 청크의 실패·청크 실패가 아닌 오류는 되풀이가 아니다', () => {
    markChunkReload(failA());
    expect(isChunkFailureAfterReload(new TypeError('Failed to fetch dynamically imported module: http://x/b.js'))).toBe(false);
    expect(isChunkFailureAfterReload(new Error('렌더 오류'))).toBe(false);
  });

  it('1분이 지났거나 표시 시각이 미래(시계가 뒤로 감)면 되풀이가 아니다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
    markChunkReload(failA());
    vi.setSystemTime(new Date('2026-11-23T10:01:01Z'));
    expect(isChunkFailureAfterReload(failA())).toBe(false);
    vi.setSystemTime(new Date('2026-11-23T09:50:00Z'));
    expect(isChunkFailureAfterReload(failA())).toBe(false);
  });

  it('표시가 깨져 있으면 되풀이가 아니다', () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '{깨짐');
    expect(isChunkFailureAfterReload(failA())).toBe(false);
  });
});
