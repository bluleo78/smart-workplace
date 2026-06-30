// 드라이브 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import { downloadBlob } from '../lib/download'
import type {
  BulkMoveBody,
  BulkSelection,
  CreatedShareLink,
  DriveFile,
  DriveFileVersion,
  DriveFolder,
  DriveFolderPathSegment,
  DriveItemList,
  DriveMember,
  DriveQuota,
  DriveSearchResult,
  DriveSpace,
  DriveTrashList,
  ShareLink,
} from '../types/drive'
import { client, getAccessToken } from './client'

// 공유 링크 타입은 types/drive 에 정의(DTO 단일 출처). 기존 import 처를 위해 재노출.
export type { CreatedShareLink, ShareLink } from '../types/drive'

// 공유 링크 생성 — audience, 비밀번호(선택), 만료일(선택).
export async function createShareLink(
  fileId: number,
  body: { audience: 'EXTERNAL' | 'INTERNAL'; password?: string; expiresAt?: string },
): Promise<CreatedShareLink> {
  const { data } = await client.post<CreatedShareLink>(`/drive/files/${fileId}/share-links`, body);
  return data;
}

// 파일에 연결된 공유 링크 목록 조회.
export async function listShareLinks(fileId: number): Promise<ShareLink[]> {
  const { data } = await client.get<ShareLink[]>(`/drive/files/${fileId}/share-links`);
  return data;
}

// 공유 링크 폐기 — 이후 해당 토큰으로 다운로드 불가.
export async function revokeShareLink(linkId: number): Promise<void> {
  await client.delete<void>(`/drive/share-links/${linkId}`);
}

// 공유 링크 랜딩 페이지 URL — 외부에 배포하는 URL. /s/:token 라우트.
// 비밀번호 입력 UI가 여기에 있으므로 이 URL 을 공유해야 한다.
export function shareLandingUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

// 공개 다운로드 API 경로 내부용 — 실제 파일 다운로드 fetch 시 사용.
// (shareDownloadUrl 은 이전 호환성을 위해 유지하되 공유 목적으로는 shareLandingUrl 사용)
export function shareDownloadApiUrl(token: string): string {
  return `/api/v1/public/drive/share/${encodeURIComponent(token)}/download`
}

/** 공유 다운로드 에러 — status 코드를 담아 호출처에서 메시지 매핑. */
export class ShareDownloadError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Share download failed: ${status}`)
    this.status = status
  }
}

/**
 * 공유 토큰으로 파일 다운로드.
 *
 * - 로그인 중이면 Bearer 헤더를 함께 전송 (INTERNAL 링크 지원).
 * - 비밀번호가 있으면 X-Share-Password 헤더로 전달 — URL 쿼리 문자열 금지.
 * - 성공 시 Blob 을 받아 브라우저 다운로드(downloadBlob 재사용).
 * - 비성공 응답은 ShareDownloadError(status) 를 throw.
 */
export async function downloadSharedFile(token: string, password?: string): Promise<void> {
  const headers: Record<string, string> = {}
  const tok = getAccessToken()
  if (tok) {
    headers['Authorization'] = `Bearer ${tok}`
  }
  if (password) {
    headers['X-Share-Password'] = password
  }

  const res = await fetch(shareDownloadApiUrl(token), { headers })

  if (!res.ok) {
    throw new ShareDownloadError(res.status)
  }

  const blob = await res.blob()

  // Content-Disposition 파싱 — RFC-5987(filename*=UTF-8'') 우선, 없으면 filename="…" 폴백.
  const disposition = res.headers.get('Content-Disposition') ?? ''
  let filename = 'download'
  const rfc5987 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (rfc5987) {
    filename = decodeURIComponent(rfc5987[1].trim())
  } else {
    const plain = disposition.match(/filename="([^"]+)"/i)
    if (plain) filename = plain[1]
  }

  downloadBlob(filename, blob)
}

// axios client baseURL 이 '/api/v1' 이므로, '/api/v1/...' 절대 경로는 접두어를 제거해 중복 호출을 막는다.
function stripApiPrefix(path: string): string {
  return path.replace(/^\/api\/v1/, '')
}

export const driveApi = {
  listSpaces: () => client.get<DriveSpace[]>('/drive/spaces'),

  createSpace: (name: string) => client.post<DriveSpace>('/drive/spaces', { name }),

  getSpace: (spaceId: number) => client.get<DriveSpace>(`/drive/spaces/${spaceId}`),

  // TEAM 공간 이름 변경 — OWNER 전용.
  renameSpace: (spaceId: number, name: string) =>
    client.patch<DriveSpace>(`/drive/spaces/${spaceId}`, { name }),

  // TEAM 공간 즉시 하드삭제 — OWNER 전용. 내용물 통째 삭제.
  deleteSpace: (spaceId: number) => client.delete<void>(`/drive/spaces/${spaceId}`),

  listMembers: (spaceId: number) =>
    client.get<DriveMember[]>(`/drive/spaces/${spaceId}/members`),

  listItems: (spaceId: number, parentId: number | null) =>
    client.get<DriveItemList>(`/drive/spaces/${spaceId}/items`, {
      params: parentId == null ? {} : { parentId },
    }),

  createFolder: (spaceId: number, parentId: number | null, name: string) =>
    client.post<DriveFolder>(`/drive/spaces/${spaceId}/folders`, { parentId, name }),

  renameFolder: (folderId: number, name: string) =>
    client.patch<DriveFolder>(`/drive/folders/${folderId}`, { name }),

  // 폴더 조상 경로(루트→대상) — breadcrumb.
  getFolderPath: (folderId: number) =>
    client.get<DriveFolderPathSegment[]>(`/drive/folders/${folderId}/path`),

  deleteFolder: (folderId: number) => client.delete<void>(`/drive/folders/${folderId}`),

  uploadFile: (spaceId: number, folderId: number | null, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId != null) fd.append('folderId', String(folderId))
    return client.post<DriveFile>(`/drive/spaces/${spaceId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  deleteFile: (driveFileId: number) => client.delete<void>(`/drive/files/${driveFileId}`),

  moveFile: (driveFileId: number, targetFolderId: number | null) =>
    client.patch<void>(`/drive/files/${driveFileId}/move`, { targetFolderId }),

  copyFile: (driveFileId: number, targetFolderId: number | null) =>
    client.post<DriveFile>(`/drive/files/${driveFileId}/copy`, { targetFolderId }),

  moveFolder: (folderId: number, targetParentId: number | null) =>
    client.patch<void>(`/drive/folders/${folderId}/move`, { targetParentId }),

  copyFolder: (folderId: number, targetParentId: number | null) =>
    client.post<DriveFolder>(`/drive/folders/${folderId}/copy`, { targetParentId }),

  // #526: 파일 콘텐츠 요약(파이프라인 저장본) 조회.
  getFileSummary: (driveFileId: number) =>
    client.get<{ summary: string | null; status: string | null }>(
      `/drive/files/${driveFileId}/summary`,
    ),

  // #82: 벌크 이동 — 선택된 파일·폴더를 targetFolderId(null=루트) 로 일괄 이동.
  bulkMove: (spaceId: number, body: BulkMoveBody) =>
    client.patch<void>(`/drive/spaces/${spaceId}/items/move`, body),

  // #82: 벌크 삭제 — 선택된 파일·폴더를 일괄 휴지통 이동.
  bulkDelete: (spaceId: number, body: BulkSelection) =>
    client.delete<void>(`/drive/spaces/${spaceId}/items`, { data: body }),

  // #82: 폴더 resolve — 경로(parentId + name) 에 해당하는 폴더를 조회하거나 생성.
  resolveFolder: (spaceId: number, parentId: number | null, name: string) =>
    client.post<DriveFolder>(`/drive/spaces/${spaceId}/folders/resolve`, { parentId, name }),

  // #82: 벌크 ZIP 다운로드 — 선택 항목을 ZIP 으로 묶어 브라우저 다운로드 트리거.
  downloadZip: async (spaceId: number, body: BulkSelection) => {
    const { data } = await client.post<Blob>(`/drive/spaces/${spaceId}/download-zip`, body, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'drive-export.zip'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // 휴지통
  listTrash: (spaceId: number) =>
    client.get<DriveTrashList>(`/drive/spaces/${spaceId}/trash`),

  restoreFile: (driveFileId: number) =>
    client.post<void>(`/drive/files/${driveFileId}/restore`),

  restoreFolder: (folderId: number) =>
    client.post<void>(`/drive/folders/${folderId}/restore`),

  purgeFile: (driveFileId: number) =>
    client.delete<void>(`/drive/files/${driveFileId}/purge`),

  purgeFolder: (folderId: number) =>
    client.delete<void>(`/drive/folders/${folderId}/purge`),

  emptyTrash: (spaceId: number) =>
    client.delete<void>(`/drive/spaces/${spaceId}/trash`),

  // blob 다운로드 → a[download] 트리거
  downloadFile: async (driveFileId: number, fileName: string) => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/download`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // 첨부 등 임의 콘텐츠 경로(/api/v1/... 절대경로 가능)에서 blob object URL. 호출처가 revoke.
  fetchBlobUrlByPath: async (path: string): Promise<string> => {
    const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
    return URL.createObjectURL(data)
  },

  // 임의 콘텐츠 경로의 텍스트 본문.
  fetchTextByPath: async (path: string): Promise<string> => {
    const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
    return await data.text()
  },

  // 임의 콘텐츠 경로 다운로드 → a[download] 트리거.
  downloadByPath: async (path: string, fileName: string) => {
    const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // 버전 이력(#79)
  listVersions: (driveFileId: number) =>
    client.get<DriveFileVersion[]>(`/drive/files/${driveFileId}/versions`),

  rollbackVersion: (driveFileId: number, versionNo: number) =>
    client.post<DriveFile>(`/drive/files/${driveFileId}/versions/${versionNo}/rollback`),

  downloadVersion: async (driveFileId: number, versionNo: number, name: string) => {
    const { data } = await client.get<Blob>(
      `/drive/files/${driveFileId}/versions/${versionNo}/download`,
      { responseType: 'blob' },
    )
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // 현재 테넌트 드라이브 사용량/한도.
  getQuota: () => client.get<DriveQuota>('/drive/quota'),

  // 공간 전체 이름 검색
  search: (spaceId: number, q: string) =>
    client.get<DriveSearchResult>(`/drive/spaces/${spaceId}/search`, { params: { q } }),

  // 썸네일 blob → object URL. 메모리 Bearer 라 <img> 가 헤더를 못 실으므로 axios 로 받아 objectURL 생성.
  // 404(썸네일 없음)면 null 반환. 호출처가 revokeObjectURL 책임.
  fetchThumbnailUrl: async (driveFileId: number): Promise<string | null> => {
    try {
      const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/thumbnail`, {
        responseType: 'blob',
      })
      return URL.createObjectURL(data)
    } catch {
      return null
    }
  },

  // 미리보기 콘텐츠 원본 Blob. 호출처가 objectURL/text()/arrayBuffer() 로 변환.
  fetchContentBlob: async (driveFileId: number): Promise<Blob> => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/content`, {
      responseType: 'blob',
    })
    return data
  },

  // 미리보기 콘텐츠(이미지/PDF) blob → object URL. 호출처가 revoke.
  fetchContentUrl: async (driveFileId: number): Promise<string> => {
    const blob = await driveApi.fetchContentBlob(driveFileId)
    return URL.createObjectURL(blob)
  },

  // 텍스트 미리보기 — blob 을 문자열로.
  fetchTextContent: async (driveFileId: number): Promise<string> => {
    const blob = await driveApi.fetchContentBlob(driveFileId)
    return await blob.text()
  },
}
