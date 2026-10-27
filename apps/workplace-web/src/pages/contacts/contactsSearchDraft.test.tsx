// 연락처 헤더 검색 draft·상세 유지(WP-999) — 페이지 테스트(WP-971).
// ① debounce 로 URL ?q 를 쓴 순간과 다시 렌더되는 사이에 더 친 글자가, 되돌아온 옛 q 로 덮여 지워지지 않는다.
// ② 그룹 보기는 구성원을 화면에서 거를 뿐이라 검색어를 바꿔도 열린 상세(?contact)를 닫지 않는다(통합 목록은 WP-206 대로 닫는다).
// 둘 다 URL 상태·입력값이라 브라우저 없이 판정된다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { member, memberDetail, page } from '../../../e2e/factories/contacts.factory'
import { sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

afterEach(() => {
  vi.useRealTimers()
})

const handlers = [
  http.get('/api/v1/user-groups', () => HttpResponse.json(tree({ shared: [sharedNode({ name: '경영지원본부 재경팀' })] }))),
  http.get('/api/v1/user-groups/10', () =>
    HttpResponse.json(
      sharedDetail({
        name: '경영지원본부 재경팀',
        members: [
          { targetType: 'MEMBER', targetId: 2, name: '이수정', email: 'sujung.lee@example.com', title: '선임 회계 담당', organization: null },
          { targetType: 'MEMBER', targetId: 3, name: '박민준', email: 'minjun.park@example.com', title: '세무 담당', organization: null },
        ],
      }),
    ),
  ),
  http.get('/api/v1/contacts', () => HttpResponse.json(page([member({ id: 2, name: '이수정' })]))),
  http.get('/api/v1/contacts/members/2', () => HttpResponse.json(memberDetail({ id: 2, name: '이수정' }))),
]

test('debounce 로 q 를 쓰는 사이에 더 친 글자가 남는다', async () => {
  const { location } = renderPage('/contacts', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 페이지가 뜬 뒤에만 setTimeout 을 가짜로 바꿔 debounce 가 끝나는 순간을 정확히 잡는다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.change(input, { target: { value: '이수' } })
  // 300ms 가 지나 URL 에 「이수」를 쓰는 바로 그 사이에 「정」을 더 친다 — 한 번에 반영돼 그 순서를 재현한다.
  act(() => {
    vi.advanceTimersByTime(300)
    fireEvent.change(input, { target: { value: '이수정' } })
  })
  expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98')
  expect(input).toHaveValue('이수정')

  // 다음 debounce 가 끝나면 마지막 입력이 URL 에 들어간다.
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98%EC%A0%95')
  expect(input).toHaveValue('이수정')
})

test('내가 쓴 q 의 메아리를 건너뛴 뒤에도, 바깥 이동으로 q 가 바뀌면 검색창이 그 값을 따른다', async () => {
  const { user, location } = renderPage('/contacts', { handlers })
  const input = await screen.findByTestId('contact-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.type(input, '박')
  await waitFor(() => expect(location()).toBe('/contacts?q=%EB%B0%95'))
  // 앱 레일의 「연락처」(/contacts — q 없음)로 바깥에서 q 를 지운다 — 검색창도 비워져야 한다.
  await user.click(screen.getByTestId('rail-link-/contacts'))
  await waitFor(() => expect(location()).toBe('/contacts'))
  expect(input).toHaveValue('')
})

test('그룹 보기에서 검색어를 바꿔도 열린 상세가 닫히지 않는다', async () => {
  const { location } = renderPage('/contacts?group=10&contact=member:2', { handlers })
  await screen.findByTestId('group-member-MEMBER-3', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(await screen.findByTestId('contact-detail-member')).toBeInTheDocument()

  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '이수' } })
  await waitFor(() => expect(location()).toBe('/contacts?group=10&contact=member%3A2&q=%EC%9D%B4%EC%88%98'))
  expect(screen.getByTestId('contact-detail-member')).toBeInTheDocument()
  expect(screen.getByTestId('group-member-MEMBER-2')).toBeInTheDocument()
})

test('통합 목록에서는 검색어를 바꾸면 열린 상세를 닫는다(WP-206 유지)', async () => {
  const { location } = renderPage('/contacts?contact=member:2', { handlers })
  expect(await screen.findByTestId('contact-detail-member', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()

  fireEvent.change(screen.getByTestId('contact-search'), { target: { value: '이수' } })
  await waitFor(() => expect(location()).toBe('/contacts?q=%EC%9D%B4%EC%88%98'))
  expect(screen.queryByTestId('contact-detail-member')).not.toBeInTheDocument()
})
