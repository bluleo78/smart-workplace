import type { BlobProgress } from '../../api/blobContent'
import type { ConvertedPreviewResponse } from '../../api/drive'

/**
 * 통합 첨부 뷰어가 받는 공통 항목(WP-276).
 * 화면(드라이브·이슈·채팅·메일)은 자기 데이터를 이 형태로 바꿔 넘기기만 하고,
 * 버튼 노출(✨·☁·참조된 곳·드라이브에서 열기)은 뷰어가 필드 유무로만 결정한다 — 화면별 분기가 뷰어로 새지 않게.
 */
export interface ViewerItem {
  /** 묶음 안 고유 키 — 열림 상태(?preview·채팅은 router state) 값으로도 쓴다. 드라이브 파일·링크 = `drive:{driveFileId}`, 메일 첨부 = `mail:{attachmentId}`, 채팅 = `{msg|cmsg|turn}:{메시지}:{file|drive}:{id}`, 그 외 = `file:{fileId}`. */
  key: string
  name: string
  mimeType: string
  /** 메타 크기. 모르면 null(10MB 확인을 건너뛴다). */
  sizeBytes: number | null
  /** 인증 blob 경로(`/api/v1` 접두어 있어도 됨). */
  contentPath: string
  /** 다운로드 경로 — 드라이브는 /download(감사 로그), 나머지는 contentPath 와 같다. */
  downloadPath: string
  /** 서버 변환 PDF 경로(드라이브 파일만). 있으면 HWP·PPT·DOC 를 원래 모양으로 본다(WP-431). */
  previewPath?: string
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
  /**
   * 있으면 원본·변환 PDF·다운로드를 이 출처로 받는다(WP-1227 공유 링크 미리보기 — 공개 경로 + 열람 토큰 헤더).
   * 없으면 기존대로 앱 인증 클라이언트(driveApi)로 받는다 — 드라이브·메일·채팅 뷰어 동작은 그대로다.
   */
  source?: ViewerItemSource
}

/**
 * 항목별 받기 출처(WP-1227). 앱 로그인 세션이 아닌 다른 인증(공유 열람 토큰)으로 받아야 하는 항목이 쓴다.
 * 결과 모양은 기본 출처(driveApi.fetchBlobByPath·fetchConvertedPreview)와 같아야 한다 — 뷰어 본문이 출처를 몰라도 같게 그린다.
 */
export interface ViewerItemSource {
  /** 원본 blob — path 는 항목 contentPath. */
  fetchBlob: (path: string, opts: { onProgress?: BlobProgress; signal?: AbortSignal }) => Promise<Blob>
  /** 변환 PDF 상태 — path 는 previewPath(첫 요청은 `?start=true` 가 붙는다). 200/202/422/404 는 상태로, 그 밖은 throw. */
  fetchConverted: (path: string, signal?: AbortSignal) => Promise<ConvertedPreviewResponse>
  /** 원본 다운로드(브라우저 저장까지). 실패는 throw — 뷰어가 토스트로 알린다. */
  download: (item: ViewerItem) => Promise<void>
}

/** ⋯ "드라이브에서 열기" 대상 — 폴더 id 를 모르므로 공간·파일 id·이름(폴더 검색용)만 든다. */
export interface DriveOpenTarget {
  spaceId: number
  driveFileId: number
  name: string
}
