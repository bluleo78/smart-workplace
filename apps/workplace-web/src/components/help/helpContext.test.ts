// 도움말 문맥 판정(helpContext) — 신호 우선순위·도움말 id 층 올라가기·스크롤 칸 고르기·열린 대화상자 고르기를 순수 함수로 지킨다(WP-1506).
// 브라우저 신호 수집(useHelpContextSignals)·패널 연결보다 먼저 경계(잘못된 id, 관리자 장, 닫히는 중 대화상자, 패널 안 대화상자)를 여기서 고정한다.
import { describe, expect, it } from 'vitest'

import type { HelpIndexChapter, HelpIndexSection } from './helpBundle'
import {
  HELP_SCROLL_BASELINE,
  HELP_SCROLL_BASELINE_AT_BOTTOM,
  HELP_SCROLL_SETTLE_MS,
  type HelpBox,
  helpIdAncestors,
  pickOpenDialogHelp,
  pickScrollHelp,
  pickSignal,
  resolveContextTarget,
  resolveHelpId,
} from './helpContext'

/** 절 픽스처 — 목차 칸 모양 그대로(label 은 화면 칸 이름). */
const sec = (id: string, level: number, label: string, parent: string | null = null): HelpIndexSection => ({
  id,
  level,
  title: label,
  label,
  parent,
})

/** 예시 화면(API 토큰)의 장 — 일반 구성원 장. */
const mySettings: HelpIndexChapter = {
  chapter: 'my-settings',
  number: 12,
  title: '내 설정',
  routes: ['/settings/tokens'],
  audience: ['member'],
  sections: [
    sec('my-settings#_intro', 1, '내 설정'),
    sec('tokens', 2, 'API 토큰'),
    sec('tokens.issue', 3, 'API 토큰 발급', 'tokens'),
    sec('tokens.list', 3, 'API 토큰 목록', 'tokens'),
  ],
}

/** 관리자 장 — 일반 구성원에게는 이 장의 절이 보이지 않아야 한다. */
const agents: HelpIndexChapter = {
  chapter: 'agents',
  number: 20,
  title: 'AI 에이전트 관리',
  routes: ['/settings/agents'],
  audience: ['admin'],
  sections: [sec('agents#_intro', 1, 'AI 에이전트 관리'), sec('agent.run', 2, '실행')],
}

const index = [mySettings, agents]

describe('상수', () => {
  it('스크롤 정착·기준선은 설정 가이드(activeSection.ts)와 같은 값', () => {
    expect(HELP_SCROLL_SETTLE_MS).toBe(200)
    expect(HELP_SCROLL_BASELINE).toBe(0.3)
    expect(HELP_SCROLL_BASELINE_AT_BOTTOM).toBe(0.6)
  })
})

describe('pickSignal', () => {
  it('대화상자 > 포커스 > 스크롤', () => {
    expect(pickSignal({ dialog: 'tokens.issue', focus: 'tokens.list', scroll: 'tokens' })).toEqual({
      id: 'tokens.issue',
      source: 'dialog',
    })
    expect(pickSignal({ dialog: null, focus: 'tokens.list', scroll: 'tokens' })).toEqual({ id: 'tokens.list', source: 'focus' })
    expect(pickSignal({ dialog: null, focus: null, scroll: 'tokens' })).toEqual({ id: 'tokens', source: 'scroll' })
    expect(pickSignal({ dialog: null, focus: null, scroll: null })).toBeNull()
  })
})

describe('helpIdAncestors', () => {
  it('점으로 나눈 층을 자기부터 위로', () => {
    expect(helpIdAncestors('tokens.issue.name')).toEqual(['tokens.issue.name', 'tokens.issue', 'tokens'])
    expect(helpIdAncestors('tokens')).toEqual(['tokens'])
  })

  it('형식이 틀린 id 는 빈 목록', () => {
    expect(helpIdAncestors('Tokens')).toEqual([])
    expect(helpIdAncestors('')).toEqual([])
    expect(helpIdAncestors('tokens..issue')).toEqual([])
    expect(helpIdAncestors('my-settings#_intro')).toEqual([])
  })
})

describe('resolveHelpId', () => {
  it('없는 아래 층은 한 층씩 올라가 찾는다', () => {
    expect(resolveHelpId(index, 'tokens.issue.name', false)).toEqual({ chapter: 'my-settings', sectionId: 'tokens.issue' })
    expect(resolveHelpId(index, 'tokens.nothing', false)).toEqual({ chapter: 'my-settings', sectionId: 'tokens' })
  })

  it('관리자 장 절은 관리자에게만', () => {
    expect(resolveHelpId(index, 'agent.run', false)).toBeNull()
    expect(resolveHelpId(index, 'agent.run', true)).toEqual({ chapter: 'agents', sectionId: 'agent.run' })
  })

  it('끝까지 없거나 형식이 틀리면 null', () => {
    expect(resolveHelpId(index, 'nothing.here', false)).toBeNull()
    expect(resolveHelpId(index, 'Tokens', false)).toBeNull()
  })
})

describe('resolveContextTarget', () => {
  it('신호 id 로 찾은 절', () => {
    expect(
      resolveContextTarget({
        index,
        pathname: '/settings/tokens',
        isAdmin: false,
        signals: { dialog: 'tokens.issue', focus: 'tokens.list', scroll: null },
      }),
    ).toEqual({ view: { kind: 'section', target: { chapter: 'my-settings', sectionId: 'tokens.issue' } }, source: 'dialog' })
  })

  it('신호 id 가 끝까지 없으면 낮은 신호로 내려가지 않고 주소의 장 첫머리(출처는 신호 쪽)', () => {
    expect(
      resolveContextTarget({
        index,
        pathname: '/settings/tokens',
        isAdmin: false,
        signals: { dialog: null, focus: 'nothing.here', scroll: 'tokens.list' },
      }),
    ).toEqual({ view: { kind: 'section', target: { chapter: 'my-settings', sectionId: 'my-settings#_intro' } }, source: 'focus' })
  })

  it('신호가 없으면 주소, 장도 없으면 목차', () => {
    const none = { dialog: null, focus: null, scroll: null }
    expect(resolveContextTarget({ index, pathname: '/settings/tokens', isAdmin: false, signals: none })).toEqual({
      view: { kind: 'section', target: { chapter: 'my-settings', sectionId: 'my-settings#_intro' } },
      source: 'address',
    })
    expect(resolveContextTarget({ index, pathname: '/nowhere', isAdmin: false, signals: none })).toEqual({
      view: { kind: 'toc' },
      source: 'address',
    })
  })

  it('일반 구성원에게 관리자 장 절 신호는 보이지 않고 장 첫머리 또는 목차로', () => {
    expect(
      resolveContextTarget({ index, pathname: '/nowhere', isAdmin: false, signals: { dialog: 'agent.run', focus: null, scroll: null } }),
    ).toEqual({ view: { kind: 'toc' }, source: 'dialog' })
  })
})

describe('pickScrollHelp', () => {
  const boxes = (connectTop: number): HelpBox[] => [
    { id: 'tokens', top: -500, bottom: 900, depth: 0 },
    { id: 'tokens.list', top: -100, bottom: 200, depth: 1 },
    { id: 'tokens.connect', top: connectTop, bottom: 900, depth: 1 },
  ]

  it('기준선(30%)에 걸친 칸 가운데 가장 안쪽', () => {
    expect(pickScrollHelp(boxes(220), 600, false)).toBe('tokens.list')
  })

  it('같은 깊이가 함께 걸치면 뒤의 것', () => {
    expect(pickScrollHelp(boxes(150), 600, false)).toBe('tokens.connect')
  })

  it('맨 아래면 기준선이 60%', () => {
    expect(pickScrollHelp(boxes(300), 600, true)).toBe('tokens.connect')
    expect(pickScrollHelp(boxes(300), 600, false)).toBe('tokens.list')
  })

  it('걸친 칸이 없으면 선 위에서 시작한 마지막 칸, 그것도 없으면 첫 칸, 빈 목록이면 null', () => {
    const gap: HelpBox[] = [
      { id: 'a', top: 0, bottom: 100, depth: 0 },
      { id: 'b', top: 120, bottom: 150, depth: 0 },
      { id: 'c', top: 400, bottom: 500, depth: 0 },
    ]
    expect(pickScrollHelp(gap, 600, false)).toBe('b')
    expect(pickScrollHelp([{ id: 'x', top: 300, bottom: 400, depth: 0 }, { id: 'y', top: 500, bottom: 600, depth: 0 }], 600, false)).toBe(
      'x',
    )
    expect(pickScrollHelp([], 600, false)).toBeNull()
  })
})

describe('pickOpenDialogHelp', () => {
  const d = (helpId: string | null, state: string | null, insidePanel = false) => ({ helpId, state, insidePanel })

  it('열린 것 가운데 DOM 순서 마지막(맨 위)', () => {
    expect(pickOpenDialogHelp([d('a', 'open'), d('b', 'open')])).toBe('b')
  })

  it('닫히는 중(closed)은 이미 닫힘', () => {
    expect(pickOpenDialogHelp([d('a', 'open'), d('b', 'closed')])).toBe('a')
  })

  it('data-help 없는 대화상자·패널 안 대화상자는 신호가 아니다', () => {
    expect(pickOpenDialogHelp([d(null, 'open')])).toBeNull()
    expect(pickOpenDialogHelp([d('a', 'open', true)])).toBeNull()
    expect(pickOpenDialogHelp([d('a', 'open'), d('b', 'open', true)])).toBe('a')
    expect(pickOpenDialogHelp([])).toBeNull()
  })
})
