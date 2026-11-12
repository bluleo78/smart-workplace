// 드라이브 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import { downloadBlob } from '../lib/download'
import type {
  BulkMoveBody,
  BulkSelection,
  DriveFile,
  DriveFileVersion,
  DriveFolder,
  DriveFolderPathSegment,
  DriveItemList,
  DriveMember,
  DriveMemberGroup,
  DrivePlaybackUrl,
  DriveQuota,
  DriveRole,
  DriveSearchResult,
  DriveSpace,
  DriveTrashList,
  DriveUploadSession,
  DriveUploadSessionStartBody,
  SharedWithMeItem,
  ShareLink,
} from '../types/drive'
import { fetchBlobByPath, stripApiPrefix } from './blobContent'
import { client } from './client'

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
export async function readJsonBody(data: Blob): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = JSON.parse(await data.text())
    return body != null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// 공유 링크 타입은 types/drive 에 정의(DTO 단일 출처). 기존 import 처를 위해 재노출.
export type { ShareLink } from '../types/drive'

/** 공유 링크 대상 — 파일 또는 폴더(WP-1538). name 은 모달 제목 아래 표시용. */
export interface ShareTargetRef {
  kind: 'file' | 'folder'
  id: number
  name: string
}

/** 대상 종류별 공유 링크 경로 — 파일·폴더가 같은 요청/응답 모양을 쓴다(WP-1538). */
function shareLinksPath(target: Pick<ShareTargetRef, 'kind' | 'id'>): string {
  return `/drive/${target.kind === 'folder' ? 'folders' : 'files'}/${target.id}/share-links`
}

// 공유 링크 생성 — audience, 비밀번호(선택), 만료일(선택). 응답은 목록 항목과 같은 모양(토큰·만든 사람 이름 포함, WP-1528).
export async function createShareLink(
  target: Pick<ShareTargetRef, 'kind' | 'id'>,
  body: { audience: 'EXTERNAL' | 'INTERNAL'; password?: string; expiresAt?: string },
): Promise<ShareLink> {
  const { data } = await client.post<ShareLink>(shareLinksPath(target), body);
  return data;
}

// 파일·폴더에 연결된 공유 링크 목록 조회.
export async function listShareLinks(target: Pick<ShareTargetRef, 'kind' | 'id'>): Promise<ShareLink[]> {
  const { data } = await client.get<ShareLink[]>(shareLinksPath(target));
  return data;
}

// 공유 링크 폐기 — 이후 해당 토큰으로 다운로드 불가.
export async function revokeShareLink(linkId: number): Promise<void> {
  await client.delete<void>(`/drive/share-links/${linkId}`);
}

// 공유받은 항목(WP-1539) — 내가 연 사내 공유 링크 목록(마지막으로 연 순).
export async function listSharedWithMe(): Promise<SharedWithMeItem[]> {
  const { data } = await client.get<SharedWithMeItem[]>('/drive/shared-with-me');
  return data;
}

// 공유받은 항목에서 빼기(WP-1539) — 내 목록에서만 숨긴다. 링크 권한은 그대로이고 같은 링크를 다시 열면 돌아온다.
export async function hideSharedWithMe(shareLinkId: number): Promise<void> {
  await client.delete<void>(`/drive/shared-with-me/${shareLinkId}`);
}

// 공유 링크 랜딩 페이지 URL — 외부에 배포하는 URL. /s/:token 라우트.
// 비밀번호 입력 UI가 여기에 있으므로 이 URL 을 공유해야 한다.
export function shareLandingUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
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

  // 멤버 추가 — TEAM 공간 OWNER 전용. 이미 멤버면 역할을 덮어쓴다(서버 업서트).
  addMember: (spaceId: number, userId: number, role: DriveRole) =>
    client.post<void>(`/drive/spaces/${spaceId}/members`, { userId, role }),

  // 멤버 역할 변경 — OWNER 전용. 마지막 OWNER 강등은 서버가 거부한다.
  changeMemberRole: (spaceId: number, userId: number, role: DriveRole) =>
    client.patch<void>(`/drive/spaces/${spaceId}/members/${userId}`, { role }),

  // 멤버 제거 — OWNER 전용. 마지막 OWNER 제거는 서버가 거부한다.
  removeMember: (spaceId: number, userId: number) =>
    client.delete<void>(`/drive/spaces/${spaceId}/members/${userId}`),

  // 멤버인 조직도 부서(WP-1056) — TEAM 공간만. 부서 자체를 역할과 함께 멤버로 둔다. 추가·변경·제거는 OWNER 만, 역할은 EDITOR·VIEWER 만.
  listMemberGroups: (spaceId: number) => client.get<DriveMemberGroup[]>(`/drive/spaces/${spaceId}/member-groups`),
  addMemberGroup: (spaceId: number, groupId: number, role: DriveMemberGroup['role']) =>
    client.post<DriveMemberGroup>(`/drive/spaces/${spaceId}/member-groups`, { groupId, role }),
  changeMemberGroupRole: (spaceId: number, groupId: number, role: DriveMemberGroup['role']) =>
    client.patch<DriveMemberGroup>(`/drive/spaces/${spaceId}/member-groups/${groupId}`, { role }),
  removeMemberGroup: (spaceId: number, groupId: number) =>
    client.delete<void>(`/drive/spaces/${spaceId}/member-groups/${groupId}`),

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

  // ── 나눠 올리기 세션(WP-1520) ── 20MB 초과 파일을 조각으로 이어 올린다. 흐름은 lib/drive/chunkedUpload.ts 가 맡는다.

  // 세션 시작 — 바이트를 받기 전에 권한·폴더·형식별 한도·회사 용량을 서버가 먼저 검사한다.
  startUploadSession: (spaceId: number, body: DriveUploadSessionStartBody, signal?: AbortSignal) =>
    client.post<DriveUploadSession>(`/drive/spaces/${spaceId}/upload-sessions`, body, { signal }),

  // 세션 상태 — 이어 올릴 때 서버가 실제로 받은 바이트(receivedBytes)를 확인한다. 만료·없음·남의 것은 404.
  getUploadSession: (sessionId: string, signal?: AbortSignal) =>
    client.get<DriveUploadSession>(`/drive/upload-sessions/${sessionId}`, { signal }),

  // 조각 하나 보내기 — 원시 바이트(application/octet-stream)를 offset 위치에 잇는다. offset 이 서버 값과 다르면 409(본문 receivedBytes).
  // onProgress 는 이 조각에서 보낸 바이트 수 — 전체 진행률 계산은 호출부가 한다.
  putUploadChunk: (
    sessionId: string,
    offset: number,
    chunk: Blob,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ) =>
    client.put<{ receivedBytes: number }>(`/drive/upload-sessions/${sessionId}/chunks`, chunk, {
      params: { offset },
      headers: { 'Content-Type': 'application/octet-stream' },
      signal,
      onUploadProgress: onProgress ? (e) => onProgress(e.loaded) : undefined,
    }),

  // 세션 완료 — 다 받은 바이트를 드라이브 파일로 만든다(동명이면 새 버전). 덜 받았으면 409.
  completeUploadSession: (sessionId: string, signal?: AbortSignal) =>
    client.post<DriveFile>(`/drive/upload-sessions/${sessionId}/complete`, undefined, { signal }),

  // 세션 취소 — 서버의 임시 파일·세션을 지운다.
  cancelUploadSession: (sessionId: string) => client.delete<void>(`/drive/upload-sessions/${sessionId}`),

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
   * 영상·오디오 서명 재생 주소 발급(WP-1532). access 토큰이 헤더로만 실려 `<video src>` 로는 인증할 수 없어,
   * 볼 권한을 확인받은 뒤 받은 주소를 미디어 요소에 바로 넣어 Range 로 재생한다(통째로 받지 않음). 발급 때 서버가 열람 감사를 한 번 남긴다.
   */
  issuePlaybackUrl: async (driveFileId: number): Promise<DrivePlaybackUrl> => {
    const { data } = await client.post<DrivePlaybackUrl>(`/drive/files/${driveFileId}/playback-url`)
    return data
  },

  /**
   * 서버 변환 PDF 미리보기(WP-431). path 는 ViewerItem.previewPath(필요하면 `?start=true` 를 붙여서).
   * 드라이브·메일(WP-432)·첨부·드라이브 링크·메인 AI 첨부(WP-1457) 공용 — 엔드포인트가 모두 같은 200/202/422/404 계약이라 경로만 다르다.
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
}
