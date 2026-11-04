// 연락처 필터 줄(WP-1355) — 모바일 셸에서 보는 페이지 테스트(WP-971 의 검색 테스트를 이어 받았다).
// 검색은 목록 위 필터 줄의 늘 보이는 키워드 칸이다 — 헤더 🔍·펼침 줄·「닫기」·검색어 칩은 없다.
// 조건부 렌더·URL 상태라 브라우저 없이 판정한다(한글 조합·줄 폭 전환은 E2E).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { member, page } from '../../../e2e/factories/contacts.factory'
import { sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

// 모바일 폭(lg 미만)으로 판정되게 한다 — 이 파일의 모든 테스트가 모바일 셸을 본다.
// mediaQueryStore 는 MediaQueryList 를 처음 쓸 때 만들어 캐시하므로 렌더 전에(beforeEach) 바꿔 둔다.
// 진짜 matchMedia 는 모듈에서 한 번만 잡는다 — beforeEach 마다 잡으면 앞 테스트의 스파이를 감싸 무한 재귀가 된다.
const realMatchMedia = window.matchMedia.bind(window)
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = realMatchMedia(query)
    return query === MOBILE_MEDIA_QUERY ? ({ ...mql, matches: true, media: query } as MediaQueryList) : mql
  })
})

const handlers = [
  http.get('/api/v1/user-groups', () => HttpResponse.json(tree({ shared: [sharedNode({ name: '경영지원본부 재경팀' })] }))),
  http.get('/api/v1/user-groups/10', () => HttpResponse.json(sharedDetail({ name: '경영지원본부 재경팀' }))),
  http.get('/api/v1/contacts', () => HttpResponse.json(page([member({ id: 2, name: '이수정' })]))),
  http.get('/api/v1/user-groups/10/members/search', () => HttpResponse.json([])),
]

test('모바일 목록에는 돋보기 없이 키워드 칸이 늘 보이고, 입력하면 q 가 갱신된다', async () => {
  const { user, location } = renderPage('/contacts', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(input).toHaveAttribute('placeholder', '이름·이메일')
  // 예전 모바일 검색 장치는 없다 — 돋보기·펼침 줄·닫기·검색어 칩
  expect(screen.queryByTestId('contact-search-open')).not.toBeInTheDocument()
  expect(screen.queryByTestId('contact-mobile-search')).not.toBeInTheDocument()
  expect(screen.queryByTestId('contact-search-close')).not.toBeInTheDocument()
  expect(screen.queryByTestId('contact-search-chip')).not.toBeInTheDocument()
  // 헤더에는 ＋·☰ 만 남는다
  expect(screen.getByTestId('contact-create')).toBeInTheDocument()
  expect(screen.getByTestId('mobile-sidebar-trigger')).toBeInTheDocument()

  await user.type(input, '이수')
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
})

test('그룹 보기에서는 키워드 칸 뒤에 범위 칩이 있고, 칩을 누르면 그룹만 풀리며 검색어는 남는다', async () => {
  const { user, location } = renderPage('/contacts?group=10', { handlers })
  const chip = await screen.findByTestId('contact-search-scope', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 그룹 트리를 받기 전에는 「그룹」 — 받은 뒤 이름으로 바뀐다
  await waitFor(() => expect(chip).toHaveTextContent('경영지원본부 재경팀'))
  const input = screen.getByTestId('contact-search')
  expect(input.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.type(input, '이수')
  await waitFor(() => expect(location()).toBe('/contacts?group=10&q=%EC%9D%B4%EC%88%98'))
  await user.click(chip)
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
  expect(screen.queryByTestId('contact-search-scope')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-search')).toHaveValue('이수')
})

test('?q 로 들어오면 키워드 칸에 검색어가 채워져 있고, 비워도 칸은 그대로 남는다', async () => {
  const { user, location } = renderPage('/contacts?q=이수', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(input).toHaveValue('이수')
  await user.clear(input)
  await waitFor(() => expect(location()).toBe('/contacts'))
  expect(screen.getByTestId('contact-search')).toBeInTheDocument()
})

// WP-977 — 모바일 그룹 보기 헤더 「‹ 그룹 이름」. /contacts 는 탭 루트라 하단 탭바의 ✦ 가 남으므로 헤더에 ✦ 를 또 그리지 않는다.
test('모바일 그룹 보기 헤더에는 ✦ 가 없고 ☰ 시트 버튼이 있다', async () => {
  renderPage('/contacts?group=10', { handlers })
  const header = await screen.findByTestId('contact-group-header', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(header).queryByTestId('mobile-back-ai')).not.toBeInTheDocument()
  expect(within(header).getByTestId('mobile-sidebar-trigger')).toHaveAttribute('data-mobile-sidebar-trigger')
})
