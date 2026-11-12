/**
 * 드라이브 업로드 전 사전 검사 상한(WP-1519).
 *
 * 서버는 파일마다 범주 상한을 건다 — 동영상(VIDEO) 1GB, PDF·문서·데이터 100MB, 미분류 25MB 등(FileUploadService).
 * 멀티파트 상한이 동영상에 맞춰 1GB 가 되었으므로, 한 값(1GB)으로만 미리 막으면 500MB PDF 를 끝까지 올린 뒤에야 거절된다.
 * 그래서 동영상은 1GB, 그 외는 동영상 외 범주의 최댓값인 100MB 로 미리 막는다. 100MB 이하의 범주별 차이(미분류 25MB 등)는
 * 예전처럼 서버가 한국어 문구로 거절한다.
 */
import { isVideoFile } from '../../lib/mimeFromFilename'

const MB = 1024 * 1024

/** 동영상 상한 — 서버 VIDEO 범주 상한·multipart max-file-size(1GB)와 같다. */
export const VIDEO_MAX_UPLOAD_BYTES = 1024 * MB
/** 동영상이 아닌 파일의 상한 — 서버 PDF·DOCUMENT·DATA 범주 상한(100MB)과 같다(WP-803). */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * MB

/** 사전 검사에 쓰는 파일 정보 — File 이 이 모양을 갖는다(테스트는 평범한 객체로 넘긴다). */
export interface UploadCandidate {
  name: string
  type: string
}

/**
 * 서버가 이 파일을 동영상(VIDEO)으로 볼지 — 서버와 같은 순서로 판정한다.
 * 브라우저 형식이 구체적이면 그 값(video/ 로 시작하는지), 비었거나 octet-stream 이면 파일 이름 확장자(공유 표 lib/mimeFromFilename)로 정한다.
 */
export function isVideoUpload(file: UploadCandidate): boolean {
  return isVideoFile(file.type, file.name)
}

/** 바이트 → 안내 문구용 크기(딱 떨어지는 GB 는 「1GB」, 그 외 MB) — 서버 문구 표기와 같다. */
function sizeLabel(bytes: number): string {
  const gb = 1024 * MB
  return bytes >= gb && bytes % gb === 0 ? `${bytes / gb}GB` : `${bytes / MB}MB`
}

/** 이 파일을 올리기 전에 막을 상한과 안내 문구용 크기. 크기가 maxBytes 를 넘으면 요청 없이 안내한다. */
export function uploadLimitFor(file: UploadCandidate): { maxBytes: number; label: string } {
  const maxBytes = isVideoUpload(file) ? VIDEO_MAX_UPLOAD_BYTES : DEFAULT_MAX_UPLOAD_BYTES
  return { maxBytes, label: sizeLabel(maxBytes) }
}
