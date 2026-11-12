// 「보고서 만들기」 창(WP-1486) — 종류별 기본 기간(어제·지난주·지난달), 만들기 요청 본문, 409 이미 있음 → 열기/새로 만들기(force),
// 만드는 중 3초 폴링 → 「다 만들었어요」·만든 노트 열기, 실패 토스트·다시 시도, 비서 없음이면 만들 수 없음, 저장 위치, 도움말 대상.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { wikiPagePath } from '@/lib/appUrl'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { renderScreen } from '@/test/renderScreen'
import type { MeReportSettings, MeReportStatus } from '@/types/meReport'

import { CreateReportDialog } from './CreateReportDialog'

// 오늘 = 2026-11-12(목) 12:00 KST.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-12T03:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

function settings(over: Partial<MeReportSettings> = {}): MeReportSettings {
  return {
    dailyEnabled: false,
    timeOfDay: '09:00',
    skipEmpty: true,
    dailyTemplatePageId: 501,
    weeklyTemplatePageId: 502,
    reportsPageId: 500,
    spaceId: 7,
    nextRunAt: null,
    assistantAvailable: true,
    lastError: null,
    ...over,
  }
}

type Respond = (body: Record<string, unknown>, n: number) => Response
interface Options {
  settings?: MeReportSettings
  create?: Respond
  status?: (n: number) => MeReportStatus
}

/** 창을 연 채로 띄운다 — POST 본문·상태 조회 횟수를 모은다. 기본 만들기 응답은 202 {id: 42}. */
function open(opts: Options = {}) {
  const posts: Record<string, unknown>[] = []
  let polls = 0
  const onOpenSettings = vi.fn()
  const create: Respond = opts.create ?? (() => HttpResponse.json({ id: 42, status: 'PENDING' }, { status: 202 }))
  const status = opts.status ?? (() => ({ id: 42, status: 'PENDING', pageId: null, title: null, error: null }) as MeReportStatus)
  const view = renderScreen(<CreateReportDialog open onOpenChange={() => {}} onOpenSettings={onOpenSettings} />, {
    path: '/me/tasks/overview',
    handlers: [
      http.get('/api/v1/me/report-settings', () => HttpResponse.json(opts.settings ?? settings())),
      http.post('/api/v1/me/reports', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        posts.push(body)
        return create(body, posts.length)
      }),
      http.get('/api/v1/me/reports/:id', () => HttpResponse.json(status(++polls))),
    ],
  })
  return { ...view, posts, polls: () => polls, onOpenSettings }
}

const dialog = () => screen.findByRole('dialog', { name: '보고서 만들기' })
const submit = async () => {
  const d = await dialog()
  const btn = await within(d).findByRole('button', { name: '초안 만들기' })
  await waitFor(() => expect(btn).toBeEnabled())
  return btn
}

test('defaults_dailyYesterday_weeklyLastWeek_monthlyLastMonth — 종류마다 기본 기간', async () => {
  const { user } = open()
  const d = await dialog()
  expect(within(d).getByRole('button', { name: '일일' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(d).getByLabelText('날짜')).toHaveValue('2026-11-11')
  await user.click(within(d).getByRole('button', { name: '주간' }))
  expect(within(d).getByRole('combobox', { name: '주' })).toHaveTextContent('11월 2주차 (11/2~8)')
  await user.click(within(d).getByRole('button', { name: '월간' }))
  expect(within(d).getByRole('combobox', { name: '달' })).toHaveTextContent('10월')
})

test('submit_postsKindAndValue — 주간은 weekStart, 일일은 date 를 실어 보낸다', async () => {
  const { user, posts } = open()
  const d = await dialog()
  await user.click(within(d).getByRole('button', { name: '주간' }))
  await user.click(await submit())
  await waitFor(() => expect(posts).toEqual([{ kind: 'WEEKLY', weekStart: '2026-11-02', force: false }]))
})

test('submit_daily — 일일은 고른 날짜(date)로', async () => {
  const { user, posts } = open()
  const d = await dialog()
  fireEvent.change(within(d).getByLabelText('날짜'), { target: { value: '2026-11-09' } })
  await user.click(await submit())
  await waitFor(() => expect(posts).toEqual([{ kind: 'DAILY', date: '2026-11-09', force: false }]))
})

test('conflict_showsExistingWithOpenAndCreateNew — 409 이미 있음 → 열기 링크와 새로 만들기(force)', async () => {
  const { user, posts } = open({
    create: (_b, n) =>
      n === 1
        ? HttpResponse.json({ code: 'REPORT_EXISTS', pageId: 900, title: '11월 11일 (수) 일일 보고' }, { status: 409 })
        : HttpResponse.json({ id: 42, status: 'PENDING' }, { status: 202 }),
  })
  const d = await dialog()
  await user.click(await submit())
  expect(await within(d).findByText('이미 있음 — 11월 11일 (수) 일일 보고')).toBeInTheDocument()
  expect(within(d).getByRole('link', { name: '열기' })).toHaveAttribute('href', wikiPagePath(900))
  await user.click(within(d).getByRole('button', { name: '새로 만들기' }))
  await waitFor(() =>
    expect(posts).toEqual([
      { kind: 'DAILY', date: '2026-11-11', force: false },
      { kind: 'DAILY', date: '2026-11-11', force: true },
    ]),
  )
  expect(await within(d).findByRole('button', { name: /만드는 중…/ })).toBeDisabled()
})

test('polling_doneShowsOpenCreatedNote — 만드는 중 → 3초 뒤 GENERATED → 「다 만들었어요」·만든 노트 열기', async () => {
  const { user } = open({
    status: (n) =>
      n === 1
        ? { id: 42, status: 'PENDING', pageId: null, title: null, error: null }
        : { id: 42, status: 'GENERATED', pageId: 901, title: '11월 11일 (수) 일일 보고', error: null },
  })
  const d = await dialog()
  await user.click(await submit())
  expect(await within(d).findByRole('button', { name: /만드는 중…/ })).toBeDisabled()
  expect(d).toHaveTextContent('1~3분 걸릴 수 있어요')
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(await within(d).findByText('다 만들었어요')).toBeInTheDocument()
  expect(within(d).getByRole('link', { name: '만든 노트 열기' })).toHaveAttribute('href', wikiPagePath(901))
})

test('inProgress_409_pollsReturnedId — 이미 만드는 중이면 그 회차를 이어 폴링한다', async () => {
  const { user, polls } = open({
    create: () => HttpResponse.json({ code: 'REPORT_IN_PROGRESS', id: 42 }, { status: 409 }),
  })
  const d = await dialog()
  await user.click(await submit())
  expect(await within(d).findByRole('button', { name: /만드는 중…/ })).toBeDisabled()
  await waitFor(() => expect(polls()).toBeGreaterThan(0))
})

test('dailyLimit_429_showsServerMessage — 하루 상한이면 서버 문구를 창 안에', async () => {
  const { user } = open({
    create: () => HttpResponse.json({ status: 429, message: '오늘은 더 만들 수 없어요' }, { status: 429 }),
  })
  const d = await dialog()
  await user.click(await submit())
  expect(await within(d).findByText('오늘은 더 만들 수 없어요')).toBeInTheDocument()
  expect(within(d).getByRole('button', { name: '초안 만들기' })).toBeEnabled()
})

test('failed_showsErrorToast — 실패하면 오류 토스트와 「다시 시도」, 다시 시도는 같은 요청을 보낸다', async () => {
  const { user, posts } = open({
    status: () => ({ id: 42, status: 'FAILED', pageId: null, title: null, error: 'AI 응답이 비어 있어요' }),
  })
  const d = await dialog()
  await user.click(await submit())
  expect(await screen.findByText('AI 응답이 비어 있어요')).toBeInTheDocument()
  // 창은 다시 고를 수 있는 상태로 돌아온다.
  expect(await within(d).findByRole('button', { name: '초안 만들기' })).toBeEnabled()
  // 토스트는 모달 바깥(body 의 pointer-events:none 아래)이라 jsdom 에서는 포인터 대신 click 이벤트로 누른다 — 앱 CSS(index.css [data-sonner-toast])가 토스트에 pointer-events:auto 를 준다.
  fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toEqual(posts[0])
})

test('noAssistant_disablesSubmit — 비서가 없으면 경고와 함께 만들 수 없다', async () => {
  open({ settings: settings({ assistantAvailable: false }) })
  const d = await dialog()
  expect(await within(d).findByText('AI 비서가 없어 보고를 만들 수 없어요')).toBeInTheDocument()
  expect(within(d).getByRole('button', { name: '초안 만들기' })).toBeDisabled()
})

test('saveLocation_readOnlyMonthFolder — 저장 위치는 읽기 전용 달 폴더', async () => {
  const { user } = open()
  const d = await dialog()
  const where = within(d).getByTestId('me-report-location')
  expect(where).toHaveTextContent('내 노트 › 보고 › 2026년 11월')
  expect(within(where).queryByRole('textbox')).toBeNull()
  fireEvent.change(within(d).getByLabelText('날짜'), { target: { value: '2026-10-31' } })
  expect(where).toHaveTextContent('내 노트 › 보고 › 2026년 10월')
  await user.click(within(d).getByRole('button', { name: '월간' }))
  expect(where).toHaveTextContent('내 노트 › 보고 › 2026년 10월')
})

test('settingsLink — 아래쪽 「보고서 설정」은 설정 창을 연다(P1)', async () => {
  const { user, onOpenSettings } = open()
  const d = await dialog()
  await user.click(within(d).getByRole('button', { name: '보고서 설정' }))
  expect(onOpenSettings).toHaveBeenCalled()
})

test('helpTarget — 창은 매뉴얼 「내 일일·주간·월간 보고를 받는다」 절(me.reports.create)', async () => {
  open()
  expectHelpTarget(await dialog(), 'me.reports.create')
})

/** 카드처럼 열림을 들고 있는 틀 — Esc 로 창을 닫아도 CreateReportDialog 는 붙은 채 남는다. */
function Harness() {
  const [isOpen, setOpen] = useState(true)
  return <CreateReportDialog open={isOpen} onOpenChange={setOpen} onOpenSettings={() => {}} />
}

test('closedWhileGenerating_toastsDoneWithOpen — 창을 닫아도 폴링이 이어지고, 끝나면 「일일 보고를 만들었어요」 토스트와 열기', async () => {
  let polls = 0
  const { user, location } = renderScreen(<Harness />, {
    path: '/me/tasks/overview',
    handlers: [
      http.get('/api/v1/me/report-settings', () => HttpResponse.json(settings())),
      http.post('/api/v1/me/reports', () => HttpResponse.json({ id: 42, status: 'PENDING' }, { status: 202 })),
      http.get('/api/v1/me/reports/:id', () =>
        HttpResponse.json(
          ++polls === 1
            ? { id: 42, status: 'PENDING', pageId: null, title: null, error: null }
            : { id: 42, status: 'GENERATED', pageId: 901, title: '11월 11일 (수) 일일 보고', error: null },
        ),
      ),
    ],
  })
  const d = await dialog()
  await user.click(await submit())
  await within(d).findByRole('button', { name: /만드는 중…/ })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(await screen.findByText('일일 보고를 만들었어요')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '열기' }))
  await waitFor(() => expect(location()).toBe(wikiPagePath(901)))
})

/** 카드처럼 창을 닫았다 다시 열 수 있는 틀 — 「다시 열기」 단추가 창을 연다. */
function ReopenHarness() {
  const [isOpen, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        다시 열기
      </button>
      <CreateReportDialog open={isOpen} onOpenChange={setOpen} onOpenSettings={() => {}} />
    </>
  )
}

test('reopenAfterMidnight_defaultsFollowNewToday — 카드가 붙은 채 자정을 넘기고 다시 열면 기본 날짜가 새 「어제」다', async () => {
  const { user } = renderScreen(<ReopenHarness />, {
    path: '/me/tasks/overview',
    handlers: [http.get('/api/v1/me/report-settings', () => HttpResponse.json(settings()))],
  })
  const d = await dialog()
  expect(within(d).getByLabelText('날짜')).toHaveValue('2026-11-11')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // 2026-11-13(금) 00:30 KST 로 넘긴다.
  vi.setSystemTime(new Date('2026-11-12T15:30:00Z'))
  await user.click(screen.getByRole('button', { name: '다시 열기' }))
  const reopened = await dialog()
  expect(within(reopened).getByLabelText('날짜')).toHaveValue('2026-11-12')
  expect(within(reopened).getByLabelText('날짜')).toHaveAttribute('max', '2026-11-13')
})
