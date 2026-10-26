// 모바일 필터 시트의 「완료일」 필터(WP-873) — 페이지 테스트(WP-971, WP-981).
// 「＋ 필터」 목록의 완료일 항목·프리셋 선택 → URL(closedIn) → 칩 라벨은 브라우저 없이 판정되므로
// e2e/pages/mobile/issue-closed-filter.spec.ts 에서 옮겼다. 짧은 휴대폰에서 목록·달력이 잘리지 않는지(@layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

// 휴대폰 폭 — 필터는 칩 줄의 「필터」 → 바텀시트로 연다.
mockViewport()

const KEY = 'WP'

// 「지난 주」 기간 라벨이 날짜에 묶이므로 오늘을 2026-10-23(금, KST)로 고정한다. 타이머는 그대로 둬 MSW·React 가 돈다.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
})
afterAll(() => {
  vi.useRealTimers()
})

describe('모바일 필터 시트 — 완료일', () => {
  test('「＋ 필터」 목록에 완료일이 1건 있고, 프리셋을 고르면 URL 에 closedIn 이 실리고 칩이 생긴다', async () => {
    // 완료일 facet 이 목록에 한 번만 있고(중복 등록 회귀), 고른 프리셋이 URL 상태·칩 라벨(기간 포함)로 이어진다.
    const { user, location } = renderPage(`/projects/${KEY}`, {
      handlers: [
        http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
        http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
        http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([createIssue({ number: 7 })], null))),
      ],
    })
    await user.click(await screen.findByTestId('mobile-chip-filter', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    const sheet = await screen.findByTestId('mobile-filter-sheet')
    await user.click(within(sheet).getByTestId('add-filter-trigger'))
    const facets = await screen.findAllByTestId('add-filter-facet-closedIn')
    expect(facets).toHaveLength(1)
    expect(facets[0]).toHaveTextContent('완료일')
    await user.click(facets[0])
    await user.click(await screen.findByTestId('facet-value-closedIn-last-week'))
    await waitFor(() => expect(location()).toMatch(/closedIn=last-week/))
    expect(await within(screen.getByTestId('mobile-filter-sheet')).findByTestId('filter-chip-closedIn')).toHaveTextContent(
      '완료일:지난 주 (10/12–10/18)',
    )
  })
})
