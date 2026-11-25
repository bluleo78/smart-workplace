// 채팅 앱 링크 카드 API(WP-896) — 보는 사람 권한으로 그 순간 채운 카드 칸. 볼 수 없거나 없는 대상은 오류(404·403·410)로 온다.
import { isAxiosError } from 'axios'

import { driveFilePath } from '@/components/viewer/driveOpen'
import { issueKeyStatusKeys } from '@/hooks/queries/issueKeyStatusKeys'
import { sleep } from '@/lib/abortableWait'
import { isTransientRequestError } from '@/lib/api-error'
import type { AppLink } from '@/lib/appLinks'
import { driveFolderPath } from '@/lib/appUrl'
import type { UserSummary } from '@/types/user'

import { client } from './client'

export interface AppLinkCard {
  kind: 'ISSUE' | 'PAGE' | 'FILE' | 'FOLDER' | 'DRIVE_SPACE' | 'MESSAGE' | 'EVENT' | 'MAIL' | 'SHARE'
  /**
   * 이슈 제목 / 노트 제목 / 파일 이름 / 폴더 이름 / 드라이브 공간 이름 / 메시지 본문 앞부분 / 일정 제목 / 메일 제목 / 공유 파일 이름.
   * SHARE 의 PASSWORD 카드는 파일 이름 대신 서버가 정한 고정 문구다 — 비구성원에게 이름을 흘리지 않는다(WP-1474).
   */
  title: string
  issueKey?: string
  statusName?: string
  statusCategory?: string
  assignees?: UserSummary[]
  priority?: string
  /** PAGE — 노트 스페이스 / FOLDER — 폴더가 있는 드라이브 공간(WP-1536) / SHARE MEMBER — 파일이 있는 드라이브 공간 */
  spaceName?: string
  /** MESSAGE — 채널 이름(DM 이면 상대 이름) */
  channelName?: string
  /** MESSAGE — CHANNEL | DM */
  channelKind?: 'CHANNEL' | 'DM'
  /** MESSAGE — 작성자 / MAIL — 보낸 사람 */
  authorName?: string
  /** MESSAGE — 보낸 시각 / MAIL — 메일 날짜(ISO) */
  sentAt?: string
  /** EVENT — 시작·끝(ISO), 종일 여부 */
  startAt?: string
  endAt?: string
  allDay?: boolean
  /**
   * SHARE(WP-1474) — 보는 사람에게 그 공유 링크가 어떻게 보이는가.
   * MEMBER: 파일이 있는 공간 구성원(드라이브로 연다) · OPEN: 링크로 열 수 있음 · PASSWORD: 비밀번호 링크.
   * 만료·폐기·없는 링크는 카드가 아니라 410 오류로 온다(isAppLinkDenied).
   */
  shareState?: 'MEMBER' | 'OPEN' | 'PASSWORD'
  /** SHARE MEMBER·OPEN — 파일 mime(아이콘) */
  mimeType?: string
  /** SHARE OPEN — 종류 이름(PDF 등, 메신저 카드와 같은 이름) */
  typeLabel?: string
  /** SHARE OPEN — 파일 크기(바이트) */
  sizeBytes?: number
  /** SHARE OPEN — 링크 만료 시각(ISO). 만료일 없는 링크면 없다. */
  expiresAt?: string
  /** SHARE MEMBER — 드라이브 이동 경로(공간·폴더·파일). 폴더는 루트면 없다. */
  driveSpaceId?: number
  driveFolderId?: number
  driveFileId?: number
  /** SHARE — 공유 대상이 파일인가 폴더인가(WP-1538). 서버는 항상 싣는다. FOLDER 면 driveFileId 대신 driveFolderId 가 폴더 자신이다. */
  shareTarget?: 'FILE' | 'FOLDER'
  /** SHARE FOLDER MEMBER·OPEN — 공유 범위: 외부 공유 / 사내 공유 배지(WP-1538) */
  audience?: 'EXTERNAL' | 'INTERNAL'
  /** SHARE FOLDER MEMBER·OPEN — 폴더 안 하위 폴더·파일 수 */
  folderCount?: number
  fileCount?: number
  /** SHARE FOLDER MEMBER·OPEN — 공유한 사람 이름(비밀번호 카드엔 없다) */
  sharedBy?: string
}

/** 링크 대상의 카드 API 경로 — 대상마다 하나라 카드 캐시 키로도 쓴다. */
export function appLinkCardPath(link: AppLink): string {
  if (link.kind === 'ISSUE') return `/app-links/issues/${encodeURIComponent(link.key)}/${link.number}`
  switch (link.kind) {
    case 'PAGE':
      return `/app-links/pages/${link.pageId}`
    case 'FILE':
      return `/app-links/files/${link.fileId}`
    case 'FOLDER':
      // 링크의 공간도 보낸다 — 폴더가 그 공간에 없으면(링크를 눌러도 열리지 않으면) 서버가 404 를 준다(WP-1536).
      return `/app-links/folders/${link.folderId}?spaceId=${link.spaceId}`
    case 'DRIVE_SPACE':
      return `/app-links/drive-spaces/${link.spaceId}`
    case 'MESSAGE':
      return `/app-links/messages/${link.messageId}`
    case 'EVENT':
      return `/app-links/events/${link.eventId}`
    case 'MAIL':
      return `/app-links/mails/${link.mailId}`
    case 'SHARE':
      return `/app-links/shares/${encodeURIComponent(link.token)}`
  }
}

/**
 * 공유 링크 카드(WP-1474)를 보는 사람이 공간 구성원(MEMBER)이면 드라이브의 그 파일 미리보기 경로, 아니면 null.
 * 채팅 카드(AppLinkCard)와 노트 칩(wikiAppLinkChips)이 같은 경로로 가게 한 곳에서 정한다 — 구성원은 공유 링크 화면을 거치지 않는다.
 */
export function shareCardDrivePath(card: AppLinkCard): string | null {
  if (card.kind !== 'SHARE' || card.shareState !== 'MEMBER') return null
  // 폴더 공유(WP-1538) — 구성원이면 드라이브의 그 폴더로 간다(폴더 id 가 공유한 폴더 자신).
  if (card.shareTarget === 'FOLDER') {
    return card.driveSpaceId != null && card.driveFolderId != null ? driveFolderPath(card.driveSpaceId, card.driveFolderId) : null
  }
  if (card.driveSpaceId == null || card.driveFileId == null) return null
  return driveFilePath(card.driveSpaceId, card.driveFolderId ?? null, card.driveFileId)
}

/** 앱 링크 판정 설정(WP-1165) — 공개 웹 주소의 호스트(소문자, 포트 제외). 서버 설정이 비었거나 잘못됐으면 null. */
export interface AppLinkConfig {
  appHost: string | null
}

/** 이슈 키 하나의 현재 상태(WP-2102) — 본문 키 링크를 끝난 이슈면 삭선으로 보이는 데 쓴다. */
export interface IssueKeyStatus {
  issueKey: string
  statusName: string
  statusCategory: string
}

export const appLinksApi = {
  card: async (link: AppLink): Promise<AppLinkCard> => {
    const { data } = await client.get<AppLinkCard>(appLinkCardPath(link))
    return data
  },
  /** 이슈 키 상태 일괄 조회(WP-2102) — 보는 사람이 볼 수 없거나 없는 키는 응답에서 빠진다. 순서는 입력과 다를 수 있다. */
  issueStatuses: async (keys: string[]): Promise<IssueKeyStatus[]> => {
    const { data } = await client.post<{ items: IssueKeyStatus[] }>('/app-links/issue-statuses', { keys })
    return data.items
  },
  config: async (): Promise<AppLinkConfig> => {
    const { data } = await client.get<AppLinkConfig>('/app-links/config')
    return data
  },
}

/** 카드 조회 오류의 HTTP 상태 — 응답 없는 오류(연결 끊김 등)·axios 밖 오류면 undefined. */
export function appLinkErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined
}

/**
 * 볼 수 없거나 없는 대상인지 — 서버가 정보 없이 404(예전 응답의 403 도), 또는 열 수 없는 공유 링크(만료·폐기·없음, WP-1474)의 410.
 * 그 밖의 오류(5xx·연결 끊김)는 권한과 무관하다.
 */
export function isAppLinkDenied(err: unknown): boolean {
  const status = appLinkErrorStatus(err)
  return status === 404 || status === 403 || status === 410
}

/** 카드 1장 조회 옵션 — 채팅 카드와 노트 칩(WP-1147)이 같은 캐시를 나눠 쓴다. */
export function appLinkCardQuery(link: AppLink) {
  return {
    // 대상별 캐시 키(API 경로) — 같은 이슈가 여러 메시지·노트에 있어도 한 번만 받는다.
    queryKey: ['app-link', appLinkCardPath(link)],
    queryFn: () => appLinksApi.card(link),
    // 권한 없음·없음(404)은 다시 물어도 같다 — 재시도하지 않는다. 일시 오류(배포 중 5xx·연결 끊김)는 두 번까지 다시 묻는다.
    retry: (count: number, err: unknown) => !isAppLinkDenied(err) && count < 2,
    // 상태·제목은 자주 바뀌지 않아 1분 동안 다시 받지 않는다.
    staleTime: 60_000,
  }
}

// 서버가 한 번에 받는 키 최대 개수 — 넘기면 400 이라 이 크기로 나눠 보낸다.
const ISSUE_STATUS_CHUNK = 100

// 묶음 POST 가 일시 오류로 실패했을 때 다시 보내기 전 기다리는 기본 간격 — 시도 횟수를 곱한다(500ms, 1000ms).
const ISSUE_STATUS_RETRY_DELAY_MS = 500
// 첫 요청 뒤 묶음 단위로 더 시도하는 최대 횟수(총 3번).
const ISSUE_STATUS_MAX_RETRIES = 2

type StatusWaiter = { resolve: (v: IssueKeyStatus | null) => void; reject: (e: unknown) => void }
// 이번 틱에 모인 키 → 기다리는 쪽들. 같은 키는 한 항목에 모아 본문에 한 번만 싣는다.
let pendingStatusKeys = new Map<string, StatusWaiter[]>()

/**
 * 한 묶음 POST — 일시 오류(5xx·연결 끊김)면 같은 묶음을 최대 두 번 더 보낸다. 4xx 는 다시 물어도 같아 바로 던진다.
 * 재시도를 키별 쿼리(useQuery retry)가 아니라 여기서 묶음 단위로 하는 이유: 장식용 상태라, 키마다 재시도하면
 * 이미 실패한 서버에 요청이 키 수만큼 쏟아진다.
 */
async function postIssueStatusesWithRetry(chunk: string[]): Promise<IssueKeyStatus[]> {
  for (let attempt = 0; attempt <= ISSUE_STATUS_MAX_RETRIES; attempt++) {
    try {
      return await appLinksApi.issueStatuses(chunk)
    } catch (err) {
      // 일시 오류(응답 없음·5xx)만 다시 보낸다(공용 판정) — 400·403·404 등은 다시 보내도 같아 바로 던진다.
      if (!isTransientRequestError(err) || attempt === ISSUE_STATUS_MAX_RETRIES) throw err
      await sleep(ISSUE_STATUS_RETRY_DELAY_MS * (attempt + 1))
    }
  }
  // 위 루프는 성공 반환이나 throw 로만 끝난다 — 타입 검사용.
  throw new Error('unreachable')
}

/** 모인 키를 100개씩 나눠 한 묶음에 POST 한 번(실패 시 묶음 단위 재시도) — 끝내 실패하면 그 묶음 키의 프라미스를 모두 거절한다. */
function flushIssueStatuses() {
  const batch = pendingStatusKeys
  pendingStatusKeys = new Map()
  const keys = [...batch.keys()]
  for (let i = 0; i < keys.length; i += ISSUE_STATUS_CHUNK) {
    const chunk = keys.slice(i, i + ISSUE_STATUS_CHUNK)
    postIssueStatusesWithRetry(chunk).then(
      (items) => {
        // 응답 순서는 입력과 달라 issueKey 로 짝짓는다. 응답에 없는 키(못 보는·없는 이슈)는 null.
        const byKey = new Map(items.map((it) => [it.issueKey, it]))
        for (const k of chunk) for (const w of batch.get(k) ?? []) w.resolve(byKey.get(k) ?? null)
      },
      (err) => {
        for (const k of chunk) for (const w of batch.get(k) ?? []) w.reject(err)
      },
    )
  }
}

/**
 * 이슈 키 하나의 상태를 받는다(WP-2102). 한 글에 키가 수십 개여도 요청이 키 수만큼 나가지 않도록,
 * 같은 틱(마이크로태스크)에 요청된 키를 모아 한 번에 보낸다. 못 보는·없는 키는 null.
 */
export function loadIssueKeyStatus(key: string): Promise<IssueKeyStatus | null> {
  return new Promise((resolve, reject) => {
    const first = pendingStatusKeys.size === 0
    const waiters = pendingStatusKeys.get(key)
    if (waiters) waiters.push({ resolve, reject })
    else pendingStatusKeys.set(key, [{ resolve, reject }])
    if (first) queueMicrotask(flushIssueStatuses)
  })
}

/** 키 상태 조회 옵션 — 키별 캐시라 같은 키가 여러 곳에 있어도 한 번만 받는다. */
export function issueKeyStatusQuery(projectKey: string, number: number) {
  return {
    queryKey: issueKeyStatusKeys.key(projectKey, number),
    queryFn: () => loadIssueKeyStatus(`${projectKey}-${number}`),
    // 재시도는 키별 쿼리가 아니라 묶음 POST 쪽(postIssueStatusesWithRetry)에서 한다 — 여기서 하면 키마다 요청이 나간다. 끝내 실패하면 링크는 평소 모양이다.
    retry: false,
    staleTime: 60_000,
  }
}
