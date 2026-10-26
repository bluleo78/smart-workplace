// 연락처 보기 전환·검색 범위(WP-976, 05-page-patterns §B-1) — 페이지 테스트(WP-971).
// 사이드바 항목 바로 이동(그룹 선택이 저절로 풀림·잠금 없음·재클릭 토글 없음), 헤더 검색의 그룹 범위(구성원 안 거르기),
// 범위 칩 ×·「전체에서 찾기」로 범위 해제는 URL 상태·조건부 렌더라 브라우저 없이 판정된다.
// 입력 조합(IME)·모바일 🔍 포커스는 E2E(@input)가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { member, memberDetail, page } from '../../../e2e/factories/contacts.factory'
import { sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

const GROUP_NAME = '경영지원본부 재경팀'

/** 그룹 트리·상세(구성원 둘)·통합 목록. 통합 목록 요청의 search 파라미터를 모아 범위 해제 뒤 전체 검색을 확인한다. */
function contactsHandlers(searches: (string | null)[] = []) {
  return [
    http.get('/api/v1/user-groups', () => HttpResponse.json(tree({ shared: [sharedNode({ name: GROUP_NAME })] }))),
    http.get('/api/v1/user-groups/10', () =>
      HttpResponse.json(
        sharedDetail({
          name: GROUP_NAME,
          members: [
            { targetType: 'MEMBER', targetId: 2, name: '이수정', email: 'sujung.lee@example.com', title: '선임 회계 담당', organization: null },
            { targetType: 'MEMBER', targetId: 3, name: '박민준', email: 'minjun.park@example.com', title: '세무 담당', organization: null },
          ],
        }),
      ),
    ),
    http.get('/api/v1/contacts', ({ request }) => {
      searches.push(new URL(request.url).searchParams.get('search'))
      return HttpResponse.json(page([member({ id: 2, name: '이수정' }), member({ id: 9, name: '이수민' })]))
    }),
  ]
}

test('그룹을 고른 채로도 사이드바 「멤버」를 바로 누를 수 있고, 누르면 그룹 선택이 풀린다', async () => {
  const { user, location } = renderPage(`/contacts?group=10`, { handlers: contactsHandlers() })
  await screen.findByTestId('group-contact-view', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const memberFilter = screen.getByTestId('contact-filter-MEMBER')
  // 잠그지 않는다 — 예전엔 그룹을 고르면 퀵필터가 disabled 였다.
  expect(memberFilter).toBeEnabled()
  expect(screen.getByTestId('group-node-10')).toHaveAttribute('aria-current', 'page')
  expect(memberFilter).not.toHaveAttribute('aria-current')

  await user.click(memberFilter)
  await waitFor(() => expect(location()).toBe('/contacts?type=MEMBER'))
  expect(screen.queryByTestId('group-contact-view')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-filter-MEMBER')).toHaveAttribute('aria-current', 'page')
  expect(screen.getByTestId('group-node-10')).not.toHaveAttribute('aria-current')
})

test('같은 그룹을 다시 눌러도 해제되지 않는다(토글 없음)', async () => {
  const { user, location } = renderPage('/contacts', { handlers: contactsHandlers() })
  const node = await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(node)
  await screen.findByTestId('group-contact-view')
  await user.click(screen.getByTestId('group-node-10'))
  expect(location()).toBe('/contacts?group=10')
  expect(screen.getByTestId('group-contact-view')).toBeInTheDocument()
  expect(screen.getByTestId('group-node-10')).toHaveAttribute('aria-current', 'page')
})

test('그룹을 고르면 이전 보기의 타입·조직·직책 필터가 함께 풀리고 검색어는 남는다', async () => {
  const { user, location } = renderPage('/contacts?type=EXTERNAL&organization=삼정&q=이수', {
    handlers: [...contactsHandlers(), http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] }))],
  })
  await user.click(await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98&group=10'))
})

test('사이드바에는 검색창이 없고, 헤더 검색창 앞에 그룹 범위 칩이 보인다', async () => {
  renderPage('/contacts?group=10', { handlers: contactsHandlers() })
  await screen.findByTestId('group-contact-view', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(screen.getByTestId('contact-sidebar')).queryByTestId('contact-search')).not.toBeInTheDocument()
  const header = screen.getByTestId('page-header')
  expect(within(header).getByTestId('contact-search')).toHaveAttribute('placeholder', '이 그룹에서 검색')
  expect(within(header).getByTestId('contact-search-scope')).toHaveTextContent(GROUP_NAME)
})

test('그룹 보기 범위 칩은 그룹 보기에서만 보인다', async () => {
  renderPage('/contacts', { handlers: contactsHandlers() })
  await screen.findByTestId('contact-row-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('contact-search-scope')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-search')).toHaveAttribute('placeholder', '이름·이메일 검색')
})

test('열린 상세가 있을 때 같은 그룹을 다시 눌러도 상세가 닫히지 않는다', async () => {
  const { user, location } = renderPage('/contacts?group=10&contact=member:2', {
    handlers: [...contactsHandlers(), http.get('/api/v1/contacts/members/2', () => HttpResponse.json(memberDetail({ id: 2, name: '이수정' })))],
  })
  const node = await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await screen.findByTestId('group-contact-view')
  await user.click(node)
  expect(location()).toBe('/contacts?group=10&contact=member:2')
})

test('그룹 보기에서 검색해도 쓰지 않는 통합 목록(/contacts?search=)을 부르지 않는다', async () => {
  const searches: (string | null)[] = []
  const { user, location } = renderPage('/contacts?group=10', { handlers: contactsHandlers(searches) })
  await screen.findByTestId('group-member-MEMBER-3', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.type(screen.getByTestId('contact-search'), '회계')
  await waitFor(() => expect(location()).toBe('/contacts?group=10&q=%ED%9A%8C%EA%B3%84'))
  expect(searches).toEqual([])
})

test('그룹 보기에서 검색하면 그 그룹 구성원 안에서만 거르고, 맞는 사람이 없으면 안내한다', async () => {
  const { user, location } = renderPage('/contacts?group=10', { handlers: contactsHandlers() })
  await screen.findByTestId('group-member-MEMBER-3', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.type(screen.getByTestId('contact-search'), '회계')
  // 직책(선임 회계 담당)으로 이수정만 남는다 — 통합 목록(이수민)은 섞이지 않는다.
  await waitFor(() => expect(screen.queryByTestId('group-member-MEMBER-3')).not.toBeInTheDocument())
  expect(screen.getByTestId('group-member-MEMBER-2')).toBeInTheDocument()
  expect(screen.getByText('소속 멤버 중 검색 결과 1명')).toBeInTheDocument()
  expect(screen.queryByTestId('org-chart-view')).not.toBeInTheDocument()
  await waitFor(() => expect(location()).toBe('/contacts?group=10&q=%ED%9A%8C%EA%B3%84'))

  await user.clear(screen.getByTestId('contact-search'))
  await user.type(screen.getByTestId('contact-search'), '없는사람')
  expect(await screen.findByTestId('group-members-empty')).toHaveTextContent('소속 멤버 중 「없는사람」 검색 결과가 없습니다')
})

test('범위 칩을 누르면 그룹 범위만 풀리고 같은 검색어로 전체 연락처를 찾는다', async () => {
  const searches: (string | null)[] = []
  const { user, location } = renderPage('/contacts?group=10&q=이수', { handlers: contactsHandlers(searches) })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(screen.getByRole('button', { name: `${GROUP_NAME} 범위 해제 — 전체에서 찾기` }))
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
  // 전체 목록이 같은 검색어로 조회돼 그룹 밖 사람(이수민)도 보인다.
  expect(await screen.findByTestId('contact-row-MEMBER-9')).toBeInTheDocument()
  expect(searches.at(-1)).toBe('이수')
  expect(screen.queryByTestId('contact-search-scope')).not.toBeInTheDocument()
  expect(screen.getByTestId('contact-search')).toHaveValue('이수')
})

test('검색 결과 아래 「전체에서 찾기」도 그룹 범위를 푼다', async () => {
  const { user, location } = renderPage('/contacts?group=10&q=이수', { handlers: contactsHandlers() })
  await user.click(await screen.findByTestId('group-search-all', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
  expect(await screen.findByTestId('contact-row-MEMBER-9')).toBeInTheDocument()
})
