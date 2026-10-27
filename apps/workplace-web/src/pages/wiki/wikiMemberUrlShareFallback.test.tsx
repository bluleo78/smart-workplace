// 노트 주소로 연 비멤버(WP-987) — 페이지 테스트(WP-971).
// 스페이스 멤버가 아닌 사람이 하위 페이지의 노트 주소(/wiki/spaces/<id>/pages/<id>)를 받아 열면 페이지 조회가 404 다.
// 그 페이지를 덮는 공유가 있으면 입구(GET /wiki/pages/{id}/entry?link=true)가 토큰을 주고, 공유 보기로 바꿔 연다.
// 덮는 공유가 없으면 지금처럼 「페이지를 불러올 수 없습니다」.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import type { WikiPageEntry } from '../../types/wiki'

const API = '/api/v1'
const SPACE = 9
const PAGE = 32
const TOKEN = 'wsh_parent'

/** 비멤버가 연 노트 — 페이지·트리는 404, 공간 목록에는 그 공간이 없다. entry 는 받은 link 쿼리를 모은다. */
function nonMemberHandlers(entry: { status: number; body?: WikiPageEntry }) {
  const entryLinks: (string | null)[] = []
  const notFound = () => HttpResponse.json({ status: 404, message: '페이지를 찾을 수 없습니다' }, { status: 404 })
  const handlers = [
    http.get(`${API}/wiki/spaces`, () => HttpResponse.json([])),
    http.get(`${API}/wiki/spaces/:id/tree`, notFound),
    http.get(`${API}/wiki/spaces/:id/pages`, notFound),
    http.get(`${API}/wiki/spaces/:id/shares`, () => HttpResponse.json([])),
    http.get(`${API}/wiki/pages/${PAGE}`, notFound),
    http.get(`${API}/wiki/pages/${PAGE}/entry`, ({ request }) => {
      entryLinks.push(new URL(request.url).searchParams.get('link'))
      return entry.body ? HttpResponse.json(entry.body) : notFound()
    }),
    // 공유 보기로 옮긴 뒤의 화면 데이터 — 이동만 보므로 해제된 링크로 답한다.
    http.get(`${API}/wiki/shares/:token`, () =>
      HttpResponse.json({ status: 404, message: '링크를 찾을 수 없습니다' }, { status: 404 }),
    ),
  ]
  return { handlers, entryLinks }
}

describe('노트 주소로 연 비멤버 → 공유 보기 (WP-987)', () => {
  test('페이지를 덮는 공유가 있으면 그 공유 보기 주소로 바꿔 연다', async () => {
    const api = nonMemberHandlers({ status: 200, body: { spaceId: SPACE, member: false, shareToken: TOKEN } })
    const { location } = renderPage(`/wiki/spaces/${SPACE}/pages/${PAGE}`, { handlers: api.handlers })
    await waitFor(() => expect(location()).toBe(`/wiki/share/${TOKEN}/pages/${PAGE}`), { timeout: PAGE_LOAD_TIMEOUT })
    // 알림 입구와 달리 워크스페이스 전체 공유도 보라고 link=true 로 묻는다.
    expect(api.entryLinks).toContain('true')
  })

  test('덮는 공유가 없으면 지금처럼 「페이지를 불러올 수 없습니다」', async () => {
    const api = nonMemberHandlers({ status: 404 })
    const { location } = renderPage(`/wiki/spaces/${SPACE}/pages/${PAGE}`, { handlers: api.handlers })
    expect(await screen.findByText('페이지를 불러올 수 없습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(`/wiki/spaces/${SPACE}/pages/${PAGE}`)
  })
})
