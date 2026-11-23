/** 브라우저·번들러가 지연 묶음(청크)을 못 받았을 때 내는 오류 문구(Chrome·Firefox·Safari·webpack 류). */
const CHUNK_LOAD_MESSAGE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk .* failed/i;

/**
 * 청크 로드 실패인가(ChunkLoadError 이름·브라우저 문구) — 이 실패는 같은 문서 안에서 다시 시도해도 낫지 않는다.
 * 브라우저 모듈 맵이 실패한 주소를 실패로 남기고 React.lazy 도 거부된 약속을 쥐고 있어, 새로고침으로 다시 받아야 한다(WP-2021).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_LOAD_MESSAGE.test(error.message);
}
