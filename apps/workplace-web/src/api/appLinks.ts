// 채팅 앱 링크 카드 API(WP-896) — 보는 사람 권한으로 그 순간 채운 카드 칸. 볼 수 없거나 없는 대상은 오류(404·403)로 온다.
import type { AppLink } from '@/lib/appLinks'
import type { UserSummary } from '@/types/user'

import { client } from './client'

export interface AppLinkCard {
  kind: 'ISSUE' | 'PAGE' | 'FILE'
  /** 이슈 제목 / 노트 제목 / 파일 이름 */
  title: string
  issueKey?: string
  statusName?: string
  statusCategory?: string
  assignees?: UserSummary[]
  priority?: string
  spaceName?: string
}

/** 링크 대상의 카드 API 경로 — 대상마다 하나라 카드 캐시 키로도 쓴다. */
export function appLinkCardPath(link: AppLink): string {
  if (link.kind === 'ISSUE') return `/app-links/issues/${encodeURIComponent(link.key)}/${link.number}`
  if (link.kind === 'PAGE') return `/app-links/pages/${link.pageId}`
  return `/app-links/files/${link.fileId}`
}

export const appLinksApi = {
  card: async (link: AppLink): Promise<AppLinkCard> => {
    const { data } = await client.get<AppLinkCard>(appLinkCardPath(link))
    return data
  },
}
