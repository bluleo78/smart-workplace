// 연락처 모바일 검색(WP-976, §B-1 「검색창 — 모바일」) — 페이지 테스트(WP-971).
// 헤더 🔍 → 입력 펼침 + 「취소」, 그룹 보기면 범위 칩, 취소하면 검색어를 비우고 접힌다. ?q 로 들어오면 펼친 채 시작한다.
// 조건부 렌더·URL 상태라 브라우저 없이 판정한다(🔍 뒤 입력칸 포커스·한글 조합은 E2E @input).
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
]

test('헤더 🔍 를 누르면 검색 줄이 펼쳐지고, 「취소」는 검색어를 비우고 접는다', async () => {
  const { user, location } = renderPage('/contacts', { handlers })
  const open = await screen.findByTestId('contact-search-open', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 접힌 동안엔 입력칸이 없다(⋯·☰ 시트 안에도 두지 않는다).
  expect(screen.queryByTestId('contact-search')).not.toBeInTheDocument()

  await user.click(open)
  const row = await screen.findByTestId('contact-mobile-search')
  await user.type(within(row).getByTestId('contact-search'), '이수')
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))

  await user.click(within(row).getByTestId('contact-search-cancel'))
  await waitFor(() => expect(location()).toBe('/contacts'))
  expect(screen.queryByTestId('contact-mobile-search')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-search-open')).toBeInTheDocument()
})

test('그룹 보기에서 펼치면 범위 칩이 앞에 있고, 칩을 누르면 그룹만 풀린다', async () => {
  const { user, location } = renderPage('/contacts?group=10', { handlers })
  await user.click(await screen.findByTestId('contact-search-open', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  const chip = await screen.findByTestId('contact-search-scope')
  expect(chip).toHaveTextContent('경영지원본부 재경팀')
  await user.type(screen.getByTestId('contact-search'), '이수')
  await waitFor(() => expect(location()).toBe('/contacts?group=10&q=%EC%9D%B4%EC%88%98'))
  await user.click(chip)
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
  // 검색어가 남아 있으니 검색 줄은 펼친 채 남는다.
  expect(screen.getByTestId('contact-mobile-search')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-search-scope')).not.toBeInTheDocument()
})

test('?q 로 들어오면 숨은 필터가 없게 검색 줄을 펼친 채 시작한다', async () => {
  renderPage('/contacts?q=이수', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(input).toHaveValue('이수')
  expect(screen.queryByTestId('contact-search-open')).not.toBeInTheDocument()
})

test('?q 로 펼친 검색 줄은 입력칸을 비워도 접히지 않는다', async () => {
  const { user, location } = renderPage('/contacts?q=이수', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.clear(input)
  await waitFor(() => expect(location()).toBe('/contacts'))
  expect(screen.getByTestId('contact-mobile-search')).toBeInTheDocument()
  expect(screen.queryByTestId('contact-search-open')).not.toBeInTheDocument()
})
