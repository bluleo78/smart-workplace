// 설정 › AI 비서 › 메모리 카드(AiMemoryCard) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 제자리 고치기·지우기와 되돌리기·직접 추가(빈 값·초과·종류·범위·기한)·모두 지우기·스위치 끄기·두 스위치 경합·빈 상태·묶음 카운트 색과 가득 참·
// 저장 거절·목록 갱신 전 잠금·범위 옮기기(WP-379)·기한 표기와 만료 행 되살리기(WP-380)·고정과 검색(WP-383)·「AI가 정리한 기록」(WP-385)은
// 브라우저 없이 판정되므로 e2e/pages/settings/ai-memory-settings.spec.ts·ai-memory-cleanup.spec.ts 에서 옮겼다.
// 화면 배선(@wiring)·인피니트 스크롤·도구 줄 위치(@layout)·막힌 핀 툴팁 호버(@input)·기록 대화상자 캡처(@layout)는 E2E 에 남는다.
// 카드만 renderScreen 으로 띄운다(두 스위치 경합만 추천 질문 카드를 함께). 서버는 상태 있는 MSW 목(memoryTestkit-b7)이다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { AiMemoryItem } from '@/types/aiMemory'

import { AiMemoryCard } from './AiMemoryCard'
import {
  aiMemoriesApi,
  aiPreferencesApi,
  gate,
  manyMemories,
  memoryChange,
  memoryChangesApi,
  memoryItem,
  memorySnap,
} from './memoryTestkit-b7'
import { SuggestionPreferenceCard } from './SuggestionPreferenceCard'

type Opts = { changes?: ReturnType<typeof memoryChangesApi>; prefs?: ReturnType<typeof aiPreferencesApi>; withSuggestions?: boolean }

/** 메모리 카드를 띄운다 — 목록이 그려질 때까지(빈 목록이면 빈 안내까지) 기다린다. */
async function openMemory(initial: AiMemoryItem[], { changes = memoryChangesApi([], 0), prefs = aiPreferencesApi(), withSuggestions }: Opts = {}) {
  const api = aiMemoriesApi(initial)
  const ui = withSuggestions ? (
    <>
      <SuggestionPreferenceCard />
      <AiMemoryCard />
    </>
  ) : (
    <AiMemoryCard />
  )
  const view = renderScreen(ui, { path: '/settings/assistant', handlers: [...api.handlers, ...changes.handlers, ...prefs.handlers] })
  if (initial.length > 0) await screen.findAllByTestId('ai-memory-row')
  else await screen.findByTestId('ai-memory-empty')
  return { ...view, api, changes, prefs }
}

type User = Awaited<ReturnType<typeof openMemory>>['user']
const rows = () => screen.queryAllByTestId('ai-memory-row')
const contents = () => screen.queryAllByTestId('ai-memory-content').map((el) => el.textContent)
const row = (text: string) => rows().find((r) => r.textContent?.includes(text))!
const inRow = (r: HTMLElement) => within(r)
const group = (scope: string) => document.querySelector<HTMLElement>(`[data-testid="ai-memory-group"][data-scope="${scope}"]`)!

/** 입력란을 비우고 붙여 넣는다. */
async function fill(user: User, el: HTMLElement, value: string) {
  await user.clear(el)
  if (value) await user.paste(value)
}

/** 범위·기한 선택 열기 → 항목 고르기(Radix Select·Popover). */
async function pick(user: User, triggerTestId: string, optionTestId: string) {
  await user.click(screen.getByTestId(triggerTestId))
  await user.click(await screen.findByTestId(optionTestId))
}

describe('목록·편집·삭제', () => {
  test('제자리에서 고치면 PATCH 를 보내고 맨 위로 올라간다 — 취소하면 원래대로', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
    await user.click(inRow(rows()[1]).getByTestId('ai-memory-edit'))
    // WP-940 — 행마다 같은 「수정」「삭제」가 아니라 어느 메모리의 버튼인지 이름에 담는다.
    expect(inRow(rows()[0]).getByTestId('ai-memory-delete')).toHaveAccessibleName('「첫째」 메모리 삭제')
    expect(screen.getByTestId('ai-memory-edit-input')).toHaveValue('둘째')
    await fill(user, screen.getByTestId('ai-memory-edit-input'), '둘째를 고침')
    expect(screen.getByTestId('ai-memory-edit-count')).toHaveTextContent('6 / 300')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(contents()).toEqual(['둘째를 고침', '첫째']))
    expect(api.updates().map((c) => [c.url.pathname, c.body])).toEqual([['/api/v1/users/me/ai-memories/2', { content: '둘째를 고침' }]])

    await user.click(inRow(rows()[1]).getByTestId('ai-memory-edit'))
    await fill(user, screen.getByTestId('ai-memory-edit-input'), '버릴 내용')
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(inRow(rows()[1]).getByTestId('ai-memory-content')).toHaveTextContent('첫째')
    expect(api.updates()).toHaveLength(1)
  })

  // F-j: 추가 폼과 행 고치기를 함께 열어도 두 입력란의 접근성 이름이 다르다.
  test('추가 폼과 제자리 고치기 입력란은 서로 다른 이름으로 읽힌다', async () => {
    const { user } = await openMemory([memoryItem(3, { content: '첫째' })])
    await user.click(screen.getByTestId('ai-memory-add'))
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-edit'))
    expect(screen.getAllByRole('textbox', { name: '기억할 내용' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: '메모리 내용' })).toHaveValue('첫째')
  })

  test('지우면 바로 사라지고 토스트의 되돌리기로 같은 종류·내용을 직접 추가로 다시 만든다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { kind: 'CONTEXT', content: '백엔드 팀이다' }), memoryItem(2, { content: '둘째' })])
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-delete'))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(api.deletes().map((c) => c.url.pathname)).toEqual(['/api/v1/users/me/ai-memories/3'])
    expect(await screen.findByText('메모리를 삭제했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(contents()[0]).toBe('백엔드 팀이다'))
    expect(api.creates().map((c) => c.body)).toEqual([{ kind: 'CONTEXT', content: '백엔드 팀이다' }])
    expect(inRow(rows()[0]).getByTestId('ai-memory-meta')).toHaveTextContent('직접 추가')
  })

  // CR9: 되돌리기는 직접 추가 경로를 그대로 쓴다 — 지운 행이 사라진 뒤에도 실패 토스트(서버 문구)가 뜨고 목록은 그대로다.
  test('삭제 토스트의 되돌리기가 실패하면 서버 문구 토스트를 띄우고 목록은 그대로다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '백엔드 팀이다' }), memoryItem(2, { content: '둘째' })])
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-delete'))
    await waitFor(() => expect(rows()).toHaveLength(1))
    api.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')
    await user.click(await screen.findByRole('button', { name: '되돌리기' }))
    expect(await screen.findByText('메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')).toBeInTheDocument()
    expect(api.creates()).toHaveLength(1)
    expect(contents()).toEqual(['둘째'])
  })

  test('직접 추가 폼은 목록 위에 열리고, 빈 값·초과면 막히며, 고른 종류로 추가한다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '첫째' })])
    await user.click(screen.getByTestId('ai-memory-add'))
    const form = screen.getByTestId('ai-memory-add-form')
    // 폼이 첫 행보다 앞(위)에 있다 — 문서 순서로 본다(실제 위치는 같은 흐름 배치).
    expect(form.compareDocumentPosition(rows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('ai-memory-kind-PREFERENCE')).toHaveAttribute('aria-pressed', 'true')
    const submit = screen.getByTestId('ai-memory-add-submit')
    expect(submit).toBeDisabled()
    await fill(user, screen.getByTestId('ai-memory-add-input'), '   ')
    expect(submit).toBeDisabled()
    await fill(user, screen.getByTestId('ai-memory-add-input'), '가'.repeat(301))
    expect(screen.getByTestId('ai-memory-add-count')).toHaveClass('text-destructive')
    expect(submit).toBeDisabled()

    await user.click(screen.getByTestId('ai-memory-kind-CONTEXT'))
    await fill(user, screen.getByTestId('ai-memory-add-input'), '  주로 WP 프로젝트를 본다  ')
    expect(screen.getByTestId('ai-memory-add-count')).toHaveTextContent('14 / 300')
    await user.click(submit)
    await waitFor(() => expect(screen.queryByTestId('ai-memory-add-form')).not.toBeInTheDocument())
    expect(api.creates().map((c) => c.body)).toEqual([{ kind: 'CONTEXT', content: '  주로 WP 프로젝트를 본다  ' }])
    expect(contents()[0]).toBe('주로 WP 프로젝트를 본다')
    expect(inRow(rows()[0]).getByTestId('ai-memory-kind')).toHaveTextContent('맥락')
    expect(screen.getByTestId('ai-memory-group-count')).toHaveTextContent('2 / 300')
  })

  test('모두 지우기는 개수를 알려 주는 확인 뒤에만 지우고, 지우면 빈 상태가 된다', async () => {
    const { user, api } = await openMemory([memoryItem(3), memoryItem(2), memoryItem(1)])
    await user.click(screen.getByTestId('ai-memory-clear'))
    const dialog = await screen.findByTestId('ai-memory-clear-dialog')
    expect(dialog).toHaveTextContent('메모리를 모두 지울까요?')
    expect(dialog).toHaveTextContent('모든 범위의 메모리 3개가 삭제되고 되돌릴 수 없어요. 다음 대화부터 반영되지 않아요.')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(rows()).toHaveLength(3)
    expect(api.clears()).toHaveLength(0)

    await user.click(screen.getByTestId('ai-memory-clear'))
    await user.click(await screen.findByTestId('ai-memory-clear-confirm'))
    expect(await screen.findByTestId('ai-memory-empty')).toBeInTheDocument()
    expect(api.clears()).toHaveLength(1)
    expect(screen.queryByTestId('ai-memory-clear')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-memory-group')).not.toBeInTheDocument()
  })

  test('스위치를 끄면 false 를 저장하고 목록이 흐려지지만 편집은 그대로 된다', async () => {
    const { user, prefs } = await openMemory([memoryItem(3, { content: '첫째' })])
    const toggle = screen.getByTestId('ai-memory-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    await waitFor(() => expect(prefs.puts).toEqual([{ memoryEnabled: false }]))
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByTestId('ai-memory-toggle-hint')).toHaveTextContent('꺼져 있어요 — 새로 저장하지 않고 대화에도 반영하지 않아요')
    // 흐림은 목록 영역의 투명도 클래스(실제 opacity 계산은 브라우저 몫).
    expect(screen.getByTestId('ai-memory-list-area')).toHaveClass('opacity-60')
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-edit'))
    expect(screen.getByTestId('ai-memory-edit-input')).not.toHaveAttribute('readonly')
    expect(screen.getByTestId('ai-memory-edit-input')).toBeEnabled()
    expect(screen.getByTestId('ai-memory-add')).toBeEnabled()
  })

  // F-i: 추천·메모리 스위치는 저장을 따로 한다 — 먼저 보낸 추천 저장의 응답이 늦게(메모리 저장 전 값을 싣고) 와도 메모리 스위치를 되돌리지 않는다.
  test('두 스위치를 연달아 바꿔도 늦게 온 응답이 다른 스위치를 되돌리지 않는다', async () => {
    const hold = gate()
    const prefs = aiPreferencesApi(true, { holdFirstPut: hold.p })
    const { user } = await openMemory([], { prefs, withSuggestions: true })
    await waitFor(() => expect(screen.getByTestId('ai-suggestions-toggle')).toBeEnabled())
    await user.click(screen.getByTestId('ai-suggestions-toggle'))
    await waitFor(() => expect(prefs.puts).toHaveLength(1))
    await user.click(screen.getByTestId('ai-memory-toggle'))
    await waitFor(() => expect(prefs.puts).toEqual([{ suggestionsEnabled: false }, { memoryEnabled: false }]))
    await waitFor(() => expect(screen.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'false'))
    hold.release() // 첫 응답 = { suggestionsEnabled: false, memoryEnabled: true }(도착 시점 값)
    // 저장 중 잠금은 aria-busy(BusySwitch) — 추천 저장이 끝나 풀린 뒤(캐시 반영은 그 전에 끝난다) 두 값을 본다.
    await waitFor(() => expect(screen.getByTestId('ai-suggestions-toggle')).not.toHaveAttribute('aria-busy'))
    expect(screen.getByTestId('ai-suggestions-toggle')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'false')
  })

  test('비어 있으면 안내 문구를 보이고 묶음·모두 지우기는 없다', async () => {
    await openMemory([])
    expect(screen.getByTestId('ai-memory-empty')).toHaveTextContent("아직 기억한 내용이 없어요. 대화에서 '앞으로는 ~해줘'라고 말하거나 직접 추가해 보세요.")
    expect(screen.queryByTestId('ai-memory-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-memory-clear')).not.toBeInTheDocument()
  })

  test('270개면 묶음 카운트가 주황이고 추가는 되며 행은 처음 30개만 그린다(더 보기 버튼 없음)', async () => {
    await openMemory(manyMemories(270))
    expect(screen.getByTestId('ai-memory-group-count')).toHaveTextContent('270 / 300')
    expect(screen.getByTestId('ai-memory-group-count')).toHaveClass('text-warning-text')
    expect(screen.getByTestId('ai-memory-add')).toBeEnabled()
    expect(screen.queryByTestId('ai-memory-group-full')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-memory-group-more')).not.toBeInTheDocument()
    expect(rows()).toHaveLength(30)
  })

  test('공통 300개면 가득 참 경고, 추가는 열리고 기본 범위는 이슈이며 공통은 고를 수 없다', async () => {
    const { user, api } = await openMemory(manyMemories(300))
    expect(screen.getByTestId('ai-memory-group-count')).toHaveTextContent('가득 참 · 300 / 300')
    expect(screen.getByTestId('ai-memory-group-full')).toHaveTextContent(
      '공통 메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)',
    )
    await user.click(screen.getByTestId('ai-memory-add'))
    expect(screen.getByTestId('ai-memory-add-scope')).toHaveTextContent('이슈')
    await user.click(screen.getByTestId('ai-memory-add-scope'))
    const common = await screen.findByTestId('ai-memory-add-scope-COMMON')
    expect(common).toHaveAttribute('aria-disabled', 'true')
    expect(common).toHaveTextContent('가득 참')
    await user.keyboard('{Escape}')
    await fill(user, screen.getByTestId('ai-memory-add-input'), '이슈 목록은 짧게 보여 준다')
    await user.click(screen.getByTestId('ai-memory-add-submit'))
    await waitFor(() => expect(api.creates().map((c) => c.body)).toEqual([{ kind: 'PREFERENCE', content: '이슈 목록은 짧게 보여 준다', scope: 'ISSUE' }]))
  })

  test('저장이 거절되면 서버 사유를 토스트로 보이고 폼을 닫지 않는다', async () => {
    const { user, api } = await openMemory([memoryItem(3)])
    api.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')
    await user.click(screen.getByTestId('ai-memory-add'))
    await fill(user, screen.getByTestId('ai-memory-add-input'), '새 메모리')
    await user.click(screen.getByTestId('ai-memory-add-submit'))
    expect(await screen.findByText('메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')).toBeInTheDocument()
    expect(screen.getByTestId('ai-memory-add-form')).toBeInTheDocument()
  })
})

// 쓰기가 끝나도 목록을 다시 읽기 전에는 옛 줄이 남아 있다 — 그 사이 버튼을 잠가 겹친 요청(404·옛 내용)이 나가지 않는다.
describe('목록 갱신 전 잠금', () => {
  test('삭제 뒤 목록이 갱신되기 전에는 삭제 버튼이 잠겨 두 번째 요청이 나가지 않는다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
    const list = gate()
    api.holdNextList(list.p)
    const del = inRow(rows()[0]).getByTestId('ai-memory-delete')
    await user.click(del)
    expect(await screen.findByText('메모리를 삭제했어요')).toBeInTheDocument()
    expect(rows()).toHaveLength(2) // 목록 응답이 아직 — 지운 줄이 남아 있다
    expect(del).toBeDisabled()
    expect(api.deletes()).toHaveLength(1)
    list.release()
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(api.deletes()).toHaveLength(1)
  })

  test('고치기는 목록이 갱신될 때까지 편집기를 열어 두고 저장 버튼을 잠근다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
    const list = gate()
    await user.click(inRow(rows()[1]).getByTestId('ai-memory-edit'))
    await fill(user, screen.getByTestId('ai-memory-edit-input'), '둘째를 고침')
    api.holdNextList(list.p)
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('ai-memory-edit-submit')).toBeDisabled())
    expect(screen.getByTestId('ai-memory-edit-input')).toBeInTheDocument()
    list.release()
    await waitFor(() => expect(screen.queryByTestId('ai-memory-edit-input')).not.toBeInTheDocument())
    expect(contents()).toEqual(['둘째를 고침', '첫째'])
  })

  test('모두 지우기 확인 버튼은 요청 중 잠기고 한 번만 보낸다', async () => {
    const { user, api } = await openMemory([memoryItem(3), memoryItem(2)])
    const list = gate()
    await user.click(screen.getByTestId('ai-memory-clear'))
    api.holdNextList(list.p)
    await user.click(await screen.findByTestId('ai-memory-clear-confirm'))
    await waitFor(() => expect(api.clears()).toHaveLength(1))
    expect(screen.queryByTestId('ai-memory-empty')).not.toBeInTheDocument()
    list.release()
    expect(await screen.findByTestId('ai-memory-empty')).toBeInTheDocument()
    expect(api.clears()).toHaveLength(1)
  })
})

// WP-379 — 범위 묶음. 고치기·추가의 범위, 가득 찬 범위.
describe('범위 (WP-379)', () => {
  test('고치기에서 범위를 바꾸면 PATCH 에 scope 를 싣고 그 묶음으로 옮겨 간다 — 그대로 두면 scope 를 보내지 않는다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '목록은 짧게' }), memoryItem(2, { content: '메일은 짧게', scope: 'MAIL' })])
    await user.click(within(group('COMMON')).getByTestId('ai-memory-edit'))
    expect(screen.getByTestId('ai-memory-edit-scope')).toHaveTextContent('공통 (모든 AI)')
    await pick(user, 'ai-memory-edit-scope', 'ai-memory-edit-scope-ISSUE')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(within(group('ISSUE')).getByTestId('ai-memory-content')).toHaveTextContent('목록은 짧게'))
    expect(api.updates()[0].body).toEqual({ content: '목록은 짧게', scope: 'ISSUE' })

    // 메일 → 공통으로(null).
    await user.click(within(group('MAIL')).getByTestId('ai-memory-edit'))
    await pick(user, 'ai-memory-edit-scope', 'ai-memory-edit-scope-COMMON')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(2))
    expect(api.updates()[1].body).toEqual({ content: '메일은 짧게', scope: null })

    // 내용만 고치면 scope 키가 없다.
    await waitFor(() => expect(screen.queryByTestId('ai-memory-edit-input')).not.toBeInTheDocument())
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-edit'))
    await fill(user, screen.getByTestId('ai-memory-edit-input'), '메일은 아주 짧게')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(3))
    expect(api.updates()[2].body).toEqual({ content: '메일은 아주 짧게' })
  })

  test('가득 찬 범위로는 옮길 수 없지만 그 범위 안의 항목은 scope 없이 그대로 고칠 수 있다', async () => {
    const issues = Array.from({ length: 300 }, (_, i) => memoryItem(300 - i, { scope: 'ISSUE', content: `이슈 메모 ${300 - i}` }))
    const { user, api } = await openMemory([memoryItem(400, { content: '공통 하나' }), ...issues])
    await user.click(within(group('COMMON')).getByTestId('ai-memory-edit'))
    await user.click(screen.getByTestId('ai-memory-edit-scope'))
    expect(await screen.findByTestId('ai-memory-edit-scope-ISSUE')).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await user.click(within(group('ISSUE')).getAllByTestId('ai-memory-edit')[0])
    await user.click(screen.getByTestId('ai-memory-edit-scope'))
    expect(await screen.findByTestId('ai-memory-edit-scope-ISSUE')).not.toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')
    await fill(user, screen.getByTestId('ai-memory-edit-input'), '이슈 메모 고침')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(1))
    expect(api.updates()[0].body).toEqual({ content: '이슈 메모 고침' })
    await waitFor(() => expect(within(group('ISSUE')).getAllByTestId('ai-memory-content')[0]).toHaveTextContent('이슈 메모 고침'))
  })

  test('직접 추가에서 범위를 고르면 그 범위로 만들어 새 묶음이 생긴다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '첫째' })])
    await user.click(screen.getByTestId('ai-memory-add'))
    expect(screen.getByTestId('ai-memory-add-scope')).toHaveTextContent('공통 (모든 AI)')
    await pick(user, 'ai-memory-add-scope', 'ai-memory-add-scope-MAIL')
    await fill(user, screen.getByTestId('ai-memory-add-input'), '메일 답장은 존댓말로')
    await user.click(screen.getByTestId('ai-memory-add-submit'))
    await waitFor(() => expect(group('MAIL')).toBeTruthy())
    expect(within(group('MAIL')).getByTestId('ai-memory-content')).toHaveTextContent('메일 답장은 존댓말로')
    expect(api.creates()[0].body).toEqual({ kind: 'PREFERENCE', content: '메일 답장은 존댓말로', scope: 'MAIL' })
  })
})

// WP-380: 날짜 표기는 KST 오늘(2026-10-14) 기준 — 시계를 고정한다(시간대는 vitest 설정이 Asia/Seoul).
describe('기한 (WP-380)', () => {
  const freeze = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T03:00:00Z'))
  }
  afterEach(() => vi.useRealTimers())

  test('기한은 메타 끝에 "…까지", 만료 행은 묶음 끝에 흐리게 + 삭제 예정일이고 한도에서 빠진다', async () => {
    freeze()
    await openMemory([
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true, updatedAt: '2026-10-12T12:00:00Z' }),
      memoryItem(5, { content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-24', expired: false, updatedAt: '2026-10-11T12:00:00Z' }),
      memoryItem(4, { content: '답은 존댓말로' }),
    ])
    expect(contents()).toEqual(['이번 주는 결제 모듈 집중', '답은 존댓말로', '지난 출장 중'])
    expect(inRow(rows()[0]).getByTestId('ai-memory-meta')).toHaveTextContent('AI가 저장 · 2026-10-11 · 10월 24일까지')
    expect(rows()[2]).toHaveAttribute('data-expired', 'true')
    expect(inRow(rows()[2]).getByTestId('ai-memory-meta')).toHaveTextContent('만료됨 · 10월 10일까지 · 11월 10일에 지워져요')
    expect(screen.getByTestId('ai-memory-group-count')).toHaveTextContent('2 / 300')
  })

  test('만료 행의 계속 기억은 clearExpiry, 기한 연장은 고른 날짜로 PATCH 한다', async () => {
    freeze()
    const { user, api } = await openMemory([
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true }),
      memoryItem(5, { content: '지난 스프린트', expiresOn: '2026-10-01', expired: true }),
    ])
    await user.click(inRow(row('지난 출장 중')).getByTestId('ai-memory-keep'))
    await waitFor(() => expect(row('지난 출장 중')).not.toHaveAttribute('data-expired', 'true'))
    expect(api.updates()[0].body).toEqual({ clearExpiry: true })

    await user.click(inRow(row('지난 스프린트')).getByTestId('ai-memory-extend'))
    expect(screen.queryByTestId('ai-memory-extend-none')).not.toBeInTheDocument()
    await user.click(await screen.findByTestId('ai-memory-extend-next-week'))
    await waitFor(() => expect(api.updates()).toHaveLength(2))
    expect(api.updates()[1].body).toEqual({ expiresOn: '2026-10-21' })
  })

  // 되살리기 저장 중(목록 갱신 전)에는 「계속 기억」과 「기한 연장」이 함께 잠겨 두 번째 PATCH 가 겹치지 않는다.
  test('되살리기 저장 중에는 계속 기억과 기한 연장이 함께 잠긴다', async () => {
    freeze()
    const { user, api } = await openMemory([memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true })])
    const list = gate()
    api.holdNextList(list.p)
    const r = rows()[0]
    await user.click(inRow(r).getByTestId('ai-memory-keep'))
    await waitFor(() => expect(api.updates()).toHaveLength(1))
    await waitFor(() => expect(inRow(r).getByTestId('ai-memory-keep')).toBeDisabled())
    expect(inRow(r).getByTestId('ai-memory-extend')).toBeDisabled()
    list.release()
    await waitFor(() => expect(rows()[0]).not.toHaveAttribute('data-expired', 'true'))
    expect(api.updates()).toHaveLength(1)
  })

  test('고치기에서 기한을 고르고 없앤다 — 오늘 이전 날짜는 고를 수 없다', async () => {
    freeze()
    const { user, api } = await openMemory([memoryItem(3, { content: '결제 모듈 집중' })])
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-edit'))
    expect(screen.getByTestId('ai-memory-edit-expiry')).toHaveTextContent('기한 없음')
    await user.click(screen.getByTestId('ai-memory-edit-expiry'))
    // data-day 는 day.date.toLocaleDateString()(en-US) — 어제는 막히고 내일은 열린다.
    await waitFor(() => expect(document.querySelector('button[data-day="10/13/2026"]')).toBeInTheDocument())
    expect(document.querySelector('button[data-day="10/13/2026"]')).toBeDisabled()
    expect(document.querySelector('button[data-day="10/15/2026"]')).toBeEnabled()
    await user.click(screen.getByTestId('ai-memory-edit-expiry-next-month'))
    expect(screen.getByTestId('ai-memory-edit-expiry')).toHaveTextContent('11월 14일까지')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(1))
    expect(api.updates()[0].body).toEqual({ content: '결제 모듈 집중', expiresOn: '2026-11-14' })
    await waitFor(() => expect(inRow(rows()[0]).getByTestId('ai-memory-expiry')).toHaveTextContent('11월 14일까지'))

    await user.click(inRow(rows()[0]).getByTestId('ai-memory-edit'))
    await pick(user, 'ai-memory-edit-expiry', 'ai-memory-edit-expiry-none')
    await user.click(screen.getByTestId('ai-memory-edit-submit'))
    await waitFor(() => expect(api.updates()).toHaveLength(2))
    expect(api.updates()[1].body).toEqual({ content: '결제 모듈 집중', clearExpiry: true })
  })

  test('직접 추가에서 기한을 고르면 POST 에 expiresOn 을 싣는다', async () => {
    freeze()
    const { user, api } = await openMemory([])
    await user.click(screen.getByTestId('ai-memory-add'))
    await pick(user, 'ai-memory-add-expiry', 'ai-memory-add-expiry-next-week')
    await fill(user, screen.getByTestId('ai-memory-add-input'), '이번 주는 결제 모듈 집중')
    await user.click(screen.getByTestId('ai-memory-add-submit'))
    await waitFor(() => expect(api.creates().map((c) => c.body)).toEqual([{ kind: 'PREFERENCE', content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-21' }]))
  })

  test('만료 항목을 지우면 되돌리기가 없고, 기한 있는 항목은 되돌리기가 기한까지 다시 만든다', async () => {
    freeze()
    const { user, api } = await openMemory([
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true }),
      memoryItem(5, { content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-24', expired: false, scope: 'ISSUE' }),
    ])
    await user.click(inRow(row('지난 출장 중')).getByTestId('ai-memory-delete'))
    expect(await screen.findByText('메모리를 삭제했어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()

    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(inRow(row('결제 모듈')).getByTestId('ai-memory-delete'))
    await user.click(await screen.findByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(api.creates()).toHaveLength(1))
    expect(api.creates()[0].body).toEqual({ kind: 'PREFERENCE', content: '이번 주는 결제 모듈 집중', scope: 'ISSUE', expiresOn: '2026-10-24' })
  })
})

// WP-383 — 고정 토글·20개 초과 검색.
describe('고정·검색 (WP-383)', () => {
  test('핀을 누르면 PUT 으로 고정하고 묶음 맨 위로 올라가며 메타에 "고정"이 붙는다 — 다시 누르면 푼다', async () => {
    const { user, api } = await openMemory([memoryItem(3, { content: '가장 최신' }), memoryItem(2, { content: '중간' }), memoryItem(1, { content: '오래된 것' })])
    const pin = inRow(row('오래된 것')).getByTestId('ai-memory-pin')
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    await user.click(pin)
    await waitFor(() => expect(contents()).toEqual(['오래된 것', '가장 최신', '중간']))
    expect(api.pins().map((c) => c.body)).toEqual([{ pinned: true }])
    expect(inRow(rows()[0]).getByTestId('ai-memory-pinned')).toBeInTheDocument()
    expect(inRow(rows()[0]).getByTestId('ai-memory-meta')).toHaveTextContent('고정')
    expect(inRow(rows()[0]).getByTestId('ai-memory-pin')).toHaveAttribute('aria-pressed', 'true')

    await user.click(inRow(rows()[0]).getByTestId('ai-memory-pin'))
    await waitFor(() => expect(contents()).toEqual(['가장 최신', '중간', '오래된 것']))
    expect(api.pins()[1].body).toEqual({ pinned: false })
  })

  test('20개 넘으면 검색칸이 생기고 내용으로 거르며 묶음 카운트는 그대로다 — 맞는 게 없으면 안내한다', async () => {
    const { user } = await openMemory([memoryItem(30, { content: '고양이를 좋아한다' }), ...manyMemories(20)])
    const search = screen.getByTestId('ai-memory-search')
    await fill(user, search, '고양이')
    await waitFor(() => expect(contents()).toEqual(['고양이를 좋아한다']))
    expect(screen.getByTestId('ai-memory-group-count')).toHaveTextContent('1개 일치 · 21 / 300')
    await fill(user, search, '없는 말')
    // 조사는 검색어 받침에 맞춘다 — 「없는 말」은 받침 있음 → 「과」(WP-679)
    expect(await screen.findByTestId('ai-memory-search-empty')).toHaveTextContent("'없는 말'과 일치하는 메모리가 없어요.")
    expect(rows()).toHaveLength(0)
    await user.clear(search)
    await waitFor(() => expect(rows()).toHaveLength(21))
  })

  test('검색칸이 사라지면 질의도 버려서 다시 20개를 넘었을 때 숨은 필터가 되살아나지 않는다', async () => {
    const { user } = await openMemory([memoryItem(30, { content: '고양이를 좋아한다' }), ...manyMemories(20)])
    await fill(user, screen.getByTestId('ai-memory-search'), '고양이')
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-delete'))
    await waitFor(() => expect(screen.queryByTestId('ai-memory-search')).not.toBeInTheDocument())
    await waitFor(() => expect(rows()).toHaveLength(20))
    await user.click(await screen.findByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(rows()).toHaveLength(21))
    expect(screen.getByTestId('ai-memory-search')).toHaveValue('')
  })

  test('고정이 409 로 거절되면 토스트를 띄우고 목록을 다시 읽어 다른 곳에서 바뀐 상태를 맞춘다', async () => {
    const { user, api } = await openMemory([memoryItem(2, { scope: 'ISSUE', content: '이슈 메모' })])
    const before = api.lists()
    api.failNext(409, 'AI_MEMORY_PIN_FULL', '이슈 메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요')
    await user.click(inRow(rows()[0]).getByTestId('ai-memory-pin'))
    expect(await screen.findByText('이슈 메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요')).toBeInTheDocument()
    expect(inRow(rows()[0]).getByTestId('ai-memory-pin')).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before))
  })
})

// WP-385 「AI가 정리한 기록」 — 안내 줄(지난 30일 횟수, 0이면 숨김), 기록 대화상자(날짜 묶음·문구·출처 링크), 되돌리기(경로·목록 반영·409·포커스).
describe('AI가 정리한 기록 (WP-385)', () => {
  const SESSION = '11111111-2222-4333-8444-555555555555'
  /** 시안과 같은 다섯 기록(최신순). */
  const FIVE = () => [
    memoryChange(5, { memory: memorySnap(51, 'WP 프로젝트 배포 일을 맡고 있다'), source: { id: SESSION, title: '배포 순서 정리하고 체크리스트 만들기' } }),
    memoryChange(4, { action: 'MERGED', memory: memorySnap(41, '보고서·요약은 표로 정리한다'), before: [memorySnap(41, '주간 보고서는 표로'), memorySnap(42, '요약은 표 형식 선호')] }),
    memoryChange(3, { action: 'UPDATED', createdAt: '2026-10-14T09:10:00Z', memory: memorySnap(31, '아침 회의는 10시'), before: [memorySnap(31, '아침 회의는 9시')] }),
    memoryChange(2, { action: 'DECAYED', createdAt: '2026-10-13T18:00:00Z', memory: null, before: [memorySnap(21, '출장 중엔 메일 요약만 보여 준다')] }),
    memoryChange(1, {
      action: 'FORGOTTEN',
      createdAt: '2026-10-09T07:25:00Z',
      memory: null,
      before: [memorySnap(11, '회의록은 영어로 쓴다')],
      reason: '회의록은 한국어로 써 달라고 함',
      undoneAt: '2026-10-09T08:02:00Z',
    }),
  ]
  // 2026-10-15(목) 12:00 KST — 오늘·어제·날짜 묶음을 고정한다.
  const freeze = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
  }
  afterEach(() => vi.useRealTimers())

  /** 기록 대화상자를 연다. */
  async function openLog(user: User) {
    await user.click(await screen.findByTestId('ai-memory-cleanup-open'))
    return screen.findByTestId('ai-memory-cleanup-dialog')
  }
  const logItems = () => within(screen.getByTestId('ai-memory-cleanup-dialog')).queryAllByTestId('memory-log-item')

  test('지난 30일 정리가 0번이면 안내 줄이 없다', async () => {
    const changes = memoryChangesApi([], 0)
    await openMemory([], { changes })
    await waitFor(() => expect(changes.lists.length).toBeGreaterThan(0))
    expect(screen.getByTestId('ai-memory-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-memory-cleanup-notice')).not.toBeInTheDocument()
  })

  test('안내 줄의 기록 보기로 날짜 묶음·동작 문구·이전 내용·출처 링크·되돌리기 설명을 본다', async () => {
    freeze()
    const changes = memoryChangesApi([FIVE()])
    const { user } = await openMemory([], { changes })
    expect(await screen.findByTestId('ai-memory-cleanup-notice')).toHaveTextContent('지난 30일 동안 AI가 메모리를 5번 정리했어요')
    // 안내 줄은 한 건짜리 묶음(size=1)으로 횟수만 읽고, 기록 목록은 열기 전에는 받지 않는다.
    expect(changes.lists.map((u) => u.searchParams.get('size'))).toEqual(['1'])
    const dialogEl = await openLog(user)
    const dialog = within(dialogEl)
    expect(await dialog.findByRole('heading', { name: 'AI가 정리한 기록' })).toBeInTheDocument()
    expect(dialogEl).toHaveTextContent('직접 추가했거나 고정한 메모리는 바꾸지 않아요')

    await waitFor(() => expect(dialog.getAllByRole('region')).toHaveLength(3))
    const first = dialog.getAllByRole('region')[0]
    // 묶음 이름은 제목(h3)을 가리켜 한 번만 읽힌다(aria-label 로 같은 말을 두 번 싣지 않는다).
    expect(first).not.toHaveAttribute('aria-label')
    expect(first.getAttribute('aria-labelledby')).toBeTruthy()
    expect(within(dialog.getByRole('region', { name: '오늘' })).getAllByTestId('memory-log-item')).toHaveLength(2)
    expect(within(dialog.getByRole('region', { name: '어제' })).getAllByTestId('memory-log-item')).toHaveLength(2)
    expect(within(dialog.getByRole('region', { name: '10월 9일 금요일' })).getAllByTestId('memory-log-item')).toHaveLength(1)

    const it = logItems().map((el) => within(el))
    expect(it[0].getByTestId('memory-log-label')).toHaveTextContent('새로 기억함')
    expect(logItems()[0]).toHaveTextContent('오전 11:40')
    expect(it[0].getByTestId('memory-log-source')).toHaveAttribute('href', `/?aiChat=${SESSION}`)
    expect(it[1].getByTestId('memory-log-label')).toHaveTextContent('2개를 합침')
    expect(it[1].getByTestId('memory-log-details')).toHaveTextContent('합치기 전: 주간 보고서는 표로 · 요약은 표 형식 선호')
    expect(it[2].getByTestId('memory-log-label')).toHaveTextContent('고침')
    expect(it[2].getByTestId('memory-log-details')).toHaveTextContent('이전: 아침 회의는 9시')
    expect(it[3].getByTestId('memory-log-label')).toHaveTextContent('90일 동안 쓰지 않아 지움')
    // 지운 기록 내용은 취소선 — 계산된 스타일은 브라우저 몫이라 클래스로 본다(실제 모습은 E2E 캡처).
    expect(it[3].getByTestId('memory-log-content')).toHaveClass('line-through')
    expect(it[4].getByTestId('memory-log-label')).toHaveTextContent('대화와 맞지 않아 지움')
    expect(it[4].getByTestId('memory-log-details')).toHaveTextContent('회의록은 한국어로 써 달라고 함')
    // 되돌린 기록은 시각만 보이고 버튼이 없다. 처음부터 되돌린 기록에는 포커스를 옮기지 않는다.
    expect(it[4].getByTestId('memory-log-undone')).toHaveTextContent('되돌림 · 오후 5:02')
    expect(it[4].getByTestId('memory-log-undone')).not.toHaveFocus()
    expect(it[4].queryByTestId('memory-log-undo')).not.toBeInTheDocument()
    // 「되돌리기」 버튼마다 무엇을 되돌리는지(동작 문구·내용)를 설명으로 잇는다.
    expect(it[0].getByTestId('memory-log-undo')).toHaveAccessibleName('되돌리기')
    expect(it[0].getByTestId('memory-log-undo')).toHaveAccessibleDescription('새로 기억함 WP 프로젝트 배포 일을 맡고 있다')
    expect(it[2].getByTestId('memory-log-undo')).toHaveAccessibleDescription('고침 아침 회의는 10시')
  })

  test('되돌리면 그 기록의 경로로 요청하고 되돌림으로 바뀌며 포커스를 옮기고 메모리 목록을 다시 읽는다', async () => {
    freeze()
    const changes = memoryChangesApi([FIVE()])
    const { user, api } = await openMemory([memoryItem(51, { content: 'WP 프로젝트 배포 일을 맡고 있다' })], { changes })
    await openLog(user)
    await waitFor(() => expect(logItems()).toHaveLength(5))
    const listsBefore = api.lists()
    await user.click(within(logItems()[0]).getByTestId('memory-log-undo'))
    await waitFor(() => expect(within(logItems()[0]).getByTestId('memory-log-undone')).toHaveTextContent('되돌림 · 오후 12:00'))
    expect(changes.undos.map((u) => u.pathname)).toEqual(['/api/v1/users/me/ai-memories/changes/5/undo'])
    expect(within(logItems()[0]).queryByTestId('memory-log-undo')).not.toBeInTheDocument()
    // 버튼이 사라져도 포커스를 잃지 않는다 — 되돌림 표시로 옮겨 키보드·화면 낭독기 사용자가 결과를 듣고 이어 간다.
    await waitFor(() => expect(within(logItems()[0]).getByTestId('memory-log-undone')).toHaveFocus())
    expect(await screen.findByText('되돌렸어요')).toBeInTheDocument()
    await waitFor(() => expect(api.lists()).toBeGreaterThan(listsBefore))
  })

  test('그 뒤 바뀐 메모리면 409 를 토스트로 알리고 기록은 그대로 두며 기록을 다시 읽는다', async () => {
    freeze()
    const changes = memoryChangesApi([FIVE()])
    changes.refuseNext(409, 'AI_MEMORY_CHANGED')
    const { user } = await openMemory([], { changes })
    await openLog(user)
    await waitFor(() => expect(logItems()).toHaveLength(5))
    const listsBefore = changes.lists.length
    await user.click(within(logItems()[2]).getByTestId('memory-log-undo'))
    expect(await screen.findByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeInTheDocument()
    expect(within(logItems()[2]).getByTestId('memory-log-undo')).toBeEnabled()
    expect(within(logItems()[2]).queryByTestId('memory-log-undone')).not.toBeInTheDocument()
    // 거절은 기록이 서버와 어긋났다는 뜻이다 — 기록을 다시 읽어 맞춘다.
    await waitFor(() => expect(changes.lists.length).toBeGreaterThan(listsBefore))
  })

  test('거절된 항목이 다시 읽은 기록에서 되돌림으로 바뀌어도 포커스를 그리로 옮기지 않는다', async () => {
    freeze()
    const changes = memoryChangesApi([FIVE()])
    const { user } = await openMemory([], { changes })
    await openLog(user)
    await waitFor(() => expect(logItems()).toHaveLength(5))
    // 이 화면의 되돌리기는 거절되고, 그사이 다른 탭에서 같은 기록을 되돌렸다.
    changes.refuseNext(409, 'AI_MEMORY_CHANGED')
    changes.markUndone(3)
    await user.click(within(logItems()[2]).getByTestId('memory-log-undo'))
    expect(await screen.findByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeInTheDocument()
    await waitFor(() => expect(within(logItems()[2]).getByTestId('memory-log-undone')).toHaveTextContent('되돌림 · 오후 12:00'))
    expect(within(logItems()[2]).getByTestId('memory-log-undone')).not.toHaveFocus()
  })

  test('설정에서 메모리를 고정하거나 지우면 「AI가 정리한 기록」도 다시 읽는다', async () => {
    const changes = memoryChangesApi([FIVE()])
    const { user, api } = await openMemory([memoryItem(2, { content: '답은 존댓말로 한다' }), memoryItem(1, { content: '보고서는 표로' })], { changes })
    await waitFor(() => expect(changes.lists.length).toBeGreaterThan(0))
    const before = changes.lists.length
    await user.click(inRow(row('답은 존댓말로')).getByTestId('ai-memory-pin'))
    // 고정·지우기·고치기는 기록의 되돌리기 가능 여부와 안내 줄 숫자를 바꿀 수 있다 — 기록도 다시 읽는다.
    await waitFor(() => expect(api.pins()).toHaveLength(1))
    await waitFor(() => expect(changes.lists.length).toBe(before + 1))
    await user.click(inRow(row('보고서는 표로')).getByTestId('ai-memory-delete'))
    await waitFor(() => expect(api.deletes()).toHaveLength(1))
    await waitFor(() => expect(changes.lists.length).toBe(before + 2))
  })

  test('정리 뒤 그대로인 메모리 행은 메타가 「AI가 정리 · 날짜」, 아니면 그대로다', async () => {
    freeze()
    await openMemory([
      memoryItem(2, { content: '보고서·요약은 표로 정리한다', cleanedAt: '2026-10-15T02:40:00Z', updatedAt: '2026-10-15T02:40:00Z' }),
      memoryItem(1, { content: '답은 존댓말로 한다', source: 'USER' }),
      memoryItem(3, { content: '이슈 목록은 표로 보여 준다' }),
    ])
    const meta = (text: string) => inRow(row(text)).getByTestId('ai-memory-meta')
    expect(meta('보고서·요약')).toHaveTextContent('AI가 정리 · 2026-10-15')
    expect(meta('존댓말')).toHaveTextContent('직접 추가')
    expect(meta('이슈 목록')).toHaveTextContent('AI가 저장')
  })

  test('첫 묶음을 받는 동안은 스켈레톤을, 실패하면 이유 문구와 다시 시도를 보이고 다시 시도하면 처음부터 다시 받는다', async () => {
    freeze()
    const changes = memoryChangesApi([FIVE()])
    // 기록 목록(size=30) 요청만 실패시키고 안내 줄 횟수(size=1)는 정상으로 둔다. 풀기 전엔 응답을 붙들어 로딩 상태를 본다.
    const held = gate()
    changes.failListWhen((u) => u.searchParams.get('size') !== '1', held.p)
    const { user } = await openMemory([], { changes })
    const dialogEl = await openLog(user)
    const dialog = within(dialogEl)
    // 받는 중: 글자 대신 항목 모양 스켈레톤(스크린리더에는 상태 한 줄).
    expect(await dialog.findByTestId('ai-memory-cleanup-loading')).toHaveAccessibleName('기록을 불러오는 중')
    expect(dialogEl).not.toHaveTextContent('불러오는 중…')
    await act(async () => held.release())
    const error = await dialog.findByTestId('ai-memory-cleanup-error')
    expect(error).toHaveTextContent('기록을 불러오지 못했어요')
    expect(dialog.queryByTestId('ai-memory-cleanup-loading')).not.toBeInTheDocument()
    expect(dialog.queryAllByTestId('memory-log-item')).toHaveLength(0)

    // 다시 시도: 첫 묶음(cursor 없음)을 다시 받아 목록으로 바뀐다.
    changes.failListWhen(null)
    const before = changes.lists.length
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(dialog.getAllByTestId('memory-log-item')).toHaveLength(5))
    expect(changes.lists.length).toBe(before + 1)
    expect(changes.lists.at(-1)!.searchParams.get('cursor')).toBeNull()
    expect(dialog.queryByTestId('ai-memory-cleanup-error')).not.toBeInTheDocument()
  })
})
