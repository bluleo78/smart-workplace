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
import { fetchBlobByPath, stripApiPrefix } from './blobContent'
import { client, getAccessToken } from './client'

/**
 * 변환 미리보기 응답(WP-431) — 200 변환 PDF / 202 변환 중 / 422 실패(code·transient) / 404 변환 대상 아님·변환 꺼짐.
 * 404 는 본문이 `{"status":"NOT_APPLICABLE"}` 일 때만 "대상 아님"이다. 그 밖의 404(휴지통·권한 없음·원본 유실 — 예외 봉투)는
 * 'error' 로 돌려 뷰어의 오류 화면을 보인다 — 미지원 안내로 보이면 지워진·볼 수 없는 파일을 "형식이 안 맞다"고 오도한다.
 * 상태별로 갈라 두어 호출부(useConvertedPreview)가 axios 응답 모양을 몰라도 되게 한다.
 */
export type ConvertedPreviewResponse =
  | { status: 200; blob: Blob }
  | { status: 202 }
  | { status: 422; code: string; transient: boolean }
  | { status: 404 }
  | { status: 'error' }

/** 변환 미리보기가 정상 흐름으로 쓰는 상태 — 이 밖(401·5xx 등)은 axios 가 throw 한다. */
const CONVERTED_PREVIEW_STATUSES = [200, 202, 404, 422]

/**
 * 202 가 아닌 정상 흐름 응답(404·422) 본문(blob)을 JSON 객체로 읽는다. responseType 이 blob 이라 오류 본문도 blob 으로 온다.
 * 못 읽으면(프록시 HTML 등) null — 호출부가 안전한 기본값(404 는 다른 404, 422 는 일시 실패)으로 본다.
 */
async function readJsonBody(data: Blob): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = JSON.parse(await data.text())
    return body != null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

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
 * - 비밀번호가 있으면 UTF-8 퍼센트 인코딩해 X-Share-Password-Encoded 헤더로 전달 — URL 쿼리 문자열 금지.
 *   헤더 값에는 비ASCII(한글 등)를 넣을 수 없어 원문을 그대로 넣으면 fetch 자체가 실패한다(WP-528).
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
    headers['X-Share-Password-Encoded'] = encodeURIComponent(password)
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

  // #658: signal(AbortSignal) 옵션 — 업로드 중 취소 버튼에서 controller.abort() 로 요청 중단.
  // WP-643: onProgress — 보낸 바이트 비율(0~100 정수)을 알려 업로드 버튼에 진행률을 보인다(전체 크기를 알 때만).
  uploadFile: (
    spaceId: number,
    folderId: number | null,
    file: File,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId != null) fd.append('folderId', String(folderId))
    return client.post<DriveFile>(`/drive/spaces/${spaceId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
      onUploadProgress: onProgress
        ? (e) => {
            if (e.total) onProgress(Math.min(100, Math.floor((e.loaded * 100) / e.total)))
          }
        : undefined,
    })
  },

  deleteFile: (driveFileId: number) => client.delete<void>(`/drive/files/${driveFileId}`),

  // 파일 이름 변경(WP-335) — 같은 폴더 동명 활성 파일이 있으면 409.
  renameFile: (driveFileId: number, name: string) =>
    client.patch<DriveFile>(`/drive/files/${driveFileId}`, { name }),

  moveFile: (driveFileId: number, targetFolderId: number | null) =>
    client.patch<void>(`/drive/files/${driveFileId}/move`, { targetFolderId }),

  copyFile: (driveFileId: number, targetFolderId: number | null) =>
    client.post<DriveFile>(`/drive/files/${driveFileId}/copy`, { targetFolderId }),

  moveFolder: (folderId: number, targetParentId: number | null) =>
    client.patch<void>(`/drive/folders/${folderId}/move`, { targetParentId }),

  copyFolder: (folderId: number, targetParentId: number | null) =>
    client.post<DriveFolder>(`/drive/folders/${folderId}/copy`, { targetParentId }),

  // #526: 파일 콘텐츠 요약(파이프라인 저장본) 조회.
  // #735: reason — SKIPPED/FAILED 사유 사용자 문구(서버가 raw error 를 매핑해 내려줌).
  getFileSummary: (driveFileId: number) =>
    client.get<{ summary: string | null; status: string | null; reason: string | null }>(
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

  // blob 다운로드 → a[download] 트리거. /download 경로라 서버 감사 로그가 남고, URL 해제 지연은 downloadBlob 이 맡는다(iOS 저장 실패 방지, WP-278).
  downloadFile: async (driveFileId: number, fileName: string) => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/download`, {
      responseType: 'blob',
    })
    downloadBlob(fileName, data)
  },

  // 임의 콘텐츠 경로의 원본 Blob. 구현은 api/blobContent.ts 공용 모듈(wiki 등 타 도메인과 공유).
  fetchBlobByPath,

  /**
   * 서버 변환 PDF 미리보기(WP-431). path 는 ViewerItem.previewPath(필요하면 `?start=true` 를 붙여서).
   * 드라이브·메일 공용 경로다(WP-432) — 두 엔드포인트가 같은 200/202/422/404 계약이라 경로만 다르다.
   * 202·404·422 도 정상 응답으로 받아 상태로 돌려주고(404 는 NOT_APPLICABLE 본문만 404, 나머지는 'error'),
   * 그 밖의 상태·네트워크 오류·abort 는 throw 한다.
   */
  fetchConvertedPreview: async (path: string, signal?: AbortSignal): Promise<ConvertedPreviewResponse> => {
    const { status, data } = await client.get<Blob>(stripApiPrefix(path), {
      responseType: 'blob',
      signal,
      validateStatus: (s) => CONVERTED_PREVIEW_STATUSES.includes(s),
    })
    if (status === 200) return { status: 200, blob: data }
    if (status === 202) return { status: 202 }
    const body = await readJsonBody(data)
    // 404 는 서버의 "변환 대상 아님" 표시(NOT_APPLICABLE)일 때만 — 그 밖의 404 는 오류 화면.
    if (status === 404) return body?.status === 'NOT_APPLICABLE' ? { status: 404 } : { status: 'error' }
    // 422 실패 코드 — 못 읽으면 일시 실패로 본다(다시 시도할 길을 남긴다).
    if (typeof body?.code === 'string' && typeof body.transient === 'boolean') {
      return { status: 422, code: body.code, transient: body.transient }
    }
    return { status: 422, code: 'UNAVAILABLE', transient: true }
  },

  // 임의 콘텐츠 경로 다운로드 → a[download] 트리거. URL 해제 지연은 downloadBlob 이 맡는다(iOS 저장 실패 방지, WP-278).
  downloadByPath: async (path: string, fileName: string) => {
    const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
    downloadBlob(fileName, data)
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
    // 해제 지연은 downloadBlob 이 맡는다(iOS 저장 실패 방지, WP-278).
    downloadBlob(name, data)
  },

  // 현재 테넌트 드라이브 사용량/한도.
  getQuota: () => client.get<DriveQuota>('/drive/quota'),

  // 공간 전체 이름 검색
  search: (spaceId: number, q: string) =>
    client.get<DriveSearchResult>(`/drive/spaces/${spaceId}/search`, { params: { q } }),

  // 썸네일 blob. 메모리 Bearer 라 <img> 가 헤더를 못 실으므로 axios 로 받아 blob 반환.
  // 404(썸네일 없음/생성 실패)면 null 반환 — React Query 캐시(#615)가 재요청을 억제하므로
  // objectURL 생성은 호출처(useDriveThumbnail)가 캐시 라이프사이클에 맞춰 책임진다.
  fetchThumbnailBlob: async (driveFileId: number): Promise<Blob | null> => {
    try {
      const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/thumbnail`, {
        responseType: 'blob',
      })
      return data
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


  // AI Overview 생성 시작(#593 편입) — correlationId 즉시 반환, 실제 델타는 /events 로 도착.
  startOverview: (q: string, spaceId?: number) =>
    client.get<{ correlationId: string }>('/drive/search-overview', { params: { q, spaceId } }),

  // 진행 중인 Overview 생성 취소.
  cancelOverview: (correlationId: string) =>
    client.delete<void>(`/drive/search-overview/${correlationId}`),
}
