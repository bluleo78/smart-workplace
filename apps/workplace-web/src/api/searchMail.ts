// WP-1359 통합 검색 — 내 모든 메일 계정의 모든 메일함(휴지통·스팸·임시보관함 제외) 검색 API(GET /api/v1/search/mail).
import { client } from './client'

/** 메일함 종류 — SENT 는 앱 발송 기록과 서버 보낸편지함을 함께 가리키고, OTHER 는 보관함·사용자 메일함이다. */
export type MailSearchFolderKind = 'INBOX' | 'SENT' | 'OTHER'

/** 메일 검색 결과 1건 — 메일과 그 메일이 든 메일함. */
export interface MailSearchItem {
  id: number
  accountId: number
  subject: string | null
  /** 평문 미리보기 — 본문 적재 전이면 null. */
  snippet: string | null
  fromAddress: string | null
  fromName: string | null
  /** 서버가 준 문자열 그대로 커서에 쓴다(마이크로초 정밀도 — Date 로 바꾸면 쪽 경계에서 빠지거나 겹친다). */
  receivedAt: string | null
  folderKind: MailSearchFolderKind
  /** OTHER 일 때만 메일함 id. */
  folderId: number | null
  /** 메일함 표시 이름(「받은편지함」·「보낸편지함」·사용자 메일함 이름). */
  folderName: string
  /** SENT 일 때만 첫 받는 사람(이름, 없으면 주소). */
  firstRecipient: string | null
  /** SENT 일 때만 받는 사람 수, 나머지는 0. */
  recipientCount: number
}

export interface MailSearchPage {
  items: MailSearchItem[]
  hasMore: boolean
}

/** 다음 쪽 커서 — 앞 쪽 마지막 항목의 (receivedAt, id). */
export interface MailSearchCursor {
  beforeAt: string | null
  beforeId: number
}

/** 메일에서 q 를 찾는다(제목·보낸 사람·본문). cursor 가 있으면 그 다음 쪽. */
export async function searchMail(q: string, cursor: MailSearchCursor | null, size: number, signal?: AbortSignal): Promise<MailSearchPage> {
  const params: Record<string, string | number> = { q, size }
  if (cursor) {
    params.beforeId = cursor.beforeId
    if (cursor.beforeAt) params.beforeAt = cursor.beforeAt
  }
  const { data } = await client.get<MailSearchPage>('/search/mail', { params, signal })
  return data
}
