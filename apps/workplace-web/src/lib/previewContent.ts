/**
 * 파일 프리뷰 콘텐츠 판정·디코딩 순수 로직(iacloud_eis FilePreview 에서 이식).
 * 브라우저 없이 검증되도록 바이트 배열만 다룬다 — blob 읽기는 호출처(api/blobContent) 담당.
 */

/** PDF 헤더 시그니처. */
const PDF_MAGIC = new TextEncoder().encode('%PDF-')

/** PDF 스펙상 헤더는 파일 맨 앞이 아니라 앞부분 어딘가에 있어도 된다(일부 변환기가 잡음을 남김) — 그 허용 범위. */
export const PDF_MAGIC_SCAN_BYTES = 1024

/** 디코딩 결과의 대체 문자(U+FFFD) 수 — 해당 인코딩으로 해석할 수 없던 바이트의 양. */
function countReplacement(text: string): number {
  let n = 0
  for (const ch of text) if (ch === '\uFFFD') n++
  return n
}

/**
 * 텍스트 바이트 → 문자열. UTF-8 과 EUC-KR 로 각각 읽어 대체 문자가 **더 적은** 쪽을 고르고, 같으면 UTF-8.
 * 왜: 한국어 Windows 엑셀의 "CSV (쉼표로 분리)" 저장은 CP949(EUC-KR 상위 호환)라 UTF-8 로만 읽으면 한글이 깨진다.
 * 반대로 UTF-8 실패 한 번에 바로 EUC-KR 로 넘기면, 잘못된 바이트가 하나 섞인 UTF-8 한글 문서 전체가 깨진다.
 * TextDecoder 는 기본(ignoreBOM=false)으로 선행 BOM 을 제거한다.
 */
export function decodeTextBuffer(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  // 흔한 경우(정상 UTF-8)는 네이티브 검색 한 번으로 끝낸다 — 개수 세기는 폴백 판정 때만.
  if (!utf8.includes('\uFFFD')) return utf8
  const utf8Bad = countReplacement(utf8)
  const eucKr = new TextDecoder('euc-kr').decode(buffer)
  return countReplacement(eucKr) < utf8Bad ? eucKr : utf8
}

/**
 * 앞 1024바이트 안에 %PDF- 시그니처가 있는지 바이트로 찾는다.
 * 왜: 업로드 시 신고된 mimeType 만 믿고 PDF 뷰어(iframe)에 넘기면 .pdf 로 위장한 HTML 이 렌더될 수 있다.
 */
export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, PDF_MAGIC_SCAN_BYTES)
  for (let i = 0; i + PDF_MAGIC.length <= end; i++) {
    if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true
  }
  return false
}
