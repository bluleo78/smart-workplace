// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 설정 › 감사 로그(/settings/audit-logs) 필터 — 화면 컴포넌트 테스트(WP-971, WP-995).
// facet(액션·리소스) 칩 → 요청 파라미터, 검색·날짜 → 파라미터, 범위 밖·거꾸로 된 날짜 안내(WP-899·WP-910),
// 검색형 사용자 필터 → userId(WP-183)는 필터 입력 → 쿼리 파라미터라 브라우저 없이 판정되므로
// e2e/pages/admin/audit-log-filters.spec.ts · audit-log-user-filter.spec.ts 에서 옮겼다.
// E2E 에 남는 것: 라벨 셀 배선(audit-log-action-resource-labels.spec.ts @wiring), 검색칸 200자 자르기(@input),
// 긴 검색어 빈 결과가 표를 넓히지 않음(@layout), 행 키보드 진입(@input), 깊이 스크롤 뒤 재진입 첫 페이지만(@flow).
// 필터·표가 페이지 컴포넌트 안에 있어 AuditLogListPage 를 renderScreen 으로 띄운다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { createAuditLogs } from '../../../e2e/factories/admin.factory'
import { createMember } from '../../../e2e/factories/auth.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'
import AuditLogListPage from './AuditLogListPage'

/**
 * 감사 로그·구성원 API — 요청 URL 을 모아 파라미터를 단언한다.
 * 구성원은 search 로 거른 결과(최대 20명)를 돌려준다.
 */
function auditApi(members = [
  createMember({ userId: 1, name: '관리자', username: 'admin', email: 'admin@example.com' }),
  createMember({ userId: 2, name: '테스트 사용자', username: 'testuser', email: 'test@example.com' }),
]) {
  const auditUrls: URL[] = []
  const memberUrls: URL[] = []
  const handlers = [
    http.get('/api/v1/admin/audit-logs', ({ request }) => {
      auditUrls.push(new URL(request.url))
      return HttpResponse.json(createPageResponse(createAuditLogs(3)))
    }),
    http.get('/api/v1/members', ({ request }) => {
      const url = new URL(request.url)
      memberUrls.push(url)
      const q = url.searchParams.get('search')?.toLowerCase()
      const hit = q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.username.includes(q)) : members
      return HttpResponse.json(createPageResponse(hit.slice(0, 20), { size: 20, totalElements: hit.length }))
    }),
  ]
  /** 마지막 감사 로그 요청의 파라미터. */
  const lastAudit = () => auditUrls.at(-1)?.searchParams
  return { auditUrls, memberUrls, handlers, lastAudit }
}

/** 화면을 띄우고 첫 목록 요청이 반영될 때까지 기다린다. */
async function renderAudit(members?: Parameters<typeof auditApi>[0]) {
  const api = auditApi(members)
  const view = renderScreen(<AuditLogListPage />, { path: '/settings/audit-logs', handlers: api.handlers })
  await screen.findByTestId('audit-log-total')
  return { ...view, ...api }
}

/** 날짜 칸 값 바꾸기 — type=date 는 키 입력 대신 값을 넣고 change 를 보낸다. */
function setDate(label: '시작 날짜' | '종료 날짜', value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

test('액션 유형 facet 을 고르면 actionType 이 요청에 실리고 칩이 보이며, 칩을 지우면 선택도 풀린다 (#233-A)', async () => {
  const { user, lastAudit } = await renderAudit()
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-actionType'))
  await user.click(await screen.findByTestId('facet-value-actionType-CREATE'))
  await user.keyboard('{Escape}')

  await waitFor(() => expect(lastAudit()?.get('actionType')).toBe('CREATE'))
  expect(screen.getByTestId('filter-chip-actionType')).toBeInTheDocument()

  // 빈 actionType 쿼리는 첫 쿼리와 같은 키라 캐시 적중 → 새 요청이 없을 수 있어, 해제는 facet 선택 상태로 본다.
  await user.click(screen.getByTestId('filter-chip-actionType-remove'))
  await waitFor(() => expect(screen.queryByTestId('filter-chip-actionType')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-actionType'))
  expect(within(await screen.findByTestId('facet-value-actionType-CREATE')).getByRole('checkbox')).not.toBeChecked()
})

test('리소스 facet 을 고르면 resource 가 요청에 실리고 칩이 보인다', async () => {
  const { user, lastAudit } = await renderAudit()
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-resource'))
  await user.click(await screen.findByTestId('facet-value-resource-pipeline'))
  await user.keyboard('{Escape}')

  await waitFor(() => expect(lastAudit()?.get('resource')).toBe('pipeline'))
  expect(screen.getByTestId('filter-chip-resource')).toBeInTheDocument()
})

test('검색어·시작 날짜가 search·startDate 로 실리고, 사용자·결과 필터가 함께 보인다', async () => {
  const { user, lastAudit } = await renderAudit()
  await user.click(screen.getByPlaceholderText('설명으로 검색...'))
  await user.paste('로그인')
  // 디바운스(300ms) 뒤 반영된다.
  await waitFor(() => expect(lastAudit()?.get('search')).toBe('로그인'))

  setDate('시작 날짜', '2026-01-01')
  await waitFor(() => expect(lastAudit()?.has('startDate')).toBe(true))

  expect(screen.getByLabelText('사용자 필터')).toBeInTheDocument()
  expect(screen.getByLabelText('결과 필터')).toBeInTheDocument()
})

test('종료 날짜가 범위 밖 연도여도 화면이 무너지지 않고, 그 날짜는 조건에서 빼고 안내한다 (WP-899)', async () => {
  const { lastAudit } = await renderAudit()
  setDate('종료 날짜', '275760-09-13')

  expect(await screen.findByTestId('audit-log-date-error')).toHaveTextContent('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다')
  expect(screen.getByLabelText('종료 날짜')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByTestId('audit-log-total')).toBeInTheDocument()
  expect(lastAudit()?.has('endDate')).toBe(false)

  // 범위 안 날짜로 고치면 안내가 사라지고 조건으로 보낸다.
  setDate('종료 날짜', '2026-01-31')
  await waitFor(() => expect(screen.queryByTestId('audit-log-date-error')).not.toBeInTheDocument())
  await waitFor(() => expect(lastAudit()?.has('endDate')).toBe(true))
})

test('시작 날짜가 종료 날짜보다 늦으면 기간을 바로잡으라고 안내하고, 고치면 사라진다 (WP-910)', async () => {
  await renderAudit()
  setDate('종료 날짜', '2026-01-10')
  setDate('시작 날짜', '2026-01-20')

  expect(await screen.findByTestId('audit-log-date-error')).toHaveTextContent(
    '시작 날짜가 종료 날짜보다 늦습니다 — 기간을 바로잡아 주세요.',
  )
  expect(screen.getByLabelText('시작 날짜')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('종료 날짜')).toHaveAttribute('aria-describedby', 'audit-log-date-error')

  setDate('시작 날짜', '2026-01-05')
  await waitFor(() => expect(screen.queryByTestId('audit-log-date-error')).not.toBeInTheDocument())
  expect(screen.getByLabelText('시작 날짜')).not.toHaveAttribute('aria-invalid', 'true')
})

test('사용자 필터 — 열기 전엔 구성원을 받지 않고, 검색어로 서버 조회해 고른 사람의 userId 를 싣고, 전체 사용자로 되돌린다 (WP-183)', async () => {
  // 150명 — 예전 Select(100명 상한)라면 150번째는 고를 수 없었다.
  const members = Array.from({ length: 150 }, (_, i) =>
    createMember({ userId: i + 1, name: `구성원${i + 1}`, username: `user${i + 1}` }),
  )
  const { user, memberUrls, lastAudit } = await renderAudit(members)
  expect(memberUrls).toHaveLength(0)

  await user.click(screen.getByRole('combobox', { name: '사용자 필터' }))
  // cmdk 의 빈 label(aria-labelledby)이 jsdom 접근성 이름을 가려 placeholder 로 찾는다.
  await user.click(await screen.findByPlaceholderText('이름·아이디로 검색'))
  await user.paste('구성원150')
  await waitFor(() => expect(memberUrls.at(-1)?.searchParams.get('search')).toBe('구성원150'))
  expect(memberUrls.at(-1)?.searchParams.get('includeInactive')).toBe('true')
  // 후보 목록은 한국어 이름으로 읽힌다(WP-731).
  expect(screen.getByRole('listbox', { name: '사용자 후보' })).toBeInTheDocument()
  await user.click(await screen.findByTestId('audit-user-option-150'))

  expect(screen.getByRole('combobox', { name: '사용자 필터' })).toHaveTextContent(/구성원150/)
  await waitFor(() => expect(lastAudit()?.get('userId')).toBe('150'))

  // 전체 사용자 → userId 파라미터 제거.
  await user.click(screen.getByRole('combobox', { name: '사용자 필터' }))
  await user.click(await screen.findByRole('option', { name: '전체 사용자' }))
  expect(screen.getByRole('combobox', { name: '사용자 필터' })).toHaveTextContent(/전체 사용자/)
  await waitFor(() => expect(lastAudit()?.has('userId')).toBe(false))
})
