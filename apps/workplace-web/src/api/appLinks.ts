// 채팅 앱 링크 카드 API(WP-896) — 보는 사람 권한으로 그 순간 채운 카드 칸. 볼 수 없거나 없는 대상은 오류(404·403)로 온다.
import { isAxiosError } from 'axios'

import type { AppLink } from '@/lib/appLinks'
import type { UserSummary } from '@/types/user'

import { client } from './client'

export interface AppLinkCard {
  kind: 'ISSUE' | 'PAGE' | 'FILE' | 'MESSAGE' | 'EVENT' | 'MAIL'
  /** 이슈 제목 / 노트 제목 / 파일 이름 / 메시지 본문 앞부분 / 일정 제목 / 메일 제목 */
  title: string
  issueKey?: string
  statusName?: string
  statusCategory?: string
  assignees?: UserSummary[]
  priority?: string
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
}

/** 링크 대상의 카드 API 경로 — 대상마다 하나라 카드 캐시 키로도 쓴다. */
export function appLinkCardPath(link: AppLink): string {
  if (link.kind === 'ISSUE') return `/app-links/issues/${encodeURIComponent(link.key)}/${link.number}`
  switch (link.kind) {
    case 'PAGE':
      return `/app-links/pages/${link.pageId}`
    case 'FILE':
      return `/app-links/files/${link.fileId}`
    case 'MESSAGE':
      return `/app-links/messages/${link.messageId}`
    case 'EVENT':
      return `/app-links/events/${link.eventId}`
    case 'MAIL':
      return `/app-links/mails/${link.mailId}`
  }
}

/** 앱 링크 판정 설정(WP-1165) — 공개 웹 주소의 호스트(소문자, 포트 제외). 서버 설정이 비었거나 잘못됐으면 null. */
export interface AppLinkConfig {
  appHost: string | null
}

export const appLinksApi = {
  card: async (link: AppLink): Promise<AppLinkCard> => {
    const { data } = await client.get<AppLinkCard>(appLinkCardPath(link))
    return data
  },
  config: async (): Promise<AppLinkConfig> => {
    const { data } = await client.get<AppLinkConfig>('/app-links/config')
    return data
  },
}

/** 볼 수 없거나 없는 대상(서버가 정보 없이 404 — 예전 응답의 403 도)인지. 그 밖의 오류(5xx·연결 끊김)는 권한과 무관하다. */
export function isAppLinkDenied(err: unknown): boolean {
  const status = isAxiosError(err) ? err.response?.status : undefined
  return status === 404 || status === 403
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
