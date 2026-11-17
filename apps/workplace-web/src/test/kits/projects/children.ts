// 하위 목록 API(/children) 테스트 응답기(WP-1684) — 서버 계약(state=open|closed·cursor·size, closedCount·nextCursor)을 흉내 낸다.
// 왜: 하위 목록이 열린 것/끝난 것을 따로 받고 100건씩 잘라 받게 되어, 테스트마다 같은 거름·자르기를 반복하지 않게 한 곳에 둔다.
import { http, HttpResponse } from 'msw'

import type { EpicChildrenResponse, IssueResponse } from '@/types/issue'

/** 끝난 범주(완료·취소) — 서버가 상태 범주로 가르는 것과 같이 status 범주 값으로 가른다. */
const isClosed = (it: IssueResponse) => it.status === 'DONE' || it.status === 'CANCELED'

/**
 * 전체 하위(만든 순서)를 받아 한 페이지 응답을 만든다 — 커서는 다음 시작 위치(문자열 숫자)로 흉내 낸다.
 * closedCount·hiddenCount 는 페이지와 상관없이 전체 기준(서버 계약과 같음).
 */
export function childrenPage(
  all: IssueResponse[],
  params: { state?: string | null; cursor?: string | null; size?: string | number | null },
  hiddenCount = 0,
): EpicChildrenResponse {
  const state = params.state ?? 'open'
  const size = Number(params.size ?? 100) || 100
  const start = params.cursor ? Number(params.cursor) : 0
  const picked = all.filter((it) => (state === 'closed' ? isClosed(it) : !isClosed(it)))
  const items = picked.slice(start, start + size)
  const next = start + size < picked.length ? String(start + size) : null
  return { items, hiddenCount, closedCount: all.filter(isClosed).length, nextCursor: next }
}

/** MSW 응답기 — `http.get(\`${base}/children\`, childrenResolver(() => all))` 처럼 쓴다. */
export function childrenResolver(all: () => IssueResponse[], hiddenCount = 0) {
  return ({ request }: { request: Request }) => {
    const sp = new URL(request.url).searchParams
    return HttpResponse.json(childrenPage(all(), { state: sp.get('state'), cursor: sp.get('cursor'), size: sp.get('size') }, hiddenCount))
  }
}

/**
 * 어느 이슈든 하위가 없다고 답하는 하위 목록 핸들러 — 하위 섹션을 그리지만 하위를 보지 않는 화면 테스트용.
 * 왜: 하위 태스크도 /children 으로 받게 되어(WP-1684), 예전엔 검색 목(parent 필터)이 받아 주던 요청이 이리로 온다.
 */
export const emptyChildrenHandler = http.get('/api/v1/projects/:key/issues/:number/children', () =>
  HttpResponse.json({ items: [], hiddenCount: 0, closedCount: 0, nextCursor: null } satisfies EpicChildrenResponse),
)
