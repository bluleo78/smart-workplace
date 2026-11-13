// WP-1227 드라이브 공유 링크(/s/:token) 공개 API — 정보·잠금 풀기·원본·변환 PDF·다운로드.
// axios client 를 쓰지 않는다: client 는 401 이면 토큰 갱신을 시도하고 실패하면 /login 으로 보내는데,
// 이 화면은 로그인 없이 그려져야 하고 401 은 「열람 토큰 만료 → 비밀번호 다시」 뜻이다.
// 로그인 중이면 Bearer 를 함께 보낸다(사내 링크 판정·드라이브에서 열기 대상 계산에 쓰인다).
// 인터셉터를 안 타므로 만료된 Bearer 의 갱신·재시도는 shareFetch 한 곳에서 한다(WP-1540).

import { downloadBlob } from '../lib/download'
import type { BlobProgress } from './blobContent'
import { getAccessToken, refreshAccessToken } from './client'
import { type ConvertedPreviewResponse, readJsonBody } from './drive'

/** 공개 공유 요청 실패 — status 로 화면이 안내를 고른다(0 = 네트워크 등 서버 응답 없음). */
export class SharePublicError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`drive public share ${status}`)
    this.status = status
  }
}

/** 드라이브에서 열기 대상 — 로그인 + 같은 워크스페이스 + 공간 VIEWER 이상일 때만 서버가 준다. */
export interface ShareDriveOpen {
  spaceId: number
  folderId: number | null
  driveFileId: number
}

/** 잠금 대상 종류(WP-1538) — 잠금 응답은 이름·수를 숨기고 종류만 싣는다(잠금 카드 「…파일」/「…폴더」). 예전 응답엔 없을 수 있다. */
export type ShareTarget = 'FILE' | 'FOLDER'

/** 파일 링크 정보(잠금 아님). kind 는 WP-1538 부터 'FILE' 로 오고, 없으면 파일로 본다(이전 응답·목 호환). */
export interface ShareFileInfo {
  passwordRequired: false
  loginRequired: false
  kind?: 'FILE'
  name: string
  mimeType: string
  sizeBytes: number
  sharedBy: string | null
  /** 비로그인 — 「로그인하고 드라이브에서 열기」를 보인다. */
  loginAvailable: boolean
  driveOpen: ShareDriveOpen | null
}

/** 폴더 링크 정보(WP-1538) — 머리에 쓰는 이름·바로 아래 개수. driveOpen 은 공간 구성원일 때만(폴더 id). */
export interface ShareFolderInfo {
  passwordRequired: false
  loginRequired: false
  kind: 'FOLDER'
  name: string
  folderCount: number
  fileCount: number
  sharedBy: string | null
  loginAvailable: boolean
  driveOpen: { spaceId: number; folderId: number } | null
}

/** GET 정보 응답 — 두 불리언은 늘 온다. 잠금(로그인·비밀번호)이면 대상 필드가 없고 종류(target)만 온다. */
export type ShareInfo =
  | { loginRequired: true; passwordRequired: boolean; target?: ShareTarget }
  | { passwordRequired: true; loginRequired: false; target?: ShareTarget }
  | ShareFileInfo
  | ShareFolderInfo

/** 폴더 링크 정보인가 — kind 가 'FOLDER' 일 때만. 그 밖(kind 없음 포함)은 파일로 본다(WP-1538). */
export function isShareFolderInfo(info: ShareInfo): info is ShareFolderInfo {
  return 'kind' in info && info.kind === 'FOLDER'
}

/** 폴더 링크 하위 목록(WP-1538) — path 는 공유 폴더 → 현재(포함). 폴더 먼저·이름순, 상한을 넘으면 truncated. */
export interface ShareFolderListing {
  folderId: number
  path: { id: number; name: string }[]
  folders: { id: number; name: string; updatedAt: string }[]
  files: { id: number; name: string; mimeType: string; sizeBytes: number; updatedAt: string }[]
  truncated: boolean
}

/** 공개 공유 API 기본 경로 — 뷰어 항목의 contentPath·previewPath 도 이 아래다. */
export function sharePublicBase(token: string): string {
  return `/api/v1/public/drive/share/${encodeURIComponent(token)}`
}

/** 폴더 링크 아래 파일 하나의 공개 경로(WP-1538) — 원본·변환 PDF·다운로드. 서버가 매 요청 「공유 폴더 자손인가」를 본다. */
export function shareFilePaths(token: string, fileId: number): { contentPath: string; previewPath: string; downloadPath: string } {
  const base = `${sharePublicBase(token)}/files/${fileId}`
  return { contentPath: `${base}/content`, previewPath: `${base}/preview`, downloadPath: `${base}/download` }
}

/** 요청 헤더 — 로그인 중이면 Bearer, 열람 토큰이 있으면 X-Share-View-Token. */
function shareHeaders(viewToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {}
  const tok = getAccessToken()
  if (tok) headers.Authorization = `Bearer ${tok}`
  if (viewToken) headers['X-Share-View-Token'] = viewToken
  return headers
}

/**
 * 공개 공유 GET 요청(정보·하위 목록·원본·변환 PDF·다운로드)의 공용 fetch — Bearer 를 보냈는데 401 이면 액세스 토큰을 한 번 갱신하고
 * 새 헤더로 한 번만 다시 보낸다(WP-1540). 공개 fetch 는 axios 인터셉터를 타지 않아, 오래 머문 화면의 만료 토큰이 사내 링크 판정을 401 로
 * 끊기 때문. Bearer 를 보내지 않았으면(비로그인) 401 은 열람 토큰 만료 뜻이라 그대로 돌려준다. 갱신이 실패하거나 다시 보낸 요청이 또
 * 401 이면 그 응답을 돌려준다(더 갱신하지 않음) — 호출부가 종전처럼 상태로 판정한다.
 * 비밀번호 잠금 풀기(unlockShare)는 쓰지 않는다 — 그쪽 401 은 「비밀번호 틀림」이라 갱신할 일이 아니다.
 */
async function shareFetch(url: string, viewToken: string | null, signal?: AbortSignal): Promise<Response> {
  const send = () => fetch(url, { headers: shareHeaders(viewToken), signal })
  const sentBearer = getAccessToken() != null
  const res = await send()
  if (res.status !== 401 || !sentBearer) return res
  if (!(await refreshAccessToken())) return res
  return send()
}

/** 정보 한 번 묻기 — 실패 상태는 SharePublicError. */
async function requestShareInfo(token: string, viewToken: string | null): Promise<ShareInfo> {
  const res = await shareFetch(sharePublicBase(token), viewToken)
  if (!res.ok) throw new SharePublicError(res.status)
  return (await res.json()) as ShareInfo
}

/**
 * 링크 정보 — 404 없음 / 410 만료·폐기 / 403 다른 워크스페이스는 SharePublicError.
 * Bearer 를 보냈는데 「로그인 필요」(loginRequired)면 액세스 토큰을 한 번 갱신하고 한 번만 다시 묻는다(WP-1540) — 사내 링크 정보는
 * 만료 토큰을 익명으로 봐 401 이 아니라 200 loginRequired 로 답하므로 shareFetch 의 401 재시도가 걸리지 않기 때문. 갱신이 실패하면
 * 첫 응답 그대로(호출부가 로그인 안내·공유 화면으로 간다), 다시 물은 응답이 또 loginRequired 여도 그 응답을 돌려준다.
 */
export async function fetchShareInfo(token: string, viewToken: string | null): Promise<ShareInfo> {
  const sentBearer = getAccessToken() != null
  const first = await requestShareInfo(token, viewToken)
  if (!sentBearer || !first.loginRequired) return first
  if (!(await refreshAccessToken())) return first
  return requestShareInfo(token, viewToken)
}

/**
 * 폴더 링크 하위 목록(WP-1538) — folderId 가 null 이면 공유 폴더. 404 밖·휴지통 폴더 / 401 열람 토큰 없음·만료 /
 * 403·410 은 정보와 같다 — 모두 SharePublicError.
 */
export async function fetchShareChildren(token: string, folderId: number | null, viewToken: string | null): Promise<ShareFolderListing> {
  const query = folderId == null ? '' : `?folder=${folderId}`
  const res = await shareFetch(`${sharePublicBase(token)}/children${query}`, viewToken)
  if (!res.ok) throw new SharePublicError(res.status)
  return (await res.json()) as ShareFolderListing
}

/** 비밀번호로 잠금 풀기 — 열람 토큰을 받는다. 401 틀림 / 429(423) 잠김은 SharePublicError. 비밀번호는 본문으로만(URL 금지). */
export async function unlockShare(token: string, password: string): Promise<{ viewToken: string; expiresAt: string }> {
  const res = await fetch(`${sharePublicBase(token)}/unlock`, {
    method: 'POST',
    headers: { ...shareHeaders(null), 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new SharePublicError(res.status)
  return (await res.json()) as { viewToken: string; expiresAt: string }
}

/**
 * 응답 본문을 Blob 으로 읽는다 — onProgress 를 주면 스트림을 조각으로 읽으며 진행을 알린다(영상·오디오 % 표시).
 * 스트림을 못 쓰는 환경이면 한 번에 읽는다.
 */
async function readBlob(res: Response, onProgress?: BlobProgress): Promise<Blob> {
  const type = res.headers.get('Content-Type') ?? ''
  if (!onProgress || !res.body) return res.blob()
  const lengthHeader = Number(res.headers.get('Content-Length'))
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : undefined
  const reader = res.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as Uint8Array<ArrayBuffer>)
    loaded += value.byteLength
    onProgress({ loaded, total })
  }
  return new Blob(chunks, { type })
}

/** 공개 경로 원본 blob — path 는 뷰어 항목 contentPath(공개 /content). 실패는 SharePublicError. */
export async function fetchShareBlob(
  path: string,
  viewToken: string | null,
  { onProgress, signal }: { onProgress?: BlobProgress; signal?: AbortSignal } = {},
): Promise<Blob> {
  const res = await shareFetch(path, viewToken, signal)
  if (!res.ok) throw new SharePublicError(res.status)
  return readBlob(res, onProgress)
}

/**
 * 공개 경로 변환 PDF 상태 — driveApi.fetchConvertedPreview 와 같은 모양(200/202/422/404, 그 밖의 404 는 'error')으로 돌려준다.
 * 같은 본문 판독(readJsonBody)을 써서 NOT_APPLICABLE·실패 코드 해석이 드라이브와 갈라지지 않게 한다. 그 밖의 상태는 throw.
 */
export async function fetchShareConverted(path: string, viewToken: string | null, signal?: AbortSignal): Promise<ConvertedPreviewResponse> {
  const res = await shareFetch(path, viewToken, signal)
  if (res.status === 200) return { status: 200, blob: await res.blob() }
  if (res.status === 202) return { status: 202 }
  if (res.status !== 404 && res.status !== 422) throw new SharePublicError(res.status)
  const body = await readJsonBody(await res.blob())
  if (res.status === 404) return body?.status === 'NOT_APPLICABLE' ? { status: 404 } : { status: 'error' }
  if (typeof body?.code === 'string' && typeof body.transient === 'boolean') {
    return { status: 422, code: body.code, transient: body.transient }
  }
  return { status: 422, code: 'UNAVAILABLE', transient: true }
}

/** Content-Disposition 의 파일 이름 — RFC-5987(filename*=UTF-8'') 우선, 없으면 filename="…", 그것도 없으면 fallback. */
function dispositionFileName(disposition: string, fallback: string): string {
  const rfc5987 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (rfc5987) {
    try {
      return decodeURIComponent(rfc5987[1].trim())
    } catch {
      // 잘못된 인코딩은 아래 폴백으로
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallback
}

/**
 * 공개 다운로드 경로로 받아 브라우저 저장 — 열람 토큰이 있으면 헤더로(감사 로그 경로). 실패는 SharePublicError.
 * WP-1538: 파일 링크(`…/download`)와 폴더 링크 하위 파일(`…/files/{id}/download`)이 함께 쓰도록 경로를 받는다.
 */
export async function downloadShare(path: string, viewToken: string | null, fallbackName = 'download'): Promise<void> {
  const res = await shareFetch(path, viewToken)
  if (!res.ok) throw new SharePublicError(res.status)
  const blob = await res.blob()
  downloadBlob(dispositionFileName(res.headers.get('Content-Disposition') ?? '', fallbackName), blob)
}
