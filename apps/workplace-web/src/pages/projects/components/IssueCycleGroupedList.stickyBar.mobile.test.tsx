// WP-2070 — 사이클 그룹 목록의 sticky 일괄 작업 바 표지(data-sticky-bulk-bar). 모바일(뷰포트는 파일당 하나라 데스크톱과 나눈다).
// 표지는 슬롯의 scroll-padding(:has) 이 바 높이만큼 위 여백을 줘 Shift+Tab 초점이 바 뒤로 가려지지 않게 하는 근거다. 기하는 E2E(@layout·@input)가 본다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { API, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { mockViewport } from '@/test/viewport'

import { createCycle } from '../../../../e2e/factories/cycle.factory'
import { createIssue } from '../../../../e2e/factories/issue.factory'

const CYCLE = createCycle({ id: 1, name: '스프린트' })

/** 사이클 1개·이슈 1건(전 구간 공통) 화면을 사이클 그룹으로 띄운다. */
async function open() {
  const search = issueSearch(() => [createIssue({ id: 11, number: 11, title: '결제 모듈' })])
  const handlers = [
    ...projectMeta(),
    http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(`${API}/projects/${KEY}/cycles`, () => HttpResponse.json([CYCLE])),
    http.get(`${API}/projects/${KEY}/cycles/progress`, () => HttpResponse.json([])),
    http.get(`${API}/projects/${KEY}/saved-views`, () => HttpResponse.json([])),
    search.handler,
  ]
  const page = renderProjectScreen(`/projects/${KEY}?group=cycle`, { handlers })
  await screen.findAllByTestId('issue-row-11')
  return page
}
const marker = () => document.querySelector('[data-sticky-bulk-bar]')

mockViewport()

test('sticky 바 표지는 모바일에서 선택해도 달리지 않는다', async () => {
  const { user } = await open()
  // 모바일은 체크박스가 없다 — 행 「⋯」→ 액션 시트의 「선택」으로 다중 선택에 들어간다.
  await user.click((await screen.findAllByTestId('issue-row-11-menu'))[0])
  await user.click(await screen.findByTestId('mobile-action-select'))
  await screen.findByTestId('issue-bulk-toolbar')
  expect(marker()).toBeNull()
})
