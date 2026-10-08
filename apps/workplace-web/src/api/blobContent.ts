import { decodeTextBuffer, hasPdfMagicBytes, PDF_MAGIC_SCAN_BYTES } from '../lib/previewContent'
import { client } from './client'

// axios client baseURL 이 '/api/v1' 이므로, '/api/v1/...' 절대 경로는 접두어를 제거해 중복 호출을 막는다.
// 앞부분에만 적용한다 — 경로 중간의 같은 문자열은 실제 경로 일부이므로 건드리면 안 된다.
export function stripApiPrefix(path: string): string {
  return path.replace(/^\/api\/v1/, '')
}

/** 받는 중 진행 보고 — loaded 는 받은 바이트, total 은 응답 전체 크기(Content-Length 가 없으면 undefined). */
export type BlobProgress = (p: { loaded: number; total: number | undefined }) => void

/**
 * 임의 콘텐츠 경로(/api/v1/... 절대경로 가능)의 원본 Blob. 호출처가 objectURL/text() 로 변환.
 * onProgress 를 주면 받는 동안 진행을 보고한다(WP-281 영상·오디오 % 표시) — axios 의 onDownloadProgress 를 쓴다.
 * signal 로 받던 요청을 끊을 수 있다.
 * fetch/ReadableStream 으로 바꾸지 않는 이유: Bearer 인터셉터·401 재발급 큐를 그대로 타야 하기 때문.
 */
export async function fetchBlobByPath(path: string, opts: { onProgress?: BlobProgress; signal?: AbortSignal } = {}): Promise<Blob> {
  const { onProgress, signal } = opts
  const { data } = await client.get<Blob>(stripApiPrefix(path), {
    responseType: 'blob',
    // 호출부가 넘김·닫기 때 끊을 수 있게(WP-281) — 끊기면 reject(CanceledError), 호출부의 alive 가드가 버린다.
    signal,
    onDownloadProgress: onProgress ? (e) => onProgress({ loaded: e.loaded, total: e.total || undefined }) : undefined,
  })
  return data
}

/**
 * Blob → 텍스트. blob.text() 는 UTF-8 고정이라 EUC-KR(한국어 엑셀 CSV) 한글이 깨진다 —
 * 바이트로 읽어 UTF-8 실패 시 EUC-KR 로 폴백한다(WP-203).
 * maxBytes 를 주면 앞부분만 디코딩한다(큰 로그 미리보기) — 잘린 끝의 반쪽 글자는 디코더가 버린다.
 */
export async function blobToText(blob: Blob, { maxBytes }: { maxBytes?: number } = {}): Promise<string> {
  const truncated = maxBytes != null && blob.size > maxBytes
  const head = truncated ? blob.slice(0, maxBytes) : blob
  return decodeTextBuffer(await head.arrayBuffer(), { truncated })
}

/**
 * PDF 로 신고된 blob 을 뷰어에 넘기기 전에 검증한다 — 앞부분에 %PDF- 가 없으면 throw.
 * 통과하면 타입을 application/pdf 로 다시 감싼다: 신고 mimeType 을 그대로 물려받으면
 * .pdf 로 위장한 HTML 이 (sandbox 없는) PDF iframe 에서 렌더돼 세션에 닿을 수 있다(WP-203, iacloud_eis 이식).
 * PDF 를 화면에 띄우는 모든 경로는 이 함수를 거친다.
 */
export async function toVerifiedPdfBlob(blob: Blob): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, PDF_MAGIC_SCAN_BYTES).arrayBuffer())
  if (!hasPdfMagicBytes(head)) throw new Error('PDF 시그니처가 없는 콘텐츠')
  return new Blob([blob], { type: 'application/pdf' })
}
