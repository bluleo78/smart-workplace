import { canonicalMime } from '../../lib/mimeFromFilename'

/**
 * 서명 재생 주소로 바로 재생할 형식(WP-1532) — API `DrivePlaybackService.PLAYABLE_MIMES` 와 같은 목록(별칭은 canonicalMime 이 정규형으로 맞춘다).
 * 브라우저 미디어 요소가 한 파일로 여는 구체적인 컨테이너만 — 재생 목록(m3u8)·asf·avi 등은 서버가 발급하지 않으므로(409) 웹도 묻지 않고
 * 기존 blob 경로(받아서 재생 시도 → 안 되면 미지원 화면 + 다운로드)로 둔다. 목록을 바꿀 때는 두 곳을 함께 바꾼다.
 */
const STREAMABLE_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/flac',
])

/** 이 형식을 재생 주소로 바로 재생하는가(파라미터·대소문자·별칭 무시). */
export function isStreamableMime(mime: string | null | undefined): boolean {
  return STREAMABLE_MIMES.has(canonicalMime(mime))
}
