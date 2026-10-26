// 프로젝트 설정 「상태」 섹션 — 모바일(WP-809) 페이지 테스트(WP-981).
// 손잡이 대신 ⋯ 시트의 위로/아래로 이동이 보내는 순서 payload·화면 순서 반영, 범주 경계의 비활성 항목과 삭제 불가 이유는
// 브라우저 없이 판정되므로 e2e/pages/mobile/settings-statuses.spec.ts 에서 옮겼다. 삭제 창·긴 이름 행의 기하(@layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { ProjectStatus } from '@/types/projectStatus'

import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { inServerOrder } from '../../../e2e/factories/projectStatus.factory'

mockViewport()

const BASE = '/api/v1/projects/WP'

function statuses(): ProjectStatus[] {
  return [
    { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1, color: 'BLUE' },
    { id: 12, name: '고객사 보안 검토 회신 대기 중(법무팀 확인 필요 건)', category: 'IN_PROGRESS', position: 2, color: 'PURPLE' },
    { id: 13, name: '가'.repeat(30), category: 'IN_PROGRESS', position: 3, color: 'TEAL' },
    { id: 3, name: '완료', category: 'DONE', position: 4, color: 'GREEN' },
    { id: 4, name: '취소', category: 'CANCELED', position: 5, color: 'GRAY' },
  ]
}

/** 설정 화면 — 상태 목록은 서버처럼 순서 변경을 반영해 재조회에 돌려준다. 순서 변경 본문은 orders 에 쌓는다. */
async function open() {
  let list = inServerOrder(statuses())
  const orders: unknown[] = []
  const page = renderPage('/projects/WP/settings', {
    handlers: [
      http.get(BASE, () => HttpResponse.json(createProject())),
      http.get(`${BASE}/members`, () => HttpResponse.json([createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })])),
      http.get(`${BASE}/fields`, () => HttpResponse.json([])),
      http.get(`${BASE}/issues/group-counts`, () =>
        HttpResponse.json({ groupBy: 'statusId', groups: Object.entries({ 1: 4, 2: 1204, 12: 3, 13: 0, 3: 9, 4: 1 }).map(([key, count]) => ({ key, count })) })),
      http.get(`${BASE}/statuses`, () => HttpResponse.json(list)),
      http.put(`${BASE}/statuses/order`, async ({ request }) => {
        const { category, statusIds } = (await request.json()) as { category: string; statusIds: number[] }
        orders.push({ category, statusIds })
        const positions = list.filter((s) => s.category === category).map((s) => s.position).sort((a, b) => a - b)
        list = inServerOrder(list.map((s) => (s.category === category ? { ...s, position: positions[statusIds.indexOf(s.id)] } : s)))
        return HttpResponse.json(list)
      }),
    ],
  })
  await screen.findByTestId('status-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...page, orders }
}

/** 범주 안 행 순서(상태 id). */
const rowIds = (category: string) =>
  Array.from(screen.getByTestId(`status-category-${category}`).querySelectorAll('[data-testid^="status-row-"]')).map((el) =>
    Number(el.getAttribute('data-testid')!.replace('status-row-', '')),
  )

describe('모바일 상태 섹션', () => {
  test('손잡이 없이 ⋯ 시트의 위로/아래로 이동으로 순서를 바꾼다', async () => {
    const { user, orders } = await open()
    // 터치 끌기는 스크롤과 충돌해 손잡이를 그리지 않는다.
    expect(document.querySelector('[data-testid^="status-drag-"]')).toBeNull()
    await user.click(screen.getByTestId('status-menu-13'))
    await user.click(within(await screen.findByTestId('status-row-sheet')).getByTestId('mobile-action-status-move-up'))
    await waitFor(() => expect(orders).toEqual([{ category: 'IN_PROGRESS', statusIds: [2, 13, 12] }]))
    await waitFor(() => expect(rowIds('IN_PROGRESS')).toEqual([2, 13, 12]))

    await waitFor(() => expect(screen.queryByTestId('status-row-sheet')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('status-menu-2'))
    await user.click(within(await screen.findByTestId('status-row-sheet')).getByTestId('mobile-action-status-move-down'))
    await waitFor(() => expect(orders[1]).toEqual({ category: 'IN_PROGRESS', statusIds: [13, 2, 12] }))
  })

  test('범주 경계에서는 이동 항목이 비활성 — 범주 하나뿐인 상태는 삭제도 막고 이유를 보인다', async () => {
    const { user } = await open()
    // 범주 첫 상태 — 위로 비활성, 아래로 가능.
    await user.click(screen.getByTestId('status-menu-2'))
    let sheet = await screen.findByTestId('status-row-sheet')
    expect(within(sheet).getByTestId('mobile-action-status-move-up')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-status-move-down')).toBeEnabled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('status-row-sheet')).not.toBeInTheDocument())
    // 범주 하나뿐인 상태 — 위·아래·삭제 모두 비활성, 삭제 이유가 보인다.
    await user.click(screen.getByTestId('status-menu-3'))
    sheet = await screen.findByTestId('status-row-sheet')
    expect(within(sheet).getByTestId('mobile-action-status-move-up')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-status-move-down')).toBeDisabled()
    expect(within(sheet).getByTestId('mobile-action-status-delete')).toBeDisabled()
    expect(sheet).toHaveTextContent('범주의 마지막 상태는 지울 수 없어요')
  })
})
