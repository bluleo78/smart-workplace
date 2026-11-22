// 연락처 그룹 보기에서 조직도 카드를 없앤 것과 사이드바 ⋯ 권한(WP-978) — 페이지 테스트(WP-971).
// 예전 조직도 카드(OrgChartView)를 없애고 가운데엔 소속 멤버만 둔다 — 하위 조직은 왼쪽 트리가 보인다.
// 조직도 관리(⋯)는 ADMIN 만 보인다. 조건부 렌더라 브라우저 없이 판정된다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { nextFrames } from '@/test/nextFrames'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { page } from '../../../e2e/factories/contacts.factory'
import { personalNode, sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

/** 개발본부(10) › 플랫폼팀(11, 하위 1) · 인프라팀(12) › 스토리지 셀(13). */
function handlers() {
  const t = tree({
    shared: [
      sharedNode({
        children: [
          sharedNode({ id: 11, name: '플랫폼팀', parentId: 10, children: [sharedNode({ id: 13, name: '스토리지 셀', parentId: 11 })] }),
          sharedNode({ id: 12, name: '인프라팀', parentId: 10 }),
        ],
      }),
    ],
    personal: [personalNode()],
  })
  return [
    http.get('/api/v1/user-groups', () => HttpResponse.json(t)),
    http.get('/api/v1/user-groups/:id', ({ params }) => HttpResponse.json(sharedDetail({ id: Number(params.id) }))),
    http.get('/api/v1/contacts', () => HttpResponse.json(page([]))),
  ]
}

test('하위 조직이 있어도 가운데엔 조직도 카드·하위 목록 없이 소속 멤버만 보인다', async () => {
  renderPage('/contacts?group=10', { handlers: handlers() })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const view = screen.getByTestId('group-contact-view')
  // 하위 조직은 왼쪽 트리가 보인다 — 가운데에서 다시 그리지 않는다(양동희 2277).
  expect(within(view).queryByText('플랫폼팀')).not.toBeInTheDocument()
  expect(within(view).queryByText('인프라팀')).not.toBeInTheDocument()
  expect(screen.queryByTestId('org-chart-view')).not.toBeInTheDocument()
  expect(screen.getByTestId('group-node-11')).toBeInTheDocument()
})

test('일반 사용자는 조직도 행에 ⋯ 가 없고, 내 그룹 행엔 있다', async () => {
  renderPage('/contacts', { handlers: handlers() })
  await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('org-more-10')).not.toBeInTheDocument()
  expect(screen.getByTestId('group-more-20')).toHaveAccessibleName('내 분류 더보기')
})

test('관리자는 조직도 행마다 ⋯ 가 있다', async () => {
  renderPage('/contacts', { handlers: handlers(), roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE] })
  await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.getByTestId('org-more-10')).toHaveAccessibleName('개발본부 더보기')
  expect(screen.getByTestId('org-more-13')).toBeInTheDocument()
})

/** 그룹 멤버 검색 응답 한 건(WP-1943). */
const hit = (id: number, name: string) => ({
  targetType: 'MEMBER',
  targetId: id,
  name,
  email: `${id}@example.com`,
  title: null,
  organization: null,
  groupId: 11,
  groupPath: ['플랫폼팀'],
})

// WP-1943 — 그룹 보기의 검색 결과 건수를 스크린리더에 알린다(하위 조직 포함 문구 그대로).
test('그룹 검색 결과 건수를 알린다 (WP-1943)', async () => {
  renderPage('/contacts?group=10', {
    handlers: [
      http.get('/api/v1/user-groups/:id/members/search', () => HttpResponse.json([hit(2, '이개발'), hit(3, '최개발')])),
      ...handlers(),
    ],
  })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 채움은 0ms 타이머라 잠시 기다린 뒤에도 비어 있어야 첫 키가 잘못 안내되지 않았음을 보장한다.
  await nextFrames()
  expect(screen.getByTestId('contact-result-status').textContent).toBe('')
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '개발' } })
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('하위 조직 포함 검색 결과 2명'))
})

// WP-1943 — 그룹 검색 결과가 0건이면 빈 결과 문구를 알린다.
test('그룹 검색 결과가 없으면 빈 결과를 알린다 (WP-1943)', async () => {
  renderPage('/contacts?group=10', {
    handlers: [http.get('/api/v1/user-groups/:id/members/search', () => HttpResponse.json([])), ...handlers()],
  })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: 'zzzz' } })
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('검색 결과가 없습니다'))
})

// WP-1943 — 그룹 상세 조회가 실패해 「그룹을 불러오지 못했습니다」가 보이면, 멤버 검색이 성공해도 결과를 알리지 않는다.
test('그룹 상세가 실패하면 검색 결과를 알리지 않는다 (WP-1943)', async () => {
  let searched = false
  renderPage('/contacts?group=10', {
    handlers: [
      http.get('/api/v1/user-groups/:id/members/search', () => {
        searched = true
        return HttpResponse.json([hit(2, '이개발')])
      }),
      http.get('/api/v1/user-groups/:id', () => HttpResponse.json({ message: 'error' }, { status: 500 })),
      ...handlers(),
    ],
  })
  await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '개발' } })
  await waitFor(() => expect(searched).toBe(true))
  // 검색 응답이 반영될 시간을 준 뒤에도 비어 있어야 한다.
  await nextFrames()
  expect(screen.getByTestId('contact-result-status').textContent).toBe('')
})

// WP-1943 리뷰 후속 — 목록↔그룹 갈림에서 안내 영역이 새로 만들어져도 이전 모드의 결과를 이어 알린다.
// (모드 자식으로 갈라 둔 뒤에도 갈림마다 안내가 끊기지 않는지 — announceInitial)
test('그룹에서 나가면 목록 결과를 이어 알린다 (WP-1943 리뷰 후속)', async () => {
  renderPage('/contacts?group=10', {
    handlers: [
      http.get('/api/v1/user-groups/:id/members/search', () => HttpResponse.json([hit(2, '이개발')])),
      http.get('/api/v1/contacts', () => HttpResponse.json(page([]))),
      ...handlers(),
    ],
  })
  await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '개발' } })
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('하위 조직 포함 검색 결과 1명'))
  // 범위 칩 × — 그룹을 풀고 검색어는 남겨 통합 목록에서 같은 말로 찾는다(leaveGroup).
  fireEvent.click(screen.getByTestId('contact-search-scope'))
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('검색 결과가 없습니다'))
})

// WP-1943 리뷰 후속 — 통합 목록에서 검색해도 그룹 멤버 조회가 돌지 않는지 가드한다.
// (분리 전에는 목록 모드에서도 그룹 훅이 호출되던 자리다 — 구조적으로 더는 훅 자체를 부르지 않는다.)
test('통합 목록 검색은 그룹 멤버 조회를 부르지 않는다 (WP-1943 리뷰 후속)', async () => {
  let groupSearched = false
  renderPage('/contacts', {
    handlers: [
      http.get('/api/v1/user-groups/:id/members/search', () => {
        groupSearched = true
        return HttpResponse.json([])
      }),
      ...handlers(),
    ],
  })
  await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '개발' } })
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('검색 결과가 없습니다'))
  await nextFrames()
  expect(groupSearched).toBe(false)
})

// WP-1943 리뷰 후속 — 목록→그룹 갈림(announceInitial 의 반대 방향)에서도 그룹 결과를 곧바로 알린다.
// 목록에서 검색어를 친 뒤 사이드바 그룹을 누르면 q 가 남아(WP-976) 그룹 안내 영역이 첫 키부터 그 결과를 읽어야 한다.
test('목록에서 그룹으로 가면 그룹 결과를 이어 알린다 (WP-1943 리뷰 후속)', async () => {
  renderPage('/contacts', {
    handlers: [
      http.get('/api/v1/user-groups/:id/members/search', () => HttpResponse.json([hit(2, '이개발'), hit(3, '최개발')])),
      ...handlers(),
    ],
  })
  await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '개발' } })
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('검색 결과가 없습니다'))
  fireEvent.click(screen.getByTestId('group-node-10'))
  await waitFor(() => expect(screen.getByTestId('contact-result-status').textContent).toBe('하위 조직 포함 검색 결과 2명'))
})
