// 연락처 목록 행 재렌더 방지(WP-1948) — 300행에서 상호작용 한 번이 모든 행을 다시 그리던 비용을 막는다(테스트는 30행으로 같은 성질을 본다).
// 행 하나가 그려질 때 useToggleFavorite 가 한 번 불리므로, 그 호출 횟수를 행 렌더 횟수로 쓴다(제품 코드에 테스트용 코드 없음).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { member, page } from '../../../e2e/factories/contacts.factory'

// 행 렌더 카운터 — 원래 훅 동작은 그대로 두고 호출 횟수만 센다.
const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/hooks/queries/useFavoriteMutations', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/queries/useFavoriteMutations')>()
  return {
    ...orig,
    useToggleFavorite: () => {
      renders.count += 1
      return orig.useToggleFavorite()
    },
  }
})

// 페이지 렌더 카운터 — useContacts 는 ContactsPage 본문에서만 불리는(메모 안 된) 훅이라 호출 횟수 = 페이지 렌더 횟수다.
// 행이 memo 여서 행 카운터만으로는 draft 가 페이지로 되돌아가도 잡히지 않으므로 페이지 렌더를 따로 센다.
const pageRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/hooks/queries/useContacts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/queries/useContacts')>()
  return {
    ...orig,
    useContacts: (...args: Parameters<typeof orig.useContacts>) => {
      pageRenders.count += 1
      return orig.useContacts(...args)
    },
  }
})

const ROWS = 30
const rows = (favoriteId?: number) =>
  Array.from({ length: ROWS }, (_, i) => member({ id: i + 1, name: `사람${i + 1}`, email: `p${i + 1}@example.com`, isFavorite: i + 1 === favoriteId }))

const baseHandlers = [http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({}, { status: 404 }))]

function listHandlers(favoriteId?: number) {
  return [http.get('/api/v1/contacts', () => HttpResponse.json(page(rows(favoriteId)))), ...baseHandlers]
}

beforeEach(() => {
  renders.count = 0
  pageRenders.count = 0
})

test('행을 하나 선택해도 다른 행은 다시 그리지 않는다', async () => {
  const { user, location } = renderPage('/contacts', { handlers: listHandlers() })
  await screen.findByTestId(`contact-row-MEMBER-${ROWS}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
  renders.count = 0
  const btn = screen.getByTestId('contact-row-MEMBER-3').querySelector('button') as HTMLButtonElement
  await user.click(btn)
  await waitFor(() => expect(decodeURIComponent(location())).toContain('contact=member:3'))
  // 새로 active 가 된 행 1개 + 상세 패널(같은 훅을 부른다)의 몇 번 렌더만 허용 — 30행 전부(>=30)가 아님을 본다.
  expect(renders.count).toBeLessThanOrEqual(5)
})

test('다른 행을 연달아 누르면 상세가 마지막 행으로 바뀐다', async () => {
  const { user, location } = renderPage('/contacts', { handlers: listHandlers() })
  await screen.findByTestId(`contact-row-MEMBER-${ROWS}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(screen.getByTestId('contact-row-MEMBER-2').querySelector('button') as HTMLButtonElement)
  await user.click(screen.getByTestId('contact-row-MEMBER-5').querySelector('button') as HTMLButtonElement)
  await waitFor(() => expect(decodeURIComponent(location())).toContain('contact=member:5'))
})

test('별 토글 뒤 그 행만 다시 그리고 별 상태가 바뀐다', async () => {
  let favoriteId: number | undefined
  const handlers = [
    http.get('/api/v1/contacts', () => HttpResponse.json(page(rows(favoriteId)))),
    http.post('/api/v1/contacts/favorites', () => {
      favoriteId = 4
      return new HttpResponse(null, { status: 204 })
    }),
    ...baseHandlers,
  ]
  const { user } = renderPage('/contacts', { handlers })
  await screen.findByTestId(`contact-row-MEMBER-${ROWS}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
  renders.count = 0
  await user.click(screen.getByTestId('contact-fav-MEMBER-4'))
  await waitFor(() => expect(screen.getByTestId('contact-fav-MEMBER-4')).toHaveAttribute('aria-pressed', 'true'))
  expect(renders.count).toBeLessThan(5)
})

test('행에 content-visibility 가 걸린다', async () => {
  renderPage('/contacts', { handlers: listHandlers() })
  const row = await screen.findByTestId('contact-row-MEMBER-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(row.className).toContain('[content-visibility:auto]')
})

test('검색 키 입력은 목록 행을 다시 그리지 않는다', async () => {
  renderPage('/contacts', { handlers: listHandlers() })
  await screen.findByTestId(`contact-row-MEMBER-${ROWS}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
  renders.count = 0
  pageRenders.count = 0
  const input = screen.getByTestId('contact-search') as HTMLInputElement
  // debounce(300ms) 전에 확인한다 — draft 상태가 입력칸 안에만 있어 페이지·행이 다시 그려지지 않아야 한다.
  fireEvent.change(input, { target: { value: '사' } })
  expect(input.value).toBe('사')
  // draft 가 페이지 상태로 돌아오면 키 입력마다 페이지가 다시 그려져 이 값이 1 이상이 된다.
  expect(pageRenders.count).toBe(0)
  expect(renders.count).toBe(0)
})

test('빈 상태의 검색어 지우기가 입력칸을 바로 비운다', async () => {
  const handlers = [http.get('/api/v1/contacts', () => HttpResponse.json(page([]))), ...baseHandlers]
  const { user, location } = renderPage('/contacts?q=없음', { handlers })
  const clear = await screen.findByTestId('contact-empty-clear-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect((screen.getByTestId('contact-search') as HTMLInputElement).value).toBe('없음')
  await user.click(clear)
  await waitFor(() => expect((screen.getByTestId('contact-search') as HTMLInputElement).value).toBe(''))
  expect(location()).not.toContain('q=')
})
