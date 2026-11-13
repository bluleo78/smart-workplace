// 설정 › 도움말 측정(/settings/help-metrics) — 화면 컴포넌트 테스트(WP-1512).
// 탭·기간 → 요청 파라미터(kind·days), 표 셀, 빈·오류 상태, 사이드바 항목·라우트.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { formatDateTime } from '@/lib/formatters'
import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { renderPage } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'

import HelpMetricsPage from './HelpMetricsPage'

const LAST_AT = '2026-11-12T01:00:00Z'

/** 종류별 응답 행 — 요청 URL 을 모아 파라미터를 단언한다. */
function metricsApi(opts: { empty?: boolean; fail?: boolean } = {}) {
  const urls: URL[] = []
  const handlers = [
    http.get('/api/v1/help/metrics', ({ request }) => {
      const url = new URL(request.url)
      urls.push(url)
      if (opts.fail) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      const kind = url.searchParams.get('kind')
      const days = Number(url.searchParams.get('days'))
      const items = opts.empty
        ? []
        : kind === 'OPEN'
          ? [{ route: '/mail', helpId: 'mail', term: '', count: 3, lastAt: LAST_AT }]
          : kind === 'SEARCH_MISS'
            ? // 서버가 검색어만으로 묶어 경로·도움말은 '' 로 온다
              [{ route: '', helpId: '', term: '토큰 [가림]', count: 2, lastAt: LAST_AT }]
            : [{ route: '', helpId: '', term: '메일 규칙은 어디서 만들어?', count: 4, lastAt: LAST_AT }]
      return HttpResponse.json({ kind, days, items })
    }),
  ]
  return { urls, handlers, last: () => urls.at(-1)?.searchParams }
}

function renderMetrics(opts?: Parameters<typeof metricsApi>[0]) {
  const api = metricsApi(opts)
  const view = renderScreen(<HelpMetricsPage />, { path: '/settings/help-metrics', handlers: api.handlers })
  return { ...view, ...api }
}

test('기본은 화면별 열기 7일 — 요청 파라미터와 행 셀', async () => {
  const { last } = renderMetrics()
  const table = await screen.findByRole('table', { name: '화면별 열기' })
  const row = await within(table).findByRole('row', { name: /\/mail/ })
  const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
  expect(cells).toEqual(['/mail', 'mail', '3', formatDateTime(LAST_AT)])
  expect(last()?.get('kind')).toBe('OPEN')
  expect(last()?.get('days')).toBe('7')
})

test('기간을 30일로 바꾸면 days=30 으로 다시 부른다', async () => {
  const { user, last } = renderMetrics()
  await screen.findByText('/mail')
  await user.click(screen.getByRole('combobox', { name: '기간' }))
  await user.click(await screen.findByRole('option', { name: '30일' }))
  await waitFor(() => expect(last()?.get('days')).toBe('30'))
  expect(last()?.get('kind')).toBe('OPEN')
})

test('결과 없는 검색어 탭은 검색어·횟수·최근만 보인다(도움말 열 없음)', async () => {
  const { user, last } = renderMetrics()
  await screen.findByText('/mail')
  await user.click(screen.getByRole('tab', { name: '결과 없는 검색어' }))
  const table = await screen.findByRole('table', { name: '결과 없는 검색어' })
  const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
  expect(heads).toEqual(['검색어', '횟수', '최근'])
  const row = await within(table).findByRole('row', { name: /토큰 \[가림\]/ })
  const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
  expect(cells).toEqual(['토큰 [가림]', '2', formatDateTime(LAST_AT)])
  expect(last()?.get('kind')).toBe('SEARCH_MISS')
})

test('매뉴얼에서 못 찾은 질문 탭은 질문과 절을 보이고 절이 없으면 - 로 보인다', async () => {
  const { user, last } = renderMetrics()
  await screen.findByText('/mail')
  await user.click(screen.getByRole('tab', { name: '매뉴얼에서 못 찾은 질문' }))
  const table = await screen.findByRole('table', { name: '매뉴얼에서 못 찾은 질문' })
  const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
  expect(heads).toEqual(['질문', '도움말', '횟수', '최근'])
  const row = await within(table).findByRole('row', { name: /메일 규칙은 어디서 만들어\?/ })
  const cells = within(row).getAllByRole('cell')
  expect(cells.map((c) => c.textContent)).toEqual([
    '메일 규칙은 어디서 만들어?',
    '-',
    '4',
    formatDateTime(LAST_AT),
  ])
  expect(cells[0]).toHaveAttribute('title', '메일 규칙은 어디서 만들어?')
  expect(last()?.get('kind')).toBe('AI_GAP')
})

test('선택한 탭의 aria-controls 가 표를 담은 탭 패널을 가리킨다', async () => {
  renderMetrics()
  const table = await screen.findByRole('table', { name: '화면별 열기' })
  const tab = screen.getByRole('tab', { name: '화면별 열기' })
  const panel = screen.getByRole('tabpanel')
  expect(tab).toHaveAttribute('aria-controls', panel.id)
  expect(panel).toContainElement(table)
})

test('비었으면 기록 없음', async () => {
  renderMetrics({ empty: true })
  expect(await screen.findByText('기록 없음')).toBeInTheDocument()
})

test('불러오기 실패면 오류와 다시 시도', async () => {
  renderMetrics({ fail: true })
  const error = await screen.findByTestId('help-metrics-error')
  expect(within(error).getByText('도움말 측정을 불러오지 못함')).toBeInTheDocument()
  expect(within(error).getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
})

test('관리자 사이드바에 도움말 측정 항목이 있고 그 주소로 들어간다', async () => {
  const api = metricsApi()
  renderPage('/settings/help-metrics', { roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], handlers: api.handlers })
  const link = await screen.findByRole('link', { name: '도움말 측정' })
  expect(link).toHaveAttribute('href', '/settings/help-metrics')
  expect(await screen.findByRole('heading', { name: '도움말 측정' })).toBeInTheDocument()
})
