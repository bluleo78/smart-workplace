import { safeSessionStorage } from './safeLocalStorage';

/** 브라우저·번들러가 지연 묶음(청크)을 못 받았을 때 내는 오류 문구(Chrome·Firefox·Safari·webpack 류, Vite 의 CSS 청크 실패 「Unable to preload CSS for …」). */
const CHUNK_LOAD_MESSAGE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk .* failed|Unable to preload CSS for/i;

/**
 * 청크 로드 실패인가(ChunkLoadError 이름·브라우저 문구) — 이 실패는 같은 문서 안에서 다시 시도해도 낫지 않는다.
 * 브라우저 모듈 맵이 실패한 주소를 실패로 남기고 React.lazy 도 거부된 약속을 쥐고 있어, 새로고침으로 다시 받아야 한다(WP-2021).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_LOAD_MESSAGE.test(error.message);
}

/** 청크 실패로 새로고침한 때를 담는 sessionStorage 키 — 새로고침 뒤 같은 실패가 되풀이되는지 알아보려고 남긴다(WP-2021 리뷰 후속). */
export const CHUNK_RELOAD_KEY = 'chunkReload';
/** 새로고침 「직후」로 보는 시간 — 다시 받은 문서가 그 청크를 부르기까지(인증·첫 그리기) 넉넉히 1분. */
const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * 청크 실패로 새로고침한다는 표시를 남긴다 — 시각과 오류 문구(실패한 청크 주소가 들어 있다)를 함께 남겨,
 * 새로고침 뒤 「같은 청크」가 또 실패할 때만 되풀이로 본다. 저장소 오류는 무시한다(표시 없이 새로고침만 한다).
 */
export function markChunkReload(error: Error): void {
  try {
    safeSessionStorage()?.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ at: Date.now(), message: error.message }));
  } catch {
    // 저장소 접근 오류 — 되풀이 안내만 못 할 뿐 새로고침은 한다
  }
}

/**
 * 이 오류가 청크 실패로 새로고침한 직후(1분 안) 같은 청크의 실패인가 — 읽기만 한다(React 가 오류 상태 계산을 다시 부를 수 있다).
 * 새로고침이 고쳐 준 뒤 다른 청크가 실패하거나, 시계가 뒤로 가 시각이 미래면 되풀이로 보지 않는다. 저장소를 쓸 수 없으면 아니다.
 */
export function isChunkFailureAfterReload(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const raw = safeSessionStorage()?.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return false;
    const mark = JSON.parse(raw) as { at?: unknown; message?: unknown };
    const elapsed = Date.now() - Number(mark.at);
    return elapsed >= 0 && elapsed < CHUNK_RELOAD_WINDOW_MS && mark.message === (error as Error).message;
  } catch {
    return false;
  }
}

/** 새로고침 표시를 지운다 — 되풀이를 한 번 알렸으면 다음 실패는 새로 센다. */
export function clearChunkReload(): void {
  safeSessionStorage()?.removeItem(CHUNK_RELOAD_KEY);
}
