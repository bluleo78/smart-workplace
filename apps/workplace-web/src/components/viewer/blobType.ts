// 미리보기 blob 형식 보정(WP-280) — 순수 함수(vitest 대상).
import { canonicalMime, isGenericMime } from '../../lib/mimeFromFilename'

/**
 * 응답 blob 형식이 비었거나 범용(octet-stream 등, 파라미터 포함)인데 항목 형식(파일명 추론 등)을 알면 그 형식으로 다시 감싼다.
 * 왜: 메일 첨부처럼 서버가 octet-stream 으로 주면 모바일 ⤴ 공유·저장 File 의 형식이 틀린다. slice 는 바이트를 복사하지 않는다.
 * 서버가 구체적인 형식을 줬으면 그대로 둔다(항목 형식보다 실제 응답이 우선).
 * SVG 로는 절대 올리지 않는다(보안) — 범용 바이트를 image/svg+xml 로 달면 blob URL 을 새 탭으로 열 때 같은 출처에서 스크립트가 돈다.
 */
export function withItemType(blob: Blob, itemMime: string): Blob {
  if (!isGenericMime(blob.type) || isGenericMime(itemMime)) return blob
  // 여기 오면 blob 형식은 범용이고 항목 형식은 구체적이라 둘이 같을 수 없다 — SVG 만 막으면 된다.
  const target = canonicalMime(itemMime)
  if (target === 'image/svg+xml') return blob
  return blob.slice(0, blob.size, target)
}
