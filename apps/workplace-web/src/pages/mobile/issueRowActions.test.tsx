// 모바일 이슈 행 액션 시트·선택 모드(WP-193) — 페이지 테스트(WP-981).
// 시트에서 고른 상태·에픽의 요청 payload, 「선택」/「선택 해제」 라벨 토글, 선택 해제(✕) 뒤 탭 이동, 목록 행이 드래그 소스가 아님은
// 브라우저 없이 판정되므로 e2e/pages/mobile/issue-row-actions.spec.ts 에서 옮겼다. 시트는 길게 누르기와 같은 시트를
// 행의 ⋯ 로 연다 — 길게 누르기 입력 자체(@input)와 선택 바 기하(@layout)는 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`

const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 3, childDoneCount: 1 })
const LONG = createIssue({ id: 21, number: 21, projectKey: KEY, title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류', type: makeTaskType(), status: 'TODO' })
const OTHER = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO' })

type Call = { path: string; body: unknown }

/** 목록·에픽·메타 — status/parent 변경 요청은 calls 에 쌓는다. */
function issueApi() {
  const calls: Call[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(ISSUES, ({ request }) => {
      const sp = new URL(request.url).searchParams
      return HttpResponse.json(createIssueSearchResponse(sp.get('type') === String(makeEpicType().id) ? [EPIC] : [LONG, OTHER], null))
    }),
    // 선택 해제 뒤 탭으로 들어가는 상세(22) — 화면이 뜨는 데 필요한 조회만.
    http.get(`${ISSUES}/22`, () => HttpResponse.json(createIssueDetail({ summary: OTHER }))),
    http.get(`${ISSUES}/22/:sub`, () => HttpResponse.json([])),
    http.all(`${ISSUES}/:num/:sub`, async ({ request, params }) => {
      if (request.method === 'GET' || !['status', 'parent'].includes(params.sub as string)) return undefined
      calls.push({ path: new URL(request.url).pathname, body: await request.json() })
      return HttpResponse.json({})
    }),
  ]
  return { handlers, calls }
}

/** 목록(group=none)을 열고 첫 행이 뜰 때까지 기다린다. */
async function open() {
  const api = issueApi()
  const page = renderPage(`/projects/${KEY}?group=none`, { handlers: api.handlers })
  await screen.findByTestId('issue-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...page, api }
}

/**
 * 길게 누르기 — 손가락을 댄 채 브라우저가 contextmenu 를 보내고(안드로이드·크롬 터치 에뮬레이션과 같은 순서) 뗀다.
 * useLongPressCapture 는 터치 pointerdown 에서 「발동함」 표식을 새로 걸고, contextmenu 로 발동하며, 뗄 때의 click 을 삼킨다.
 * 발동 뒤엔 시트(모달)가 떠 body 가 pointer-events:none 이라 user-event 로는 뗄 수 없어 브라우저가 보내는 순서대로 직접 보낸다.
 */
function longPress(target: HTMLElement) {
  fireEvent.pointerDown(target, { pointerType: 'touch', button: 0 })
  fireEvent.contextMenu(target)
  fireEvent.pointerUp(target, { pointerType: 'touch' })
  fireEvent.click(target)
}

describe('모바일 이슈 행 액션 시트', () => {
  // 상태 시트 선택지는 프로젝트 상태(시드 id 1~4, WP-808) — statusId 로 보낸다.
  test('상태 변경 → 진행 중 → PATCH statusId', async () => {
    const { user, api } = await open()
    await user.click(screen.getByTestId('issue-row-21-menu'))
    await user.click(await screen.findByTestId('mobile-action-status'))
    await user.click(within(await screen.findByTestId('issue-status-picker')).getByTestId('picker-option-2'))
    await waitFor(() => expect(api.calls).toEqual([{ path: `${ISSUES}/21/status`, body: { statusId: 2 } }]))
  })

  test('에픽 지정 → 에픽 선택 → PATCH parent', async () => {
    const { user, api } = await open()
    await user.click(screen.getByTestId('issue-row-21-menu'))
    await user.click(await screen.findByTestId('mobile-action-epic'))
    await user.click(within(await screen.findByTestId('issue-epic-picker')).getByTestId('picker-option-10'))
    await waitFor(() => expect(api.calls).toEqual([{ path: `${ISSUES}/21/parent`, body: { parentNumber: 10 } }]))
  })

  test('모바일 목록 행은 드래그 소스가 아니다(dnd-kit roledescription 없음), 체크박스도 없다', async () => {
    await open()
    expect(screen.getByTestId('issue-row-21')).not.toHaveAttribute('aria-roledescription')
    expect(screen.queryByTestId('select-issue-21')).not.toBeInTheDocument()
  })
})

describe('모바일 선택 모드', () => {
  test('이미 선택된 행을 길게 누르면 「선택 해제」, 누르면 선택이 풀린다', async () => {
    const { user } = await open()
    // 선택 모드에선 ⋯ 가 숨으므로 시트는 길게 누르기로 연다.
    longPress(screen.getByTestId('issue-row-21'))
    expect(await screen.findByTestId('mobile-action-select')).toHaveTextContent(/^선택$/)
    await user.click(screen.getByTestId('mobile-action-select'))
    expect(await screen.findByTestId('issue-bulk-toolbar')).toHaveTextContent('1개 선택')
    longPress(screen.getByTestId('issue-row-21'))
    expect(await screen.findByTestId('mobile-action-select')).toHaveTextContent('선택 해제')
    await user.click(screen.getByTestId('mobile-action-select'))
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
  })

  test('✕(선택 해제, aria-label)로 끝내면 탭이 다시 상세로 이동한다', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('issue-row-21-menu'))
    await user.click(await screen.findByTestId('mobile-action-select'))
    // 선택 중 탭은 이동하지 않고 선택을 늘린다.
    await user.click(within(screen.getByTestId('issue-row-22')).getByText(OTHER.title))
    expect(await screen.findByTestId('issue-bulk-toolbar')).toHaveTextContent('2개 선택')
    expect(location()).toBe(`/projects/${KEY}?group=none`)
    // 상태 「완료」와 혼동되지 않게 텍스트 대신 ✕ 아이콘 + aria-label.
    expect(screen.getByTestId('bulk-clear')).toHaveAttribute('aria-label', '선택 해제')
    await user.click(screen.getByTestId('bulk-clear'))
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
    await user.click(within(screen.getByTestId('issue-row-22')).getByText(OTHER.title))
    // 상세 화면은 지연 로딩 — 라우터가 전환(transition)으로 모듈을 받은 뒤에야 주소가 바뀐다.
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/22`), { timeout: PAGE_LOAD_TIMEOUT })
  })
})
