// 버전 기록 고친 사람 → 사람 카드(WP-1768) — 이름을 누르면 카드, 이름 밖을 누르면 그 판 고르기.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import type { WikiRevisionList as WikiRevisionListData } from '../../types/wiki'
import type { WikiRevisionHistory } from './useWikiRevisionHistory'
import { WikiRevisionList } from './WikiRevisionPanel'

const KIM = { id: 2, name: '김철수' }
const PARK = { id: 3, name: '박민수' }
const LEE = { id: 5, name: '이영희' }
const iso = new Date('2026-10-07T14:05:00+09:00').toISOString()
const item = (version: number, editors: { id: number; name: string }[], aiActor: { id: number; name: string } | null = null) => ({
  version, title: 't', editedAt: iso, createdAt: iso, reason: aiActor ? ('AI' as const) : ('SESSION' as const), editors, aiActor,
})
const DATA: WikiRevisionListData = {
  current: { version: 7, editedAt: iso, editors: [KIM] },
  items: [item(6, [LEE], LEE), item(5, [KIM, PARK]), item(4, [KIM, PARK, LEE])],
}

function setup(over: { blockedReason?: string | null } = {}) {
  const select = vi.fn()
  const clearSelection = vi.fn()
  const revisions = {
    list: { data: DATA, isLoading: false, isError: false },
    selectedVersion: null,
    blockedReason: over.blockedReason ?? null,
    select,
    clearSelection,
  } as unknown as WikiRevisionHistory
  const view = renderScreen(<WikiRevisionList revisions={revisions} />, {
    handlers: [
      http.get('/api/v1/members/:id', ({ params }) =>
        HttpResponse.json({ userId: Number(params.id), username: 'u', name: '김철수', email: 'a@b.c', title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null, department: null }),
      ),
      http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ id: 2, username: 'u', name: '김철수', email: 'a@b.c', title: null, kind: 'HUMAN', groups: [], isFavorite: false })),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
    ],
  })
  return { ...view, select, clearSelection }
}

test('편집자 이름을 누르면 카드가 열리고 판은 골라지지 않는다', async () => {
  const { user, select } = setup()
  const row = screen.getByTestId('wiki-revision-item-5').closest('li')!
  await user.click(within(row).getByTestId('person-card-trigger-3'))
  expect(await screen.findByTestId('person-card')).toBeInTheDocument()
  expect(select).not.toHaveBeenCalled()
})

test('이름 밖을 누르면 판이 골라진다', async () => {
  const { user, select } = setup()
  await user.click(screen.getByTestId('wiki-revision-item-5'))
  expect(select).toHaveBeenCalledWith(5)
  expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
})

test('세 명이면 첫 이름만 트리거이고 「외 2명」이 글자로 보인다', () => {
  setup()
  const row = screen.getByTestId('wiki-revision-item-4').closest('li')!
  expect(within(row).getAllByTestId(/^person-card-trigger-/)).toHaveLength(1)
  expect(within(row).getByTestId('person-card-trigger-2')).toHaveTextContent('김철수')
  expect(row).toHaveTextContent('김철수 외 2명')
})

test('두 명이면 이름마다 트리거다', () => {
  setup()
  const row = screen.getByTestId('wiki-revision-item-5').closest('li')!
  expect(within(row).getAllByTestId(/^person-card-trigger-/)).toHaveLength(2)
})

test('AI 수정 판은 요청자 이름이 트리거이고 「(AI 수정)」은 글자다', () => {
  setup()
  const row = screen.getByTestId('wiki-revision-item-6').closest('li')!
  expect(within(row).getByTestId('person-card-trigger-5')).toHaveTextContent('이영희')
  expect(row).toHaveTextContent('이영희 (AI 수정)')
})

test('현재 버전 줄의 편집 중인 사람도 트리거다', () => {
  setup()
  const row = screen.getByTestId('wiki-revision-item-current').closest('li')!
  expect(within(row).getByTestId('person-card-trigger-2')).toBeInTheDocument()
  expect(row).toHaveTextContent('편집 중')
})

test('막힌 행의 고르기 단추는 비활성이어도 이름 트리거는 카드를 연다', async () => {
  const { user, select } = setup({ blockedReason: 'AI 작성 중에는 이전 버전을 볼 수 없습니다' })
  expect(screen.getByTestId('wiki-revision-item-5')).toBeDisabled()
  const row = screen.getByTestId('wiki-revision-item-5').closest('li')!
  await user.click(within(row).getByTestId('person-card-trigger-3'))
  expect(await screen.findByTestId('person-card')).toBeInTheDocument()
  expect(select).not.toHaveBeenCalled()
})

test('키보드: 고르기 단추 다음에 이름 트리거가 탭 순서로 온다', async () => {
  const { user } = setup()
  screen.getByTestId('wiki-revision-item-5').focus()
  await user.tab()
  const row = screen.getByTestId('wiki-revision-item-5').closest('li')!
  expect(within(row).getByTestId('person-card-trigger-2')).toHaveFocus()
  await user.tab()
  expect(within(row).getByTestId('person-card-trigger-3')).toHaveFocus()
})

test('고르기 단추의 접근 설명에 편집자·꼬리말이 이어진다(이름은 시각뿐)', () => {
  setup()
  // 설명은 행 안 편집자 줄 글자 — 「외 n명」·「복원 전」·「편집 중」 등이 컨트롤과 끊기지 않는다.
  expect(screen.getByTestId('wiki-revision-item-4')).toHaveAccessibleDescription('김철수 외 2명')
  expect(screen.getByTestId('wiki-revision-item-6')).toHaveAccessibleDescription('이영희 (AI 수정)')
  expect(screen.getByTestId('wiki-revision-item-current')).toHaveAccessibleDescription('김철수 · 편집 중')
})

test('이름 칸만 줄어 말줄임하고 뒤 글자(쉼표·외 n명·(AI 수정))는 줄지 않는다 — 긴 이름 하나가 줄을 다 먹지 않게', () => {
  setup()
  // 일반 판(두 명·세 명)·AI 판(AiLabel 안) 모두 이름 트리거는 줄어드는 칸이다(button 은 바깥 truncate 가 닿지 않아 스스로 말줄임).
  for (const id of ['wiki-revision-item-4', 'wiki-revision-item-5', 'wiki-revision-item-6']) {
    const row = screen.getByTestId(id).closest('li')!
    for (const trigger of within(row).getAllByTestId(/^person-card-trigger-/)) {
      expect(trigger).toHaveClass('min-w-0', 'shrink', 'truncate')
      expect(trigger).not.toHaveClass('max-w-full')
    }
  }
  // 뒤 글자는 줄지 않는 칸(shrink-0) — 이름이 길어도 보인다.
  const tail = (id: string, text: string) =>
    within(screen.getByTestId(id).closest('li')!).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === text)
  expect(tail('wiki-revision-item-5', ', ')).toHaveClass('shrink-0')
  expect(tail('wiki-revision-item-4', ' 외 2명')).toHaveClass('shrink-0')
  expect(tail('wiki-revision-item-6', ' (AI 수정)')).toHaveClass('shrink-0')
})
