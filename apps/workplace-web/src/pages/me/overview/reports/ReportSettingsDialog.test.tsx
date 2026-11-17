// 「보고서 설정」 창(WP-1486) — 일일 보고 켬·시각·건너뜀을 바꾸면 바로 PUT(세 값 모두), 켜 두면 「다음 보고 …」,
// 템플릿 링크(없으면 「켜면 노트에 만들어요」, 켜진 채 지웠으면 「다음 보고 때 다시 만들어요」), 비서 없음 경고, 「기본으로 되돌리기」 없음(P11), 도움말 대상.
// WP-1655: 템플릿 링크 글자는 지금 경로(「템플릿 › 일일 보고」), 「저장 위치」는 고른 경로 + 「바꾸기」 → 고르기 창(달 폴더·템플릿 갈래 제외) → 위치 PUT,
// 서버가 템플릿을 다시 만들었으면 알림 한 줄.
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { wikiPagePath } from '@/lib/appUrl'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { renderScreen } from '@/test/renderScreen'
import type { MeReportSettings } from '@/types/meReport'

import { wikiPageSummary } from '../../../../../e2e/factories/wiki.factory'
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
    dailyTemplatePath: ['템플릿', '일일 보고'],
    weeklyTemplatePath: ['템플릿', '주간·월간 보고'],
    templateRootPageId: 520,
    templateRecreatedAt: null,
    reportsPageId: 500,
    reportLocationPath: ['보고'],
    spaceId: 7,
    nextRunAt: null,
    assistantAvailable: true,
    lastError: null,
    ...over,
  }
}

/**
 * 내 노트 공간(7) 트리 — 보고(500) ─ 2026년 11월(510) ─ 사람이 만든 메모(511), 템플릿(520) ─ 일일 보고(501)·주간·월간 보고(502),
 * 업무 일지(530) ─ 팀(531). 고르기 창은 달 폴더 갈래(510·511)와 템플릿 갈래(520·501·502)를 뺀다.
 */
const NOTE_TREE = [
  wikiPageSummary({ id: 500, parentId: null, title: '보고', position: 0 }),
  wikiPageSummary({ id: 510, parentId: 500, title: '2026년 11월', position: 0 }),
  wikiPageSummary({ id: 511, parentId: 510, title: '사람 메모', position: 0 }),
  wikiPageSummary({ id: 520, parentId: null, title: '템플릿', position: 1 }),
  wikiPageSummary({ id: 501, parentId: 520, title: '일일 보고', position: 0 }),
  wikiPageSummary({ id: 502, parentId: 520, title: '주간·월간 보고', position: 1 }),
  wikiPageSummary({ id: 530, parentId: null, title: '업무 일지', position: 2 }),
  wikiPageSummary({ id: 531, parentId: 530, title: '팀', position: 0 }),
]

/**
 * 창을 연 채로 띄운다 — 설정 PUT·위치 PUT 바디를 모은다. 켜진 저장 응답에는 다음 보고 시각(11-13 09:00 KST)을 싣는다.
 * locationStatus 가 있으면 위치 PUT 은 그 상태로 실패한다. tree 는 고르기 창이 읽는 노트 트리(기본 NOTE_TREE).
 */
function open(
  initial: MeReportSettings,
  { locationStatus, tree = NOTE_TREE }: { locationStatus?: number; tree?: typeof NOTE_TREE } = {},
) {
  const puts: unknown[] = []
  const locationPuts: unknown[] = []
  const view = renderScreen(<ReportSettingsDialog open onOpenChange={() => {}} />, {
    path: '/me/tasks/overview',
    handlers: [
      http.get(BASE, () => HttpResponse.json(initial)),
      http.put(BASE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        puts.push(body)
        return HttpResponse.json({ ...initial, ...body, nextRunAt: body.dailyEnabled ? '2026-11-13T00:00:00Z' : null })
      }),
      http.put(`${BASE}/location`, async ({ request }) => {
        const body = (await request.json()) as { pageId: number }
        locationPuts.push(body)
        if (locationStatus) return HttpResponse.json({ message: '달 폴더 아래에는 보고를 둘 수 없어요.' }, { status: locationStatus })
        return HttpResponse.json({ ...initial, reportsPageId: body.pageId, reportLocationPath: ['업무 일지', '팀'] })
      }),
      http.get('/api/v1/wiki/spaces/7/pages', () => HttpResponse.json(tree)),
    ],
  })
  return { ...view, puts, locationPuts }
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
  expect(await within(d).findByRole('link', { name: '템플릿 › 일일 보고' })).toHaveAttribute('href', wikiPagePath(501))
  expect(within(d).getByRole('link', { name: '템플릿 › 주간·월간 보고' })).toHaveAttribute('href', wikiPagePath(502))
  expect(within(d).getByRole('link', { name: '내 노트 › 보고' })).toHaveAttribute('href', wikiPagePath(500))
  // 행 이름 — 「일일 템플릿」·「주간·월간 템플릿」.
  expect(within(d).getByText('일일 템플릿')).toBeInTheDocument()
  expect(within(d).getByText('주간·월간 템플릿')).toBeInTheDocument()
  // 시안 ② 줄 설명 — 주간·월간은 「필요할 때 만들기」만(월간도 같은 템플릿이라는 말은 행 이름이 대신한다).
  expect(d).toHaveTextContent('한 줄 / 어제 / 오늘 / 막힌 것')
  expect(within(d).getByText('필요할 때 만들기')).toBeInTheDocument()
  expect(d).not.toHaveTextContent('월간도 이 템플릿')
  expect(within(d).queryByText('켜면 노트에 만들어요')).toBeNull()
})

test('templateLinks_followServerPath — 템플릿을 옮겼으면 링크 글자가 지금 경로, 경로가 없으면 기본 이름', async () => {
  open(settings({ dailyTemplatePath: ['업무 일지', '내 일일 양식'], weeklyTemplatePath: null }))
  const d = await dialog()
  expect(await within(d).findByRole('link', { name: '업무 일지 › 내 일일 양식' })).toHaveAttribute('href', wikiPagePath(501))
  expect(within(d).getByRole('link', { name: '템플릿 › 주간·월간 보고' })).toHaveAttribute('href', wikiPagePath(502))
})

test('location_chosenPath — 고른 저장 위치는 「내 노트 › 업무 일지 › 팀」 링크', async () => {
  open(settings({ reportsPageId: 531, reportLocationPath: ['업무 일지', '팀'] }))
  const d = await dialog()
  expect(await within(d).findByRole('link', { name: '내 노트 › 업무 일지 › 팀' })).toHaveAttribute('href', wikiPagePath(531))
})

test('changeLocation_savesAndCloses — 「바꾸기」 → 고르기 창(달 폴더·템플릿 갈래 없음)에서 고르고 저장하면 위치 PUT·토스트·창 닫힘·줄 갱신', async () => {
  const { user, locationPuts } = open(settings())
  const d = await dialog()
  await user.click(await within(d).findByRole('button', { name: '바꾸기' }))
  const picker = await screen.findByRole('dialog', { name: '보고 저장 위치' })
  expect(picker).toHaveAttribute('data-help', 'me.reports.location')
  expect(picker).toHaveTextContent('새 보고를 고른 페이지 아래에 달별로 모아 만들어요. 이미 만든 보고는 그대로 둬요.')
  await within(picker).findByRole('option', { name: /^팀/ })
  // 지금 위치 「보고」는 보이고, 그 아래 달 폴더와 그 아래 사람 페이지, 「템플릿」 갈래는 없다.
  expect(within(picker).getByRole('option', { name: /^보고.*지금 위치/ })).toBeInTheDocument()
  expect(within(picker).queryByRole('option', { name: /2026년 11월/ })).toBeNull()
  expect(within(picker).queryByRole('option', { name: /사람 메모/ })).toBeNull()
  expect(within(picker).queryByRole('option', { name: /^템플릿/ })).toBeNull()
  expect(within(picker).queryByRole('option', { name: /일일 보고/ })).toBeNull()
  expect(within(picker).queryByRole('option', { name: /주간·월간 보고/ })).toBeNull()
  await user.click(within(picker).getByRole('option', { name: /^팀/ }))
  await user.click(within(picker).getByRole('button', { name: '저장' }))
  await waitFor(() => expect(locationPuts).toEqual([{ pageId: 531 }]))
  expect(await screen.findByText('저장 위치를 바꿨어요')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '보고 저장 위치' })).toBeNull())
  // 설정 창은 그대로 열려 있고 줄이 새 경로로 바뀐다.
  expect(await screen.findByRole('link', { name: '내 노트 › 업무 일지 › 팀' })).toHaveAttribute('href', wikiPagePath(531))
})

test('changeLocation_rejected_keepsPickerOpen — 위치 PUT 이 400 이면 오류 토스트, 고르기 창은 열린 채, 줄은 그대로', async () => {
  const { user, locationPuts } = open(settings(), { locationStatus: 400 })
  const d = await dialog()
  await user.click(await within(d).findByRole('button', { name: '바꾸기' }))
  const picker = await screen.findByRole('dialog', { name: '보고 저장 위치' })
  await user.click(await within(picker).findByRole('option', { name: /^팀/ }))
  await user.click(within(picker).getByRole('button', { name: '저장' }))
  await waitFor(() => expect(locationPuts).toHaveLength(1))
  expect(await screen.findByText('달 폴더 아래에는 보고를 둘 수 없어요.')).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '보고 저장 위치' })).toBeInTheDocument()
  expect(screen.getByText('내 노트 › 보고')).toBeInTheDocument()
})

test('locationPicker_escape_closesOnlyPicker — 고르기 창에서 Esc 는 그 창만 닫는다(설정 창은 남음)', async () => {
  const { user } = open(settings())
  const d = await dialog()
  await user.click(await within(d).findByRole('button', { name: '바꾸기' }))
  await screen.findByRole('dialog', { name: '보고 저장 위치' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '보고 저장 위치' })).toBeNull())
  expect(await dialog()).toBeInTheDocument()
})

test('locationPicker_empty_showsReportsHint — 고를 페이지가 없으면 다음 보고 때 「보고」를 만든다고 안내', async () => {
  const onlyTemplates = NOTE_TREE.filter((p) => [520, 501, 502].includes(p.id))
  const { user } = open(settings({ reportsPageId: null }), { tree: onlyTemplates })
  const d = await dialog()
  await user.click(await within(d).findByRole('button', { name: '바꾸기' }))
  const picker = await screen.findByRole('dialog', { name: '보고 저장 위치' })
  expect(await within(picker).findByText('고를 페이지가 없으면 다음 보고 때 「보고」를 만들어요.')).toBeInTheDocument()
})

test('noSpace_hidesChangeButton — 내 노트 공간이 아직 없으면 「바꾸기」가 없다', async () => {
  open(settings({ spaceId: null, reportsPageId: null }))
  const d = await dialog()
  await within(d).findByRole('switch', { name: '일일 보고' })
  expect(within(d).queryByRole('button', { name: '바꾸기' })).toBeNull()
})

test('templateRecreated_showsNotice — 서버가 템플릿을 다시 만들었으면 알림 한 줄', async () => {
  open(settings({ templateRecreatedAt: '2026-11-16T00:00:00Z' }))
  const d = await dialog()
  expect(await within(d).findByTestId('me-report-template-recreated')).toHaveTextContent('템플릿을 다시 만들었어요')
})

test('templateNotRecreated_noNotice — 다시 만든 적이 없으면 알림이 없다', async () => {
  open(settings())
  const d = await dialog()
  await within(d).findByRole('switch', { name: '일일 보고' })
  expect(within(d).queryByTestId('me-report-template-recreated')).toBeNull()
})

test('templatesMissing_showsWillCreateText — 템플릿이 아직 없으면 링크 대신 「켜면 노트에 만들어요」', async () => {
  open(settings({ dailyTemplatePageId: null, weeklyTemplatePageId: null, dailyTemplatePath: null, weeklyTemplatePath: null, reportsPageId: null, spaceId: null }))
  const d = await dialog()
  expect(await within(d).findAllByText('켜면 노트에 만들어요')).toHaveLength(2)
  expect(within(d).queryByRole('link', { name: /템플릿 › 일일 보고/ })).toBeNull()
  // 「보고」가 아직 없으면 저장 위치는 글자만.
  expect(within(d).getByText('내 노트 › 보고')).toBeInTheDocument()
  expect(within(d).queryByRole('link', { name: '내 노트 › 보고' })).toBeNull()
})

test('templateDeletedWhileOn_showsWillRecreateText — 켜 둔 채 템플릿을 지웠으면 「다음 보고 때 다시 만들어요」', async () => {
  open(settings({ dailyEnabled: true, nextRunAt: '2026-11-13T00:00:00Z', dailyTemplatePageId: null, dailyTemplatePath: null }))
  const d = await dialog()
  expect(await within(d).findByText('다음 보고 때 다시 만들어요')).toBeInTheDocument()
  expect(within(d).queryByText('켜면 노트에 만들어요')).toBeNull()
  expect(within(d).queryByRole('link', { name: /템플릿 › 일일 보고/ })).toBeNull()
  // 남아 있는 주간·월간 템플릿은 그대로 링크.
  expect(within(d).getByRole('link', { name: '템플릿 › 주간·월간 보고' })).toHaveAttribute('href', wikiPagePath(502))
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
