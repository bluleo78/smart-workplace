// 타임라인 마일스톤(#648) — 페이지 테스트(WP-971, WP-980).
// 레인 칩 렌더·툴바 생성 payload·입력 상한(WP-687)·편집 팝오버(이름 수정·빈 값 거절 #672·409 되돌림 WP-615·삭제·Esc 겹 닫기 WP-698)·
// readOnly 비활성은 브라우저 없이 판정되므로 e2e/pages/projects/timeline-milestones.spec.ts 에서 옮겼다.
// 레인 구분선·칩 위치·차트 밖 칩 숨김·클릭 좌표 → 날짜 환산은 기하라 E2E(@layout)에 남는다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, KEY, milestone, stubCanvas, timelineApi } from '@/test/kits/projects/timeline'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { MilestoneResponse } from '@/types/milestone'

import { createIssue } from '../../../e2e/factories/issue.factory'

stubCanvas()

type Call = { method: string; body: unknown }

/** 타임라인 + 마일스톤 쓰기 목. PATCH 는 patchStatus 가 있으면 그 코드로 거절한다. 쓰기 요청은 calls 에 쌓는다. */
async function open({ viewerIsMember = true, patchStatus }: { viewerIsMember?: boolean; patchStatus?: number } = {}) {
  const calls: Call[] = []
  const api = timelineApi({
    viewerIsMember,
    milestones: [milestone({})],
    issues: [
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 2, title: '연결 이슈', dueDate: '2026-07-10', milestoneId: 1 }),
    ],
  })
  const view = renderPage(`/projects/${KEY}/timeline?period=all`, {
    handlers: [
      http.post(`${API}/milestones`, async ({ request }) => {
        const body = (await request.json()) as Partial<MilestoneResponse>
        calls.push({ method: 'POST', body })
        return HttpResponse.json(milestone({ id: 2, ...body }), { status: 201 })
      }),
      http.patch(`${API}/milestones/1`, async ({ request }) => {
        const body = (await request.json()) as Partial<MilestoneResponse>
        calls.push({ method: 'PATCH', body })
        if (patchStatus) return HttpResponse.json({ status: patchStatus, message: '이미 존재하는 마일스톤 이름입니다: v2 출시' }, { status: patchStatus })
        return HttpResponse.json(milestone({ ...body }))
      }),
      http.delete(`${API}/milestones/1`, () => {
        calls.push({ method: 'DELETE', body: null })
        return new HttpResponse(null, { status: 204 })
      }),
      ...api.handlers,
    ],
  })
  await screen.findByTestId('timeline-gantt', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, calls }
}

/** 칩을 눌러 편집 팝오버를 연다. */
async function openPopover(user: ReturnType<typeof renderPage>['user']) {
  await user.click(await screen.findByTestId('milestone-chip-1'))
  return screen.findByTestId('milestone-edit-popover')
}

describe('타임라인 마일스톤 — 레인·생성', () => {
  // 마일스톤은 SVAR 막대(다이아몬드)가 아니라 상단 레인 칩 + 세로 점선으로 그린다(#648).
  test('상단 레인 칩과 세로 점선으로 그리고 차트 막대로는 그리지 않는다', async () => {
    await open()
    expect(await screen.findByTestId('milestone-chip-1')).toHaveTextContent('v1 출시')
    expect(screen.getByTestId('milestone-vline-1')).toBeInTheDocument()
    expect(document.querySelector('.timeline-gantt-root .wx-bar.wx-milestone')).toBeNull()
  })

  // 툴바 「마일스톤 추가」 → 이름·마감일 → POST payload, 저장 뒤 창이 닫힌다.
  test('툴바 버튼으로 만든다', async () => {
    const { user, calls } = await open()
    await user.click(screen.getAllByTestId('milestone-add-button')[0])
    const dialog = await screen.findByTestId('milestone-form-dialog')
    await user.click(screen.getByTestId('milestone-name-input'))
    await user.paste('v1.0 베타')
    fireEvent.change(screen.getByTestId('milestone-due-date-input'), { target: { value: '2026-07-18' } })
    await user.click(screen.getByTestId('milestone-submit'))
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', body: expect.objectContaining({ name: 'v1.0 베타', dueDate: '2026-07-18' }) }]))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  // WP-687 — 이름(100)·설명(2000)은 서버 상한에서 입력이 멈추고, 상한 그대로 저장된다.
  test('이름·설명은 서버 상한에서 멈추고 그 길이로 저장한다', async () => {
    const { user, calls } = await open()
    await user.click(screen.getAllByTestId('milestone-add-button')[0])
    const name = await screen.findByTestId('milestone-name-input')
    const desc = screen.getByLabelText('마일스톤 설명')
    expect(name).toHaveAttribute('maxlength', '100')
    expect(desc).toHaveAttribute('maxlength', '2000')
    await user.click(name)
    await user.paste('가'.repeat(101))
    expect(name).toHaveValue('가'.repeat(100))
    await user.click(desc)
    await user.paste('나'.repeat(2001))
    expect(desc).toHaveValue('나'.repeat(2000))
    fireEvent.change(screen.getByTestId('milestone-due-date-input'), { target: { value: '2026-07-18' } })
    await user.click(screen.getByTestId('milestone-submit'))
    await waitFor(() => expect((calls[0]?.body as { name: string }).name).toHaveLength(100))
  })
})

describe('타임라인 마일스톤 — 편집 팝오버', () => {
  // 칩 → 팝오버(이름은 입력값, 연결 이슈 링크) → 이름 고치고 blur → PATCH name.
  test('칩 클릭 → 이름 수정이 blur 에 저장된다', async () => {
    const { user, calls } = await open()
    const popover = await openPopover(user)
    const name = screen.getByTestId('milestone-popover-name-input')
    expect(name).toHaveValue('v1 출시')
    expect(popover).toHaveTextContent('연결된 이슈 1개 보기')
    expect(screen.getByTestId('milestone-linked-issues-link')).toHaveAttribute('href', `/projects/${KEY}?milestone=1`)
    await user.clear(name)
    await user.paste('v1 최종 출시')
    act(() => name.blur())
    await waitFor(() => expect(calls).toEqual([{ method: 'PATCH', body: expect.objectContaining({ name: 'v1 최종 출시' }) }]))
  })

  // WP-687 — 팝오버 이름도 100자 상한.
  test('팝오버 이름도 100자에서 멈추고 그 길이로 저장한다', async () => {
    const { user, calls } = await open()
    await openPopover(user)
    const name = screen.getByTestId('milestone-popover-name-input')
    await user.clear(name)
    await user.paste('다'.repeat(101))
    expect(name).toHaveValue('다'.repeat(100))
    act(() => name.blur())
    await waitFor(() => expect((calls[0]?.body as { name: string }).name).toHaveLength(100))
  })

  // #672 — 이름을 비우고 blur 하면 요청 없이 오류 토스트 + 원래 값.
  test('이름을 비우면 저장하지 않고 원래 값으로 되돌린다', async () => {
    const { user, calls } = await open()
    await openPopover(user)
    const name = screen.getByTestId('milestone-popover-name-input')
    await user.clear(name)
    act(() => name.blur())
    expect(await screen.findByText('마일스톤 이름은 비울 수 없습니다.')).toBeInTheDocument()
    expect(name).toHaveValue('v1 출시')
    expect(calls).toHaveLength(0)
  })

  // WP-615 — 서버가 이름 변경을 409 로 거절하면 서버 문구 토스트 + 입력칸을 원래 이름으로.
  test('이름 변경 409 → 서버 문구 + 원래 이름', async () => {
    const { user, calls } = await open({ patchStatus: 409 })
    await openPopover(user)
    const name = screen.getByTestId('milestone-popover-name-input')
    await user.clear(name)
    await user.paste('v2 출시')
    act(() => name.blur())
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(await screen.findByText('이미 존재하는 마일스톤 이름입니다: v2 출시')).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveValue('v1 출시'))
  })

  // #672 — 마감일을 비우고 blur 하면 요청 없이 오류 토스트 + 원래 값.
  test('마감일을 비우면 저장하지 않고 원래 값으로 되돌린다', async () => {
    const { user, calls } = await open()
    await openPopover(user)
    const due = screen.getByTestId('milestone-popover-due-date-input')
    fireEvent.change(due, { target: { value: '' } })
    fireEvent.blur(due)
    expect(await screen.findByText('마감일은 비울 수 없습니다.')).toBeInTheDocument()
    expect(due).toHaveValue('2026-08-01')
    expect(calls).toHaveLength(0)
  })

  // 삭제는 연결 해제 영향을 알리는 확인 창을 거쳐 DELETE.
  test('삭제는 확인 창(연결 해제 안내)을 거쳐 DELETE 한다', async () => {
    const { user, calls } = await open()
    await openPopover(user)
    await user.click(screen.getByTestId('milestone-delete-trigger'))
    expect(await screen.findByText(/연결된 이슈 1개의 연결이 해제됩니다/)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '삭제' })
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', body: null }]))
  })

  // WP-698 — 확인 창을 Esc 로 닫으면 확인 창만 닫히고 팝오버는 남는다. 한 번 더 Esc 면 팝오버도 닫힌다.
  test('삭제 확인 창 Esc 는 확인 창만 닫는다', async () => {
    const { user } = await open()
    await openPopover(user)
    await user.click(screen.getByTestId('milestone-delete-trigger'))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('milestone-edit-popover')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('milestone-edit-popover')).not.toBeInTheDocument())
  })
})

describe('타임라인 마일스톤 — readOnly(비멤버)', () => {
  // 비멤버는 추가 버튼이 없고, 레인 빈 곳 클릭도 생성 창을 열지 않는다.
  test('추가 버튼이 없고 레인 클릭이 생성 창을 열지 않는다', async () => {
    const { user } = await open({ viewerIsMember: false })
    expect(screen.queryByTestId('milestone-add-button')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('milestone-lane'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // 비멤버는 칩을 눌러도 편집 팝오버가 열리지 않는다.
  test('칩 클릭이 편집 팝오버를 열지 않는다', async () => {
    const { user } = await open({ viewerIsMember: false })
    await user.click(await screen.findByTestId('milestone-chip-1'))
    expect(screen.queryByTestId('milestone-edit-popover')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
