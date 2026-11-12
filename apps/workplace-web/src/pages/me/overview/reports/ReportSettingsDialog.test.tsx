// 「보고서 설정」 창(WP-1486) — 일일 보고 켬·시각·건너뜀을 바꾸면 바로 PUT(세 값 모두), 켜 두면 「다음 보고 …」,
// 템플릿 링크(없으면 「켜면 노트에 만들어요」, 켜진 채 지웠으면 「다음 보고 때 다시 만들어요」), 비서 없음 경고, 「기본으로 되돌리기」 없음(P11), 도움말 대상.
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { wikiPagePath } from '@/lib/appUrl'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { renderScreen } from '@/test/renderScreen'
import type { MeReportSettings } from '@/types/meReport'

import { ReportSettingsDialog } from './ReportSettingsDialog'

const BASE = '/api/v1/me/report-settings'

/** 서버 기본값(꺼짐·09:00·건너뜀 켬) — 템플릿은 한 번 켠 적이 있어 페이지가 있다. */
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

/** 창을 연 채로 띄운다 — PUT 바디를 모은다. 켜진 저장 응답에는 다음 보고 시각(11-13 09:00 KST)을 싣는다. */
function open(initial: MeReportSettings) {
  const puts: unknown[] = []
  const view = renderScreen(<ReportSettingsDialog open onOpenChange={() => {}} />, {
    path: '/me/tasks/overview',
    handlers: [
      http.get(BASE, () => HttpResponse.json(initial)),
      http.put(BASE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        puts.push(body)
        return HttpResponse.json({ ...initial, ...body, nextRunAt: body.dailyEnabled ? '2026-11-13T00:00:00Z' : null })
      }),
    ],
  })
  return { ...view, puts }
}

const dialog = () => screen.findByRole('dialog', { name: '보고서 설정' })

/** 선택 상자를 열어 보기를 고른다(키보드 — jsdom 에서 포인터로 연 Radix 목록은 불안정). */
async function choose(user: UserEvent, comboName: string, option: string) {
  const combo = await screen.findByRole('combobox', { name: comboName })
  combo.focus()
  await user.keyboard('{Enter}')
  const opt = await screen.findByRole('option', { name: option })
  opt.focus()
  await user.keyboard('{Enter}')
}

test('toggleOn_putsEnabledAndShowsNextRun — 켜면 세 값을 실어 PUT 하고 「다음 보고 …」를 보인다', async () => {
  const { user, puts } = open(settings())
  const d = await dialog()
  const toggle = await within(d).findByRole('switch', { name: '일일 보고' })
  expect(toggle).not.toBeChecked()
  expect(within(d).queryByText(/다음 보고/)).toBeNull()
  await user.click(toggle)
  await waitFor(() => expect(puts).toEqual([{ dailyEnabled: true, timeOfDay: '09:00', skipEmpty: true }]))
  await waitFor(() => expect(within(d).getByRole('switch', { name: '일일 보고' })).toBeChecked())
  expect(await within(d).findByText(/다음 보고 11월 13일 \(금\) 09:00/)).toBeInTheDocument()
  // 시안 ② — 「· 어제 것」.
  expect(d).toHaveTextContent('· 어제 것')
})

test('changeHour_putsTime — 시각을 고르면 timeOfDay 를 바꿔 PUT 한다', async () => {
  const { user, puts } = open(settings({ dailyEnabled: true, nextRunAt: '2026-11-13T00:00:00Z' }))
  await dialog()
  await choose(user, '보고 시각', '07:00')
  await waitFor(() => expect(puts).toEqual([{ dailyEnabled: true, timeOfDay: '07:00', skipEmpty: true }]))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '보고 시각' })).toHaveTextContent('07:00'))
})

test('uncheckSkip_putsSkipEmptyFalse — 「한 일이 없는 날은 건너뜀」을 끄면 skipEmpty false', async () => {
  const { user, puts } = open(settings({ dailyEnabled: true }))
  const d = await dialog()
  const skip = await within(d).findByRole('checkbox', { name: '한 일이 없는 날은 건너뜀' })
  expect(skip).toBeChecked()
  await user.click(skip)
  await waitFor(() => expect(puts).toEqual([{ dailyEnabled: true, timeOfDay: '09:00', skipEmpty: false }]))
  await waitFor(() => expect(within(d).getByRole('checkbox', { name: '한 일이 없는 날은 건너뜀' })).not.toBeChecked())
})

test('templateLinks_whenPresent_openWikiPage — 템플릿·저장 위치 링크는 그 노트로 간다', async () => {
  open(settings())
  const d = await dialog()
  expect(await within(d).findByRole('link', { name: /템플릿 · 일일 보고/ })).toHaveAttribute('href', wikiPagePath(501))
  expect(within(d).getByRole('link', { name: /템플릿 · 주간 보고/ })).toHaveAttribute('href', wikiPagePath(502))
  expect(within(d).getByRole('link', { name: '내 노트 › 보고' })).toHaveAttribute('href', wikiPagePath(500))
  // 시안 ② 줄 설명.
  expect(d).toHaveTextContent('한 줄 / 어제 / 오늘 / 막힌 것')
  expect(d).toHaveTextContent('필요할 때 만들기 · 월간도 이 템플릿')
  expect(within(d).queryByText('켜면 노트에 만들어요')).toBeNull()
})

test('templatesMissing_showsWillCreateText — 템플릿이 아직 없으면 링크 대신 「켜면 노트에 만들어요」', async () => {
  open(settings({ dailyTemplatePageId: null, weeklyTemplatePageId: null, reportsPageId: null, spaceId: null }))
  const d = await dialog()
  expect(await within(d).findAllByText('켜면 노트에 만들어요')).toHaveLength(2)
  expect(within(d).queryByRole('link', { name: /템플릿 · 일일 보고/ })).toBeNull()
  // 「보고」가 아직 없으면 저장 위치는 글자만.
  expect(within(d).getByText('내 노트 › 보고')).toBeInTheDocument()
  expect(within(d).queryByRole('link', { name: '내 노트 › 보고' })).toBeNull()
})

test('templateDeletedWhileOn_showsWillRecreateText — 켜 둔 채 템플릿을 지웠으면 「다음 보고 때 다시 만들어요」', async () => {
  open(settings({ dailyEnabled: true, nextRunAt: '2026-11-13T00:00:00Z', dailyTemplatePageId: null }))
  const d = await dialog()
  expect(await within(d).findByText('다음 보고 때 다시 만들어요')).toBeInTheDocument()
  expect(within(d).queryByText('켜면 노트에 만들어요')).toBeNull()
  expect(within(d).queryByRole('link', { name: /템플릿 · 일일 보고/ })).toBeNull()
  // 남아 있는 주간 템플릿은 그대로 링크.
  expect(within(d).getByRole('link', { name: /템플릿 · 주간 보고/ })).toHaveAttribute('href', wikiPagePath(502))
})

test('noAssistant_showsWarning — 비서가 없으면 경고 한 줄(켜기는 막지 않는다)', async () => {
  open(settings({ assistantAvailable: false }))
  const d = await dialog()
  expect(await within(d).findByText('AI 비서가 없어 보고를 만들 수 없어요')).toBeInTheDocument()
  expect(within(d).getByRole('switch', { name: '일일 보고' })).toBeEnabled()
})

test('lastError — 자동 생성의 마지막 실패를 한 줄로 보인다(P9)', async () => {
  open(settings({ dailyEnabled: true, lastError: 'AI 응답이 비어 있어요' }))
  const d = await dialog()
  expect(await within(d).findByText(/AI 응답이 비어 있어요/)).toBeInTheDocument()
})

test('noResetButton — 개인 설정 창에는 「기본으로 되돌리기」가 없다(P11)', async () => {
  open(settings())
  const d = await dialog()
  await within(d).findByRole('switch', { name: '일일 보고' })
  expect(within(d).queryByRole('button', { name: '기본으로 되돌리기' })).toBeNull()
})

test('helpTarget — 창은 매뉴얼 「보고서를 설정한다」 절(me.reports.settings)', async () => {
  open(settings())
  expectHelpTarget(await dialog(), 'me.reports.settings')
})
