// 연락처 그룹 보기 브레드크럼(WP-977, 05-page-patterns §B-1 「브레드크럼」) — 페이지 테스트.
// 경로 렌더(시작점 글자 + 조상 링크 + 현재), 조상 링크 이동(q 유지·contact 닫기), 숨은 h1, 개인 그룹의 「내 그룹」 시작점은
// URL 상태·조건부 렌더라 브라우저 없이 판정된다. 폭 부족 접기·겹침은 E2E(@layout, contacts-breadcrumb.spec.ts)가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { member, memberDetail, page } from '../../../e2e/factories/contacts.factory'
import { personalDetail, personalNode, sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

/** 경영지원본부(10) › 경영전략실(11) › 재경팀(12) — 시작점 포함 4단계라 항목 수로는 접히지 않는다. */
const sharedTree = tree({
  shared: [
    sharedNode({
      id: 10,
      name: '경영지원본부',
      children: [
        sharedNode({ id: 11, name: '경영전략실', parentId: 10, children: [sharedNode({ id: 12, name: '재경팀', parentId: 11 })] }),
      ],
    }),
  ],
  personal: [personalNode({ id: 20, name: '자주 연락' })],
})

function handlers() {
  return [
    http.get('/api/v1/user-groups', () => HttpResponse.json(sharedTree)),
    http.get('/api/v1/user-groups/12', () => HttpResponse.json(sharedDetail({ id: 12, name: '재경팀', parentId: 11 }))),
    http.get('/api/v1/user-groups/11', () => HttpResponse.json(sharedDetail({ id: 11, name: '경영전략실', parentId: 10 }))),
    http.get('/api/v1/user-groups/20', () => HttpResponse.json(personalDetail({ id: 20, name: '자주 연락' }))),
    http.get('/api/v1/contacts', () => HttpResponse.json(page([member({ id: 2, name: '이개발' })]))),
    http.get('/api/v1/contacts/members/2', () => HttpResponse.json(memberDetail({ id: 2, name: '이개발' }))),
  ]
}

test('그룹 보기 헤더에 「조직도 › 상위 조직 › 현재 그룹」 경로를 보이고, 화면 이름은 숨은 h1 로 둔다', async () => {
  renderPage('/contacts?group=12', { handlers: handlers() })
  const crumb = await screen.findByTestId('contact-breadcrumb', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const nav = within(crumb)
  // 시작점 「조직도」는 따로 열리는 화면이 없어 링크가 아닌 글자다.
  expect(screen.getByTestId('contact-breadcrumb-root')).toHaveTextContent('조직도')
  expect(nav.queryByRole('link', { name: '조직도' })).not.toBeInTheDocument()
  // 조상은 위에서 아래 순서의 링크, 현재 그룹은 aria-current 글자.
  expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual(['경영지원본부', '경영전략실'])
  expect(screen.getByTestId('contact-breadcrumb-12')).toHaveAttribute('aria-current', 'page')
  expect(screen.getByTestId('contact-breadcrumb-12')).toHaveTextContent('재경팀')
  // 보이는 제목(연락처)은 비우고, 스크린리더 제목은 현재 그룹 이름.
  expect(await screen.findByRole('heading', { level: 1, name: '재경팀' })).toHaveClass('sr-only')
  expect(within(screen.getByTestId('page-header')).queryByText('연락처')).not.toBeInTheDocument()
})

test('조상 링크를 누르면 그 그룹으로 이동하고, 검색어는 이어 가고 열린 상세는 닫는다', async () => {
  const { user, location } = renderPage('/contacts?group=12&q=이&contact=member:2', { handlers: handlers() })
  const crumb = await screen.findByTestId('contact-breadcrumb', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const parent = within(crumb).getByRole('link', { name: '경영전략실' })
  expect(parent).toHaveAttribute('href', '/contacts?group=11&q=%EC%9D%B4')
  await user.click(parent)
  await waitFor(() => expect(location()).toBe('/contacts?group=11&q=%EC%9D%B4'))
  expect(screen.getByTestId('contact-breadcrumb-11')).toHaveAttribute('aria-current', 'page')
})

test('개인 그룹이면 시작점이 「내 그룹」이다', async () => {
  renderPage('/contacts?group=20', { handlers: handlers() })
  await screen.findByTestId('contact-breadcrumb', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.getByTestId('contact-breadcrumb-root')).toHaveTextContent('내 그룹')
  expect(screen.getByTestId('contact-breadcrumb-20')).toHaveAttribute('aria-current', 'page')
})

test('그룹 보기가 아니면 브레드크럼 없이 「연락처」 제목이다', async () => {
  renderPage('/contacts', { handlers: handlers() })
  expect(await screen.findByRole('heading', { level: 1, name: '연락처' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('contact-breadcrumb')).not.toBeInTheDocument()
})
