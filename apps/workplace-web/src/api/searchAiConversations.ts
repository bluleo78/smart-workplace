// WP-1360 통합 검색 — 내 지난 AI 대화 검색 API(GET /api/v1/search/ai-conversations). 키워드로만 찾는다.
import { client } from './client'

/** AI 대화 검색 결과 1건 — role 은 맞은 메시지의 역할(USER=질문, ASSISTANT=답), excerpt 는 그 메시지의 발췌. */
export interface AiConversationSearchItem {
  sessionId: string
  /** 세션 제목 — 비어 있을 수 있다. */
  title: string | null
  lastMessageAt: string
  role: 'USER' | 'ASSISTANT'
  excerpt: string
}

export interface AiConversationSearchPage {
  items: AiConversationSearchItem[]
  hasMore: boolean
}

/** 내 AI 대화에서 q 가 들어간 대화를 찾는다. offset·size 로 이어 받는다. */
export async function searchAiConversations(q: string, offset: number, size: number, signal?: AbortSignal): Promise<AiConversationSearchPage> {
  const { data } = await client.get<AiConversationSearchPage>('/search/ai-conversations', { params: { q, offset, size }, signal })
  return data
}
