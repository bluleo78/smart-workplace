// #80: 드라이브 교차링크 API 모듈.
// 이슈↔드라이브 링크, 백링크, 가상 첨부, 임포트 엔드포인트를 래핑한다.

import { downloadBlob } from '../lib/download'
import type { Backlink, DriveFile, DriveLink, VirtualAttachmentPage } from '../types/drive'
import { client } from './client'

// ─── 이슈 드라이브 링크 ────────────────────────────────────────────────────────

/** 이슈에 연결된 드라이브 파일 목록 조회. */
export async function listIssueDriveLinks(key: string, number: number): Promise<DriveLink[]> {
  const { data } = await client.get<DriveLink[]>(
    `/projects/${key}/issues/${number}/drive-links`,
  )
  return data
}

/** 이슈에 드라이브 파일 링크 추가. */
export async function addIssueDriveLink(
  key: string,
  number: number,
  driveFileId: number,
): Promise<void> {
  await client.post(`/projects/${key}/issues/${number}/drive-links`, { driveFileId })
}

/** 이슈 드라이브 링크 제거. */
export async function removeIssueDriveLink(
  key: string,
  number: number,
  driveFileId: number,
): Promise<void> {
  await client.delete(`/projects/${key}/issues/${number}/drive-links/${driveFileId}`)
}

/** 드라이브 링크 파일 다운로드 — blob 으로 받아 a[download] 트리거. */
export async function downloadIssueDriveLink(
  key: string,
  number: number,
  driveFileId: number,
  fileName: string,
): Promise<void> {
  const { data } = await client.get<Blob>(
    `/projects/${key}/issues/${number}/drive-links/${driveFileId}/content`,
    { responseType: 'blob' },
  )
  downloadBlob(fileName, data)
}

// ─── 메시지 드라이브 링크 ──────────────────────────────────────────────────────

/** 메시지 드라이브 링크 파일 다운로드 — blob 으로 받아 a[download] 트리거. */
export async function downloadMessageDriveLink(
  channelId: number,
  messageId: number,
  driveFileId: number,
  fileName: string,
): Promise<void> {
  const { data } = await client.get<Blob>(
    `/messaging/channels/${channelId}/messages/${messageId}/drive-links/${driveFileId}/content`,
    { responseType: 'blob' },
  )
  downloadBlob(fileName, data)
}

// ─── 백링크 ───────────────────────────────────────────────────────────────────

/** 드라이브 파일이 참조된 이슈/메시지 목록(백링크) 조회. */
export async function listFileBacklinks(driveFileId: number): Promise<Backlink[]> {
  const { data } = await client.get<Backlink[]>(`/drive/files/${driveFileId}/backlinks`)
  return data
}

// ─── 가상 첨부 ────────────────────────────────────────────────────────────────

/** 이슈/메시지 업로드 파일의 가상 첨부 뷰 — cursor 페이징. */
export async function listDriveAttachments(params: {
  source?: 'ALL' | 'ISSUE' | 'MESSAGE'
  q?: string
  cursor?: string
  limit?: number
}): Promise<VirtualAttachmentPage> {
  const { data } = await client.get<VirtualAttachmentPage>('/drive/attachments', { params })
  return data
}

// ─── 임포트 ───────────────────────────────────────────────────────────────────

/**
 * 첨부 파일을 드라이브로 임포트.
 * folderId 가 null 이면 공간 루트에, 있으면 해당 폴더에 임포트한다.
 */
export async function importAttachment(
  spaceId: number,
  folderId: number | null,
  fileId: number,
): Promise<DriveFile> {
  const path =
    folderId == null
      ? `/drive/spaces/${spaceId}/import-attachment`
      : `/drive/spaces/${spaceId}/folders/${folderId}/import-attachment`
  const { data } = await client.post<DriveFile>(path, { fileId })
  return data
}

