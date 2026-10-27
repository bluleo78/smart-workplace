// 남은 페이지 자동 로드 실패 안내 테스트(WP-1007)가 함께 쓰는 MSW 핸들러 — 데스크톱·모바일 파일로 나뉘어 있다
// (모바일 폭 판정은 파일 안에서 한 번 정해져 캐시되므로 두 셸을 한 파일에서 못 본다).
import { http, HttpResponse } from 'msw'

import { BASE } from '@/test/msw/versionHandlers'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

/** EPIC 시스템 유형 id(issueType.factory systemTypes). */
export const EPIC_TYPE_ID = '6'

/**
 * 두 페이지짜리 이슈 검색 — 두 번째 페이지(cursor=1)는 처음 한 번 500 으로 실패하고, 다시 부르면 답한다.
 * match 가 참인 요청만 받고 나머지는 다음 핸들러로 넘긴다(MSW: undefined 반환).
 */
export function failingSecondPage(match: (params: URLSearchParams) => boolean, make: (n: number) => ReturnType<typeof createIssue>) {
  const cursors: (string | null)[] = []
  let failed = false
  const handler = http.get(`${BASE}/issues`, ({ request }) => {
    const params = new URL(request.url).searchParams
    if (!match(params)) return undefined
    const cursor = params.get('cursor')
    cursors.push(cursor)
    if (cursor === '1' && !failed) {
      failed = true
      return HttpResponse.json({ message: '일시적인 오류' }, { status: 500 })
    }
    return HttpResponse.json(createIssueSearchResponse([make(cursor ? 2 : 1)], cursor ? null : '1'))
  })
  return { handler, cursors }
}


/** 종료 에픽 조회(type=EPIC + status=DONE,CANCELED)는 두 페이지·실패로, 위쪽 목록(종료 상태 없는 에픽 조회)은 비운다. */
export function closedEpicHandlers() {
  const isEpic = (p: URLSearchParams) => p.get('type') === EPIC_TYPE_ID
  const closed = failingSecondPage(
    (p) => isEpic(p) && p.get('status') === 'DONE,CANCELED',
    (n) => createIssue({ id: 100 + n, number: 100 + n, title: `종료 에픽 ${n}`, status: 'DONE' }),
  )
  const panelEpics = http.get(`${BASE}/issues`, ({ request }) =>
    isEpic(new URL(request.url).searchParams) ? HttpResponse.json(createIssueSearchResponse([], null)) : undefined,
  )
  return { handlers: [closed.handler, panelEpics], cursors: closed.cursors }
}
