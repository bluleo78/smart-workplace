// 미리보기 blob 형식 보정(WP-280) — 순수 함수(vitest 대상).

const OCTET_STREAM = 'application/octet-stream'

/**
 * 응답 blob 형식이 비었거나 octet-stream 인데 항목 형식(파일명 추론 등)을 알면 그 형식으로 다시 감싼다.
 * 왜: 메일 첨부처럼 서버가 octet-stream 으로 주면 blob URL 의 형식도 octet-stream 이라 SVG 이미지가 그려지지 않고,
 *     모바일 ⤴ 공유·저장 File 의 형식도 틀린다. slice 는 바이트를 복사하지 않는다.
 * 서버가 구체적인 형식을 줬으면 그대로 둔다(항목 형식보다 실제 응답이 우선).
 */
export function withItemType(blob: Blob, itemMime: string): Blob {
  const generic = !blob.type || blob.type === OCTET_STREAM
  if (!generic || !itemMime || itemMime === OCTET_STREAM || itemMime === blob.type) return blob
  return blob.slice(0, blob.size, itemMime)
}
