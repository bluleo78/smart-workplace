// WP-1227 드라이브 공유 링크(/s/:token) 공개 API — 정보·잠금 풀기·원본·변환 PDF·다운로드.
// axios client 를 쓰지 않는다: client 는 401 이면 토큰 갱신을 시도하고 실패하면 /login 으로 보내는데,
// 이 화면은 로그인 없이 그려져야 하고 401 은 「열람 토큰 만료 → 비밀번호 다시」 뜻이다.
// 로그인 중이면 Bearer 를 함께 보낸다(사내 링크 판정·드라이브에서 열기 대상 계산에 쓰인다).

import { downloadBlob } from '../lib/download'
import type { BlobProgress } from './blobContent'
import { getAccessToken } from './client'
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

/** GET 정보 응답 — 두 불리언은 늘 온다. 잠금(로그인·비밀번호)이면 파일 필드가 없다(sharedBy·driveOpen 은 null 일 수 있다). */
export type ShareInfo =
  | { loginRequired: true; passwordRequired: boolean }
  | { passwordRequired: true; loginRequired: false }
  | {
      passwordRequired: false
      loginRequired: false
      name: string
      mimeType: string
      sizeBytes: number
      sharedBy: string | null
      /** 비로그인 — 「로그인하고 드라이브에서 열기」를 보인다. */
      loginAvailable: boolean
      driveOpen: ShareDriveOpen | null
    }

/** 파일 카드를 그릴 수 있는 정보(잠금 아님). */
export type ShareFileInfo = Extract<ShareInfo, { name: string }>

/** 공개 공유 API 기본 경로 — 뷰어 항목의 contentPath·previewPath 도 이 아래다. */
export function sharePublicBase(token: string): string {
  return `/api/v1/public/drive/share/${encodeURIComponent(token)}`
}

/** 요청 헤더 — 로그인 중이면 Bearer, 열람 토큰이 있으면 X-Share-View-Token. */
function shareHeaders(viewToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {}
  const tok = getAccessToken()
  if (tok) headers.Authorization = `Bearer ${tok}`
  if (viewToken) headers['X-Share-View-Token'] = viewToken
  return headers
}

/** 링크 정보 — 404 없음 / 410 만료·폐기 / 403 다른 워크스페이스는 SharePublicError. */
export async function fetchShareInfo(token: string, viewToken: string | null): Promise<ShareInfo> {
  const res = await fetch(sharePublicBase(token), { headers: shareHeaders(viewToken) })
  if (!res.ok) throw new SharePublicError(res.status)
  return (await res.json()) as ShareInfo
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
  const res = await fetch(path, { headers: shareHeaders(viewToken), signal })
  if (!res.ok) throw new SharePublicError(res.status)
  return readBlob(res, onProgress)
}

/**
 * 공개 경로 변환 PDF 상태 — driveApi.fetchConvertedPreview 와 같은 모양(200/202/422/404, 그 밖의 404 는 'error')으로 돌려준다.
 * 같은 본문 판독(readJsonBody)을 써서 NOT_APPLICABLE·실패 코드 해석이 드라이브와 갈라지지 않게 한다. 그 밖의 상태는 throw.
 */
export async function fetchShareConverted(path: string, viewToken: string | null, signal?: AbortSignal): Promise<ConvertedPreviewResponse> {
  const res = await fetch(path, { headers: shareHeaders(viewToken), signal })
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

/** 공개 /download 로 받아 브라우저 저장 — 열람 토큰이 있으면 헤더로(감사 로그 경로). 실패는 SharePublicError. */
export async function downloadShare(token: string, viewToken: string | null, fallbackName = 'download'): Promise<void> {
  const res = await fetch(`${sharePublicBase(token)}/download`, { headers: shareHeaders(viewToken) })
  if (!res.ok) throw new SharePublicError(res.status)
  const blob = await res.blob()
  downloadBlob(dispositionFileName(res.headers.get('Content-Disposition') ?? '', fallbackName), blob)
}
