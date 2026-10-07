// 화면별 데이터 → ViewerItem 어댑터와 묶음 해석(WP-277). 순수 함수만 둔다(vitest 대상).
import type { IssueAttachment } from '../../types/attachment'
import type { DriveFile, DriveLink, VirtualAttachment } from '../../types/drive'
import type { ViewerItem } from './types'

/** 드라이브 화면의 파일 — 요약·참조된 곳을 쓰고, 이미 드라이브라 가져오기는 없다. */
export function driveFileItem(f: DriveFile): ViewerItem {
  return {
    key: `drive:${f.id}`,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    contentPath: `/drive/files/${f.id}/content`,
    downloadPath: `/drive/files/${f.id}/download`,
    summaryDriveFileId: f.id,
    backlinksDriveFileId: f.id,
  }
}

/** 첨부 모아보기의 가상 첨부 — 서버가 준 downloadUrl 로 받고, 원본(이슈·메시지)으로 이동할 수 있다. */
export function virtualAttachmentItem(a: VirtualAttachment): ViewerItem {
  return {
    key: `file:${a.fileId}`,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    contentPath: a.downloadUrl,
    downloadPath: a.downloadUrl,
    importFileId: a.fileId,
    sourceLink: a.deepLink,
  }
}

/** 이슈 업로드 첨부 — 멤버 권한 콘텐츠 경로(api/issueAttachments 의 attachmentContentPath 와 같은 규칙). */
export function issueAttachmentItem(projectKey: string, number: number, a: IssueAttachment): ViewerItem {
  const path = `/projects/${projectKey}/issues/${number}/attachments/${a.fileId}/content`
  return {
    key: `file:${a.fileId}`,
    name: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    contentPath: path,
    downloadPath: path,
    importFileId: a.fileId,
  }
}

/**
 * 이슈에 링크된 드라이브 파일 — 링크 전용 콘텐츠 경로(열람자가 그 드라이브 공간 권한이 없어도 이슈 권한으로 받음).
 * 요약은 드라이브 권한 API 라 403 일 수 있다 → 뷰어가 403 이면 ✨ 를 숨긴다.
 */
export function issueDriveLinkItem(projectKey: string, number: number, l: DriveLink): ViewerItem {
  const path = `/projects/${projectKey}/issues/${number}/drive-links/${l.driveFileId}/content`
  return {
    key: `drive:${l.driveFileId}`,
    name: l.name,
    mimeType: l.mimeType,
    sizeBytes: l.sizeBytes,
    contentPath: path,
    downloadPath: path,
    summaryDriveFileId: l.driveFileId,
    driveOpenPath: `/drive/spaces/${l.spaceId}?preview=${l.driveFileId}`,
    unavailable: l.availability !== 'ACTIVE',
  }
}

/** 이슈 본문 이미지 — 이미 받은 blob 이 있으면 타입·크기를 그대로 쓴다. */
export function issueBodyImageItem({ src, fileId, alt, blob }: { src: string; fileId: number; alt: string; blob: Blob | null }): ViewerItem {
  return {
    key: `file:${fileId}`,
    name: alt || 'image',
    mimeType: blob?.type || 'image/png',
    sizeBytes: blob?.size ?? null,
    contentPath: src,
    downloadPath: src,
  }
}

/**
 * URL 의 현재 키 → 열 묶음과 위치.
 * 목록에 있으면 목록 전체가 묶음, 목록에서 빠졌으면(필터 변경·딥링크·실시간 삭제) 클릭 스냅숏 1건 묶음.
 * 왜: 열린 뷰어가 목록 재조회로 다른 파일로 바뀌거나 사라지지 않게 한다(드라이브 previewSnap 패턴 일반화).
 */
export function resolveBundle(
  items: ViewerItem[],
  currentKey: string | null,
  snapshot: ViewerItem | null,
): { items: ViewerItem[]; index: number } | null {
  if (currentKey == null) return null
  const index = items.findIndex((i) => i.key === currentKey)
  if (index >= 0) return { items, index }
  if (snapshot?.key === currentKey) return { items: [snapshot], index: 0 }
  return null
}
