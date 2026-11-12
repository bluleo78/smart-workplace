// 프로젝트 설정 「리포트」 주간 리포트 줄(WP-1483) — 켬/끔·주기·요일·시각을 바꾸면 바로 PUT, 템플릿 링크는 노트 탭,
// 「기본으로 되돌리기」는 확인 창 뒤 POST, 관리 권한이 없으면 읽기 전용, 저장 실패면 토스트와 함께 이전 값으로 되돌림.
import { screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { ReportSettings } from '@/pages/projects/components/ReportSettings'
import { renderScreen } from '@/test/renderScreen'
import type { ProjectReportSettings } from '@/types/projectReport'

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}/report-settings`

/** 서버 기본값(꺼짐·매주·월요일·09:00) — 템플릿은 한 번 켠 적이 있어 페이지가 있다. */
function settings(over: Partial<ProjectReportSettings> = {}): ProjectReportSettings {
  return {
    enabled: false,
    cadence: 'WEEKLY',
    weekday: 'MONDAY',
    timeOfDay: '09:00',
    templatePageId: 321,
    nextRunAt: null,
    canManage: true,
    ...over,
  }
}

/** 줄을 띄운다 — PUT 바디·POST 횟수를 모아 돌려준다. putStatus 가 있으면 PUT 은 그 상태로 실패한다. */
function open(initial: ProjectReportSettings, { canManage = true, putStatus }: { canManage?: boolean; putStatus?: number } = {}) {
  const puts: unknown[] = []
  let resets = 0
  const view = renderScreen(<ReportSettings projectKey={KEY} canManage={canManage} />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.get(BASE, () => HttpResponse.json(initial)),
      http.put(BASE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        puts.push(body)
        if (putStatus) return HttpResponse.json({ message: '저장할 수 없어요' }, { status: putStatus })
        return HttpResponse.json({ ...initial, ...body, nextRunAt: body.enabled ? '2026-11-16T00:00:00Z' : null })
      }),
      http.post(`${BASE}/template/reset`, () => {
        resets += 1
        return HttpResponse.json(initial)
      }),
    ],
  })
  return { ...view, puts, resetCount: () => resets }
}

const toggle = () => screen.getByRole('switch', { name: '주간 리포트' })
const combo = (name: string) => screen.getByRole('combobox', { name })

/** 선택 상자를 열어 보기를 고른다(키보드 — jsdom 에서 포인터로 연 Radix 목록은 불안정). */
async function choose(user: UserEvent, comboName: string, option: string) {
  combo(comboName).focus()
  await user.keyboard('{Enter}')
  const opt = await screen.findByRole('option', { name: option })
  opt.focus()
  await user.keyboard('{Enter}')
}

test('showsDefaults — 꺼짐, 매주·월요일·09:00, 저장 위치를 보인다', async () => {
  open(settings())
  expect(await screen.findByRole('switch', { name: '주간 리포트' })).not.toBeChecked()
  expect(combo('리포트 주기')).toHaveTextContent('매주')
  expect(combo('리포트 요일')).toHaveTextContent('월요일')
  expect(combo('리포트 시각')).toHaveTextContent('09:00')
  expect(screen.getByText('프로젝트 노트 › 리포트')).toBeInTheDocument()
})

test('toggleOn_savesImmediately — 켜면 네 값을 모두 실어 PUT 하고 다음 리포트 시각을 보인다', async () => {
  const { user, puts } = open(settings())
  await user.click(await screen.findByRole('switch', { name: '주간 리포트' }))
  await waitFor(() => expect(puts).toEqual([{ enabled: true, cadence: 'WEEKLY', weekday: 'MONDAY', timeOfDay: '09:00' }]))
  await waitFor(() => expect(toggle()).toBeChecked())
  expect(await screen.findByText(/다음 리포트 .*11월 16일 \(월\) 09:00/)).toBeInTheDocument()
})

test('changeCadence_saves — 격주를 고르면 cadence BIWEEKLY 로 PUT 한다', async () => {
  const { user, puts } = open(settings({ enabled: true, nextRunAt: '2026-11-16T00:00:00Z' }))
  await screen.findByRole('switch', { name: '주간 리포트' })
  await choose(user, '리포트 주기', '격주')
  await waitFor(() => expect(puts).toEqual([{ enabled: true, cadence: 'BIWEEKLY', weekday: 'MONDAY', timeOfDay: '09:00' }]))
  await waitFor(() => expect(combo('리포트 주기')).toHaveTextContent('격주'))
})

test('요일·시각을 바꿔도 바로 PUT 한다', async () => {
  const { user, puts } = open(settings({ enabled: true }))
  await screen.findByRole('switch', { name: '주간 리포트' })
  await choose(user, '리포트 요일', '금요일')
  await waitFor(() => expect(puts).toHaveLength(1))
  await choose(user, '리포트 시각', '18:00')
  await waitFor(() =>
    expect(puts).toEqual([
      { enabled: true, cadence: 'WEEKLY', weekday: 'FRIDAY', timeOfDay: '09:00' },
      { enabled: true, cadence: 'WEEKLY', weekday: 'FRIDAY', timeOfDay: '18:00' },
    ]),
  )
})

test('templateLink_opensNotesTab — 템플릿 이름과 「노트에서 고치기」는 노트 탭의 템플릿 페이지로 간다', async () => {
  open(settings())
  const edit = await screen.findByRole('link', { name: '노트에서 고치기' })
  expect(edit).toHaveAttribute('href', `/projects/${KEY}/notes/321`)
  expect(screen.getByRole('link', { name: /템플릿 · 주간 리포트/ })).toHaveAttribute('href', `/projects/${KEY}/notes/321`)
})

test('템플릿이 아직 없으면 링크 대신 「켜면 노트에 만들어요」', async () => {
  open(settings({ templatePageId: null }))
  expect(await screen.findByText('켜면 노트에 만들어요')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '노트에서 고치기' })).not.toBeInTheDocument()
  // 되돌릴 템플릿이 없으니 되돌리기도 없다(켜면 서버가 기본 템플릿을 복사한다).
  expect(screen.queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
})

test('고른 뒤 저장하는 동안에도 키보드 초점이 그 선택 상자에 남는다', async () => {
  // 저장 응답을 붙잡아 「저장 중」 상태를 만든다 — 그동안 선택 상자를 disabled 로 잠그면 초점이 body 로 떨어진다.
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const initial = settings({ enabled: true })
  const puts: unknown[] = []
  const { user } = renderScreen(<ReportSettings projectKey={KEY} canManage />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.get(BASE, () => HttpResponse.json(initial)),
      http.put(BASE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        puts.push(body)
        await gate
        return HttpResponse.json({ ...initial, ...body })
      }),
    ],
  })
  await screen.findByRole('switch', { name: '주간 리포트' })
  await choose(user, '리포트 요일', '금요일')
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(combo('리포트 요일')).toHaveFocus()
  expect(combo('리포트 요일')).not.toBeDisabled()

  // 저장 중에 또 고르면 무시한다(요청 순서가 엇갈리지 않게) — 두 번째 PUT 이 나가지 않는다.
  await choose(user, '리포트 시각', '18:00')
  expect(puts).toHaveLength(1)

  release()
  await waitFor(() => expect(combo('리포트 요일')).toHaveTextContent('금요일'))
  // 무시한 고르기는 화면에 남지 않고, 초점은 마지막에 연 선택 상자에 그대로 있다.
  expect(combo('리포트 시각')).toHaveTextContent('09:00')
  expect(combo('리포트 시각')).toHaveFocus()
})

test('reset_confirmDialogCopy — 확인 창 문구, 「취소」는 요청 없음, 「되돌리기」는 POST', async () => {
  const { user, resetCount } = open(settings())
  await user.click(await screen.findByRole('button', { name: '기본으로 되돌리기' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('템플릿을 기본으로 되돌릴까요?')
  expect(dialog).toHaveTextContent(
    '지금 템플릿 내용을 제품 기본 샘플과 지시로 바꿉니다. 지금 내용은 노트의 수정 기록에서 다시 꺼낼 수 있어요.',
  )
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(resetCount()).toBe(0)

  await user.click(screen.getByRole('button', { name: '기본으로 되돌리기' }))
  await user.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(resetCount()).toBe(1))
  expect(await screen.findByText('템플릿을 기본으로 되돌렸어요')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('readOnly_whenCannotManage — 컨트롤이 비활성이고 되돌리기가 없다', async () => {
  const { user, puts } = open(settings({ canManage: false }), { canManage: false })
  expect(await screen.findByRole('switch', { name: '주간 리포트' })).toBeDisabled()
  expect(combo('리포트 주기')).toBeDisabled()
  expect(combo('리포트 요일')).toBeDisabled()
  expect(combo('리포트 시각')).toBeDisabled()
  expect(screen.queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
  // 템플릿 보기는 누구나 — 노트 권한은 노트가 정한다.
  expect(screen.getByRole('link', { name: '노트에서 고치기' })).toBeInTheDocument()
  await user.click(toggle())
  expect(puts).toEqual([])
})

test('서버가 canManage=false 로 주면(개인 프로젝트 등) 부모가 관리자라고 해도 읽기 전용', async () => {
  open(settings({ canManage: false }))
  expect(await screen.findByRole('switch', { name: '주간 리포트' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
})

test('controlsDisabledWhileOff — 꺼져 있으면 주기·요일·시각이 비활성', async () => {
  open(settings({ enabled: false }))
  await screen.findByRole('switch', { name: '주간 리포트' })
  expect(combo('리포트 주기')).toBeDisabled()
  expect(combo('리포트 요일')).toBeDisabled()
  expect(combo('리포트 시각')).toBeDisabled()
})

test('saveError_showsToastAndRestores — 저장이 실패하면 오류 토스트와 함께 꺼짐으로 되돌린다', async () => {
  const { user, puts } = open(settings(), { putStatus: 500 })
  await user.click(await screen.findByRole('switch', { name: '주간 리포트' }))
  await waitFor(() => expect(puts).toHaveLength(1))
  expect(await screen.findByText('저장할 수 없어요')).toBeInTheDocument()
  await waitFor(() => expect(toggle()).not.toBeChecked())
})
