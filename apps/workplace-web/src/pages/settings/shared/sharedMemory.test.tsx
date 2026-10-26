// 설정 › AI 비서 › 메모리 「공용 메모리」 탭(SharedMemoryTab, WP-386) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 공간 묶음·개수·공간 검색칸(10개 초과), 서버 검색(q)·일치 개수, 직접 추가 payload·행 메타, 권한별 고치기(PATCH)·지우기(DELETE), 조직 읽기 전용,
// 공간 없음, 가득 찬 공간, 기록 대화상자(동작·행위자·undoable·되돌리기·409 두 종·로딩·실패·다시 시도)는 브라우저 없이 판정되므로
// e2e/pages/settings/ai-shared-memory.spec.ts·ai-shared-memory-history.spec.ts 에서 옮겼다.
// 탭 전환·딥링크 배선(@wiring)·인피니트 스크롤·좁은 폭 선택 상자(@layout)는 ai-shared-memory.spec.ts 에 남는다.
// 탭만 renderScreen 으로 띄운다 — 고른 공간은 주소(?space=)로 준다. jsdom 은 컨테이너 쿼리가 없어 공간 목록·선택 상자가 함께 그려진다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { SharedMemoryOrigin } from '@/types/sharedAiMemory'

import { gate, sharedChange, sharedItem, sharedMemoryApi, sharedSpace } from '../memoryTestkit-b7'
import { SharedMemoryTab } from './SharedMemoryTab'

const ORG = sharedSpace({ type: 'ORG', id: null, key: null, name: '조직', label: '조직', canAdd: false, canManage: false })
const WP = sharedSpace({})
const NOTE = sharedSpace({ type: 'WIKI_SPACE', id: 3, key: null, name: '개발팀 노트', label: '개발팀 노트', canAdd: true })

/** 공용 메모리 탭을 띄운다 — space 를 주면 그 공간을 고른 채(딥링크). */
async function openShared(opts: Parameters<typeof sharedMemoryApi>[0], space?: string) {
  const api = sharedMemoryApi(opts)
  const q = new URLSearchParams({ memoryTab: 'shared', ...(space ? { space } : {}) })
  const view = renderScreen(<SharedMemoryTab />, { path: `/settings/assistant?${q.toString()}`, handlers: api.handlers })
  // 공간 목록을 받은 뒤(공간이 있으면 목록 몸통까지) 단언한다.
  if (opts.spaces.length > 0) await screen.findByTestId('shared-space-body')
  return { ...view, api }
}

type User = Awaited<ReturnType<typeof openShared>>['user']
const rows = () => screen.queryAllByTestId('shared-memory-row')
const spaceItem = (text: string) => screen.getAllByTestId('shared-space-item').find((el) => el.textContent?.includes(text))!

async function fill(user: User, el: HTMLElement, value: string) {
  await user.clear(el)
  if (value) await user.paste(value)
}

describe('공용 메모리 목록', () => {
  test('딥링크로 고른 공간의 목록을 그 공간 쿼리로 받아 보이고, 다른 공간을 고르면 주소가 바뀐다', async () => {
    const { user, api, location } = await openShared(
      { spaces: [ORG, WP, NOTE], items: { 'WIKI_SPACE:3': [sharedItem(1, { content: '용어집은 이 스페이스에 둔다' })] } },
      'WIKI_SPACE:3',
    )
    expect(document.querySelector('[data-testid="shared-space-item"][aria-current="true"]')).toHaveAttribute('data-space', 'WIKI_SPACE:3')
    expect(screen.getByTestId('shared-space-title')).toHaveTextContent('개발팀 노트')
    await waitFor(() => expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('용어집은 이 스페이스에 둔다')]))
    const last = api.lists().at(-1)!.url
    expect([last.searchParams.get('spaceType'), last.searchParams.get('spaceId')]).toEqual(['WIKI_SPACE', '3'])

    await user.click(spaceItem('Smart Workplace(WP)'))
    await waitFor(() => expect(location()).toContain('space=PROJECT%3A12'))
  })

  test('공간은 조직·프로젝트·노트 스페이스로 묶이고 개수를 보이며, 10개를 넘을 때만 공간 검색칸이 생긴다', async () => {
    await openShared({ spaces: [ORG, WP, NOTE], items: { 'PROJECT:12': [sharedItem(1), sharedItem(2)] } })
    const list = screen.getByTestId('shared-space-list')
    // 시안 v2: 묶음 소제목은 「조직」, 그 안의 공간 이름이 「조직 지침」(거꾸로가 아니다).
    expect(list.querySelector('p')).toHaveTextContent('조직')
    expect(screen.getAllByTestId('shared-space-item')[0]).toHaveTextContent('조직 지침')
    expect(list).toHaveTextContent('프로젝트')
    expect(list).toHaveTextContent('노트 스페이스')
    expect(spaceItem('Smart Workplace(WP)')).toHaveTextContent('2')
    expect(screen.queryByTestId('shared-space-search')).not.toBeInTheDocument()
  })

  test('공간이 10개를 넘으면 공간 검색칸으로 공간을 거른다', async () => {
    const many = Array.from({ length: 11 }, (_, i) => sharedSpace({ id: 20 + i, key: `P${i}`, name: `프로젝트 ${i}`, label: `프로젝트 ${i}(P${i})` }))
    const { user } = await openShared({ spaces: [ORG, ...many] })
    await fill(user, screen.getByTestId('shared-space-search'), 'P10')
    await waitFor(() => expect(screen.getAllByTestId('shared-space-item').map((el) => el.textContent)).toEqual([expect.stringMatching(/프로젝트 10\(P10\)/)]))
  })

  test('검색어는 서버 q 로 보내고 일치 개수·없음 문구를 보인다', async () => {
    const { user, api } = await openShared(
      { spaces: [WP], items: { 'PROJECT:12': [sharedItem(1, { content: '배포는 API 먼저 한다' }), sharedItem(2, { content: '배포 전날 기능 동결' }), sharedItem(3, { content: '회의록은 당일에' })] } },
      'PROJECT:12',
    )
    await waitFor(() => expect(rows()).toHaveLength(3))
    await fill(user, screen.getByTestId('shared-memory-search'), '배포')
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.getByTestId('shared-memory-matched')).toHaveTextContent('2개 일치')
    expect(api.lists().at(-1)!.url.searchParams.get('q')).toBe('배포')
    await fill(user, screen.getByTestId('shared-memory-search'), '없는말')
    await waitFor(() => expect(screen.getByTestId('shared-memory-matched')).toHaveTextContent("'없는말'과 일치하는 공용 메모리가 없어요."))
  })

  test('직접 추가는 그 공간으로 보내고 새 항목이 맨 위에 「내 이름 직접 추가」로 보이며 공간 개수가 는다', async () => {
    const { user, api } = await openShared({ spaces: [WP], items: { 'PROJECT:12': [sharedItem(1)] } }, 'PROJECT:12')
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(screen.getByTestId('shared-memory-add'))
    await fill(user, screen.getByTestId('shared-memory-add-input'), '  이슈 본문은 배경·할 일·완료 조건 순서로 쓴다 ')
    await user.click(screen.getByTestId('shared-memory-add-submit'))
    await waitFor(() => expect(within(rows()[0]).getByTestId('shared-memory-content')).toHaveTextContent('이슈 본문은 배경·할 일·완료 조건 순서로 쓴다'))
    expect(api.creates().map((c) => c.body)).toEqual([{ spaceType: 'PROJECT', spaceId: 12, content: '이슈 본문은 배경·할 일·완료 조건 순서로 쓴다' }])
    expect(within(rows()[0]).getByTestId('shared-memory-meta')).toHaveTextContent('양동희 직접 추가')
    await waitFor(() => expect(spaceItem('Smart Workplace(WP)')).toHaveTextContent('2'))
  })

  test('고치기·지우기는 canEdit 인 행에만 보이고, 고치기는 PATCH·지우기는 DELETE 다', async () => {
    const { user, api } = await openShared(
      {
        spaces: [WP],
        items: {
          'PROJECT:12': [
            sharedItem(2, { content: '내가 요청한 규칙', origin: 'USER_REQUESTED', author: { name: '양동희' }, canEdit: true }),
            sharedItem(1, { content: '남의 규칙', origin: 'USER_ADDED', author: { name: '김철수' } }),
          ],
        },
      },
      'PROJECT:12',
    )
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(within(rows()[0]).getByTestId('shared-memory-edit')).toBeInTheDocument()
    expect(within(rows()[1]).queryByTestId('shared-memory-edit')).not.toBeInTheDocument()
    expect(within(rows()[1]).queryByTestId('shared-memory-delete')).not.toBeInTheDocument()

    await user.click(within(rows()[0]).getByTestId('shared-memory-edit'))
    await fill(user, screen.getByTestId('shared-memory-edit-input'), '고친 규칙')
    await user.click(screen.getByTestId('shared-memory-edit-submit'))
    await waitFor(() => expect(within(rows()[0]).getByTestId('shared-memory-content')).toHaveTextContent('고친 규칙'))
    expect(api.updates().map((c) => c.body)).toEqual([{ content: '고친 규칙' }])

    await user.click(within(rows()[0]).getByTestId('shared-memory-delete'))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(api.deletes().map((c) => c.url.pathname)).toEqual(['/api/v1/shared-ai-memories/2'])
    expect(await screen.findByText('지웠어요. 기록에서 되돌릴 수 있어요')).toBeInTheDocument()
  })

  test('조직 지침은 관리자가 아니면 읽기만 — 추가 버튼·행 아이콘이 없다', async () => {
    await openShared({ spaces: [ORG], items: { ORG: [sharedItem(1, { content: '고객 이름은 문서에 쓰지 않는다', origin: 'USER_ADDED', author: { name: '관리자' } })] } }, 'ORG')
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.getByTestId('shared-space-title')).toHaveTextContent('조직 지침')
    expect(screen.queryByTestId('shared-memory-full-hint')).not.toBeInTheDocument()
    expect(screen.getByTestId('shared-space-hint')).toHaveTextContent('관리자만 바꿀 수 있어요')
    expect(screen.queryByTestId('shared-memory-add')).not.toBeInTheDocument()
    expect(screen.queryByTestId('shared-memory-edit')).not.toBeInTheDocument()
  })

  test('행 메타 — 요청·직접 추가는 이름, AI 정리·대화에서 기억은 이름 없이', async () => {
    await openShared(
      {
        spaces: [WP],
        items: {
          'PROJECT:12': [
            sharedItem(4, { origin: 'USER_REQUESTED', author: { name: '김철수' }, updatedAt: '2026-10-14T12:00:00Z' }),
            sharedItem(3, { origin: 'USER_ADDED', author: { name: '이영희' }, updatedAt: '2026-10-13T12:00:00Z' }),
            sharedItem(2, { origin: 'AI_CLEANED', updatedAt: '2026-10-12T12:00:00Z' }),
            sharedItem(1, { origin: 'AI_EXTRACTED', updatedAt: '2026-10-11T12:00:00Z' }),
          ],
        },
      },
      'PROJECT:12',
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('shared-memory-meta').map((el) => el.textContent)).toEqual([
        '김철수 요청 · 2026-10-14',
        '이영희 직접 추가 · 2026-10-13',
        'AI가 정리 · 2026-10-12',
        '대화에서 AI가 기억 · 2026-10-11',
      ]),
    )
  })

  test('읽을 공간이 하나도 없으면 안내만 보인다', async () => {
    await openShared({ spaces: [] })
    expect(await screen.findByText('아직 볼 수 있는 공용 메모리 공간이 없어요.')).toBeInTheDocument()
  })

  test('가득 찬 공간은 추가 버튼이 꺼지고 이유 한 줄을 잇는다', async () => {
    const full = Array.from({ length: 50 }, (_, i) => sharedItem(i + 1))
    await openShared({ spaces: [sharedSpace({ count: 50 })], items: { 'PROJECT:12': full } }, 'PROJECT:12')
    await waitFor(() => expect(screen.getByTestId('shared-space-count')).toHaveTextContent('50 / 50'))
    expect(screen.getByTestId('shared-memory-add')).toBeDisabled()
    expect(screen.getByTestId('shared-memory-full-hint')).toHaveTextContent(/가득 찼어요 — 지우거나 합친 뒤 추가할 수 있어요/)
    expect(screen.getByTestId('shared-memory-add')).toHaveAttribute('aria-describedby', 'shared-memory-full-hint')
  })

  test('한 칸 남은 공간은 추가 버튼이 켜지고 가득 참 안내가 없다', async () => {
    const items = Array.from({ length: 49 }, (_, i) => sharedItem(i + 2))
    await openShared({ spaces: [sharedSpace({ count: 49 })], items: { 'PROJECT:12': items } }, 'PROJECT:12')
    await waitFor(() => expect(screen.getByTestId('shared-space-count')).toHaveTextContent('49 / 50'))
    expect(screen.getByTestId('shared-memory-add')).toBeEnabled()
    expect(screen.queryByTestId('shared-memory-full-hint')).not.toBeInTheDocument()
  })
})

// WP-386 공용 메모리 기록(대화상자) — 동작 문구·행위자, 출처 대화 링크 없음, 서버 undoable 만 되돌리기, 되돌리기 → 되돌림 표시·목록 다시 읽기, 409 두 종.
describe('공용 메모리 기록', () => {
  const READER = sharedSpace({ canManage: false })
  const snap = (id: number, content: string, origin: SharedMemoryOrigin = 'AI_EXTRACTED') => ({ id, content, origin })
  const logItems = () => within(screen.getByTestId('shared-memory-history-dialog')).queryAllByTestId('memory-log-item')

  async function openHistory(user: User) {
    await user.click(screen.getByTestId('shared-memory-history-open'))
    return screen.findByTestId('shared-memory-history-dialog')
  }

  test('기록 보기는 그 공간 기록을 동작·행위자와 함께 보이고 출처 대화 링크는 없으며 서버가 허락한 기록에만 되돌리기가 있다', async () => {
    const { user, api } = await openShared(
      {
        spaces: [READER],
        changes: {
          'PROJECT:12': [
            sharedChange(5, { action: 'MERGED', memory: snap(9, '회의록은 당일에 올리고 요약은 다음 날', 'AI_CLEANED'), before: [snap(9, '회의록은 당일에'), snap(8, '요약은 다음 날')], undoable: false }),
            sharedChange(4, { action: 'ADDED', actor: { kind: 'USER', name: '이영희' }, memory: snap(7, '회의록은 당일에 올린다', 'USER_ADDED'), undoable: false }),
            sharedChange(3, { action: 'ADDED', actor: { kind: 'USER', name: '양동희' }, memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED'), undoable: true }),
          ],
        },
      },
      'PROJECT:12',
    )
    const dialog = await openHistory(user)
    await waitFor(() => expect(logItems()).toHaveLength(3))
    const url = api.changeLists().at(-1)!.url
    expect([url.searchParams.get('spaceType'), url.searchParams.get('spaceId')]).toEqual(['PROJECT', '12'])
    expect(dialog).toHaveTextContent('내가 추가했거나 요청한 항목은 되돌릴 수 있어요')
    expect(within(dialog).getAllByTestId('memory-log-label').map((el) => el.textContent)).toEqual(['합침', '직접 추가함', '새로 기억함'])
    // 행위자는 동작 문구 바로 뒤(「합침 · AI · 시각」).
    expect(logItems()[0].querySelector('p')).toHaveTextContent('합침 · AI ·')
    expect(logItems()[0]).toHaveTextContent('합치기 전')
    expect(logItems()[1].querySelector('p')).toHaveTextContent('직접 추가함 · 이영희 ·')
    expect(within(dialog).queryByTestId('memory-log-source')).not.toBeInTheDocument()
    expect(within(logItems()[0]).queryByTestId('memory-log-undo')).not.toBeInTheDocument()
    expect(within(logItems()[1]).queryByTestId('memory-log-undo')).not.toBeInTheDocument()
    expect(within(logItems()[2]).getByTestId('memory-log-undo')).toBeInTheDocument()
  })

  test('되돌리면 그 기록이 되돌림으로 바뀌고 목록·개수를 다시 읽는다', async () => {
    const { user, api } = await openShared(
      { spaces: [READER], changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED') })] } },
      'PROJECT:12',
    )
    await waitFor(() => expect(api.lists().length).toBeGreaterThan(0))
    const listsBefore = api.lists().length
    await openHistory(user)
    await waitFor(() => expect(logItems()).toHaveLength(1))
    await user.click(within(logItems()[0]).getByTestId('memory-log-undo'))
    expect(await within(logItems()[0]).findByTestId('memory-log-undone')).toBeInTheDocument()
    expect(api.undos().map((c) => c.url.pathname)).toEqual(['/api/v1/shared-ai-memories/changes/3/undo'])
    expect(await screen.findByText('되돌렸어요')).toBeInTheDocument()
    await waitFor(() => expect(api.lists().length).toBeGreaterThan(listsBefore))
  })

  test('그 뒤에 바뀐 메모리·이미 되돌린 기록이면 안내 토스트를 띄운다', async () => {
    const { user, api } = await openShared(
      { spaces: [READER], changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, 'a') }), sharedChange(2, { memory: snap(5, 'b') })] } },
      'PROJECT:12',
    )
    await openHistory(user)
    await waitFor(() => expect(logItems()).toHaveLength(2))
    api.failNext(409, 'SHARED_MEMORY_CHANGED')
    await user.click(within(logItems()[0]).getByTestId('memory-log-undo'))
    expect(await screen.findByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeInTheDocument()
    expect(within(logItems()[0]).queryByTestId('memory-log-undone')).not.toBeInTheDocument()
    api.failNext(409, 'SHARED_MEMORY_CHANGE_UNDONE')
    await user.click(within(logItems()[1]).getByTestId('memory-log-undo'))
    expect(await screen.findByText('이미 되돌린 기록이에요')).toBeInTheDocument()
  })

  test('기록을 받는 동안은 스켈레톤을, 실패하면 이유 문구와 다시 시도를 보이고 다시 시도하면 처음부터 다시 받는다', async () => {
    const { user, api } = await openShared(
      { spaces: [READER], changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED') })] } },
      'PROJECT:12',
    )
    const held = gate()
    api.failChangeLists(held.p)
    const dialog = within(await openHistory(user))
    // 받는 중: 글자 대신 항목 모양 스켈레톤(스크린리더에는 상태 한 줄).
    expect(await dialog.findByTestId('shared-memory-history-loading')).toHaveAccessibleName('기록을 불러오는 중')
    await act(async () => held.release())
    const error = await dialog.findByTestId('shared-memory-history-error')
    expect(error).toHaveTextContent('기록을 불러오지 못했어요')
    expect(dialog.queryByTestId('shared-memory-history-loading')).not.toBeInTheDocument()
    expect(dialog.queryAllByTestId('memory-log-item')).toHaveLength(0)

    api.failChangeLists('off')
    const before = api.changeLists().length
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(dialog.getAllByTestId('memory-log-item')).toHaveLength(1))
    expect(api.changeLists().length).toBe(before + 1)
    expect(api.changeLists().at(-1)!.url.searchParams.get('cursor')).toBeNull()
    expect(dialog.queryByTestId('shared-memory-history-error')).not.toBeInTheDocument()
  })
})
