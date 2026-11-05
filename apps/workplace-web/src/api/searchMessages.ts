// WP-1358 통합 검색 — 내가 멤버인 채널·DM 의 메시지 본문 검색 API(GET /api/v1/search/messages). 최신순, (createdAt, id) 커서로 이어 받는다.
import { client } from './client'

/** 메시지 검색 결과 1건 — channelName 은 채널 이름 또는 DM 이면 상대 이름, parentMessageId 는 스레드 답글이면 루트 id, excerpt 는 맞은 곳 주변 한 줄. */
export interface MessageSearchItem {
  id: number
  channelId: number
  channelKind: 'CHANNEL' | 'DM'
  channelName: string | null
  parentMessageId: number | null
  authorName: string
  authorKind: 'HUMAN' | 'AGENT'
  excerpt: string
  /** 서버가 준 문자열 그대로 커서에 쓴다 — Date 로 바꾸면 마이크로초가 잘려 경계 행이 빠지거나 겹친다. */
  createdAt: string
}

export interface MessageSearchPage {
  items: MessageSearchItem[]
  hasMore: boolean
}

/** 다음 쪽 커서 — 이전 쪽 마지막 행의 시각(받은 문자열 그대로)과 id. */
export interface MessageSearchCursor {
  beforeAt: string
  beforeId: number
}

/** 본문에 q 가 들어간 메시지를 최신순으로 찾는다. before 가 있으면 그 행 다음(더 오래된) 쪽. */
export async function searchMessages(
  q: string,
  before: MessageSearchCursor | null,
  size: number,
  signal?: AbortSignal,
): Promise<MessageSearchPage> {
  const { data } = await client.get<MessageSearchPage>('/search/messages', {
    params: { q, size, ...(before ? { beforeAt: before.beforeAt, beforeId: before.beforeId } : {}) },
    signal,
  })
  return data
}
