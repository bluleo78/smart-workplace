/**
 * 통합 첨부 뷰어가 받는 공통 항목(WP-276).
 * 화면(드라이브·이슈·채팅·메일)은 자기 데이터를 이 형태로 바꿔 넘기기만 하고,
 * 버튼 노출(✨·☁·참조된 곳·드라이브에서 열기)은 뷰어가 필드 유무로만 결정한다 — 화면별 분기가 뷰어로 새지 않게.
 */
export interface ViewerItem {
  /** 묶음 안 고유 키 — URL ?preview 값으로도 쓴다. 드라이브 파일·링크 = `drive:{driveFileId}`, 메일 첨부 = `mail:{attachmentId}`, 그 외 = `file:{fileId}`. */
  key: string
  name: string
  mimeType: string
  /** 메타 크기. 모르면 null(10MB 확인을 건너뛴다). */
  sizeBytes: number | null
  /** 인증 blob 경로(`/api/v1` 접두어 있어도 됨). */
  contentPath: string
  /** 다운로드 경로 — 드라이브는 /download(감사 로그), 나머지는 contentPath 와 같다. */
  downloadPath: string
  /** 있으면 ✨ AI 요약(드라이브 파일·드라이브 링크). */
  summaryDriveFileId?: number
  /** 있으면 "참조된 곳"(드라이브 화면에서 연 파일만). */
  backlinksDriveFileId?: number
  /** 있으면 ☁ 드라이브로 가져오기(업로드 첨부 core fileId). */
  importFileId?: number
  /** 있으면 ⋯ "드라이브에서 열기" — 누를 때 파일이 있는 폴더를 찾아 연다(driveOpen.ts). */
  driveOpen?: DriveOpenTarget
  /** 있으면 ⋯ "원본으로 이동". */
  sourceLink?: string
  /** 드라이브 링크 원본이 휴지통·삭제 — 받지 않고 안내만. */
  unavailable?: boolean
}

/** ⋯ "드라이브에서 열기" 대상 — 폴더 id 를 모르므로 공간·파일 id·이름(폴더 검색용)만 든다. */
export interface DriveOpenTarget {
  spaceId: number
  driveFileId: number
  name: string
}
