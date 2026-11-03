// 에이전트 실행 방식 화면 판정(WP-1273·1278·1281) — 방식 카드·현재 카드·방식 바꾸기 요약·실행 시작 막는 이유.
import { describe, expect, test } from 'vitest'

import { CLAUDE_TEMPLATE, DEFAULT_TEMPLATE } from '../test/kits/admin/agentRuntime'
import {
  currentCardId,
  modeChangeSummary,
  modeChangeTitle,
  type RunModeCard,
  runModeCards,
  startBlockReason,
  type StartChecks,
  withSavedWorkspaceCard,
} from './agentRunMode'

const cards = runModeCards([DEFAULT_TEMPLATE, CLAUDE_TEMPLATE])
const card = (id: string): RunModeCard => cards.find((c) => c.id === id)!
const SERVER = card('SERVER')
const WORKS = card('claude-code')
const EXTERNAL = card('EXTERNAL')

describe('runModeCards', () => {
  test('기본 → 작업 공간 방식(템플릿마다) → 외부 순이고 기본 템플릿(SERVER)은 카드로 늘지 않는다', () => {
    expect(cards.map((c) => [c.id, c.mode, c.title])).toEqual([
      ['SERVER', 'SERVER', '기본'],
      ['claude-code', 'WORKSPACE', 'Claude Code'],
      ['EXTERNAL', 'EXTERNAL', '외부'],
    ])
    expect(WORKS.template).toBe(CLAUDE_TEMPLATE)
    expect(WORKS.description).toBe('Works 가 실행 · 작업 공간에서 개발·테스트하고 PR 을 올립니다')
  })

  test('정의 목록을 아직 못 받았으면 기본·외부 두 장만', () => {
    expect(runModeCards(undefined).map((c) => c.id)).toEqual(['SERVER', 'EXTERNAL'])
    expect(runModeCards([]).map((c) => c.id)).toEqual(['SERVER', 'EXTERNAL'])
  })
})

describe('currentCardId', () => {
  test('기본·외부는 방식 이름 그대로', () => {
    expect(currentCardId('SERVER', null, cards)).toBe('SERVER')
    expect(currentCardId('EXTERNAL', 'claude-code', cards)).toBe('EXTERNAL')
  })
  test('작업 공간은 저장된 방식 이름, 없으면 첫 작업 공간 카드, 카드도 없으면 WORKSPACE', () => {
    expect(currentCardId('WORKSPACE', 'claude-code', cards)).toBe('claude-code')
    expect(currentCardId('WORKSPACE', null, cards)).toBe('claude-code')
    expect(currentCardId('WORKSPACE', undefined, runModeCards([]))).toBe('WORKSPACE')
  })
})

describe('modeChangeTitle', () => {
  test('받침에 맞춰 (으)로 — 외부로 · 기본으로', () => {
    expect(modeChangeTitle(EXTERNAL)).toBe('실행 방식을 외부로 바꿀까요?')
    expect(modeChangeTitle(SERVER)).toBe('실행 방식을 기본으로 바꿀까요?')
  })
})

describe('modeChangeSummary — from → to 조합별', () => {
  test('SERVER → WORKSPACE: 바로 답하지 않고 작업 공간을 띄움 · 펼친 설정으로 저장, 지울 설정 없음', () => {
    const lines = modeChangeSummary(SERVER, WORKS, null)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('작업 공간을 띄워 일하게 해요')
    expect(lines[1]).toContain('펼친 작업 설정으로 저장돼요')
  })

  test('SERVER → EXTERNAL: 더는 바로 답하지 않음 · 키 발급 안내', () => {
    const lines = modeChangeSummary(SERVER, EXTERNAL, null)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('Works 는 이 AI 의 이슈·멘션에 더는 바로 답하지 않아요.')
    expect(lines[1]).toContain('키를 발급해 주세요')
  })

  test('WORKSPACE → SERVER: 작업 설정(칸 이름) 삭제 · 접속 키 폐기 · 바로 답함 · 지시는 안 읽음(지워지지 않음)', () => {
    const lines = modeChangeSummary(WORKS, SERVER, CLAUDE_TEMPLATE)
    expect(lines[0]).toBe('Claude Code 작업 설정(모델·대기열 라벨·실행 환경)이 지워져요.')
    expect(lines).toContain('Works 가 관리하던 접속 키는 폐기돼요.')
    expect(lines.some((l) => l.includes('바로 답해요'))).toBe(true)
    expect(lines.at(-1)).toContain('지시는 읽지 않아요')
  })

  test('WORKSPACE → EXTERNAL: 설정 삭제 · 키 폐기 · 코드는 그 컴퓨터의 GitHub 로그인(바로 답하지 않음 문구는 없음)', () => {
    const lines = modeChangeSummary(WORKS, EXTERNAL, CLAUDE_TEMPLATE)
    expect(lines[0]).toContain('작업 설정')
    expect(lines).toContain('Works 가 관리하던 접속 키는 폐기돼요.')
    expect(lines.at(-1)).toBe('코드는 그 도구를 띄운 컴퓨터의 GitHub 로그인으로 받아요.')
    expect(lines.some((l) => l.includes('더는 바로 답하지'))).toBe(false)
  })

  test('EXTERNAL → SERVER: 지울 설정 없이 바로 답함 · 지시 안 읽음 (키 폐기 문구 없음)', () => {
    const lines = modeChangeSummary(EXTERNAL, SERVER, null)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('AI 계정을 연결해야')
    expect(lines.some((l) => l.includes('폐기'))).toBe(false)
  })

  test('EXTERNAL → WORKSPACE: 접속 키는 Works 가 관리 · 직접 발급한 키는 남음', () => {
    const lines = modeChangeSummary(EXTERNAL, WORKS, null)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('직접 발급한 키는 그대로 남으니')
  })

  test('작업 공간 방식끼리 다른 카드로 바꾸면 이전 설정은 지우되 키 폐기 문구는 없다', () => {
    const other: RunModeCard = { ...WORKS, id: 'codex', title: 'Codex' }
    const lines = modeChangeSummary(WORKS, other, CLAUDE_TEMPLATE)
    expect(lines[0]).toContain('작업 설정')
    expect(lines.some((l) => l.includes('폐기'))).toBe(false)
  })

  test('새 방식에 맞지 않는 AI 계정은 연결이 해제된다고 알린다(WP-1296)', () => {
    const codex: RunModeCard = { ...WORKS, id: 'codex', title: 'Codex', template: { ...CLAUDE_TEMPLATE, name: 'codex', account: 'chatgpt' } }
    // Claude Code → Codex: Claude 구독은 Codex 에서 못 쓴다
    expect(modeChangeSummary(WORKS, codex, CLAUDE_TEMPLATE, 'anthropic')[0]).toBe('AI 계정(Claude 구독) 연결이 해제돼요.')
    // Codex → 기본: ChatGPT 로그인은 서버가 쓰지 못한다
    expect(modeChangeSummary(codex, SERVER, codex.template, 'chatgpt')[0]).toBe('AI 계정(ChatGPT 로그인) 연결이 해제돼요.')
    // 맞는 계정·외부로 가는 경우는 알리지 않는다
    expect(modeChangeSummary(SERVER, WORKS, null, 'anthropic').some((l) => l.startsWith('AI 계정'))).toBe(false)
    expect(modeChangeSummary(codex, EXTERNAL, codex.template, 'chatgpt').some((l) => l.startsWith('AI 계정'))).toBe(false)
  })

  test('같은 작업 공간 카드로의 이동은 지울 것이 없다(저장만)', () => {
    const lines = modeChangeSummary(WORKS, WORKS, CLAUDE_TEMPLATE)
    expect(lines.some((l) => l.includes('지워져요'))).toBe(false)
  })
})

describe('startBlockReason — 위에서부터 고칠 순서', () => {
  const ok: StartChecks = {
    account: 'anthropic',
    accountOk: true,
    needsRepos: true,
    missingRepoHosts: [],
    projectCount: 1,
    hasLocation: true,
    seatOk: true,
    missingRequired: false,
    inactive: false,
  }
  test('모두 갖추면 null', () => {
    expect(startBlockReason(ok)).toBeNull()
  })
  test('맡는 프로젝트가 0 이면 막는다(WP-1281 결정)', () => {
    expect(startBlockReason({ ...ok, projectCount: 0 })).toBe('맡는 프로젝트를 먼저 정해 주세요')
  })
  test('저장소 토큰이 필요 없는 방식이면 빠진 호스트가 있어도 막지 않는다', () => {
    expect(startBlockReason({ ...ok, needsRepos: false, missingRepoHosts: ['github.com'] })).toBeNull()
  })
  test('저장소가 빠졌으면 프로젝트 0 보다 먼저 「저장소를 먼저 연결해 주세요」', () => {
    expect(startBlockReason({ ...ok, missingRepoHosts: ['github.com'], projectCount: 0 })).toBe('저장소를 먼저 연결해 주세요')
  })
  test('AI 계정이 필요 없는 방식이면 accountOk 가 false 여도 막지 않는다', () => {
    expect(startBlockReason({ ...ok, account: null, accountOk: false })).toBeNull()
  })
  test('로그인 정보로 일하는 방식이면 그 계정 이름으로 막는다', () => {
    expect(startBlockReason({ ...ok, account: 'chatgpt', accountOk: false })).toBe('ChatGPT 로그인을 먼저 연결해 주세요')
    expect(startBlockReason({ ...ok, account: 'genia', accountOk: false })).toBe('Gen:iA 로그인을 먼저 연결해 주세요')
  })
  test('우선순위 — 사용 중지 > AI 계정 > 저장소 > 프로젝트 > 실행 환경 없음 > 자리 > 필수 칸', () => {
    const allBad: StartChecks = {
      account: 'anthropic',
      accountOk: false,
      needsRepos: true,
      missingRepoHosts: ['gitlab.iacloud.kr'],
      projectCount: 0,
      hasLocation: false,
      seatOk: false,
      missingRequired: true,
      inactive: true,
    }
    const expected = [
      '사용 중지된 AI 는 실행할 수 없어요',
      'Claude 구독을 먼저 연결해 주세요',
      '저장소를 먼저 연결해 주세요',
      '맡는 프로젝트를 먼저 정해 주세요',
      '실행 환경을 먼저 추가해 주세요',
      '실행 환경에 여유가 없어요',
      '작업 설정의 빈 칸을 채워 주세요',
    ]
    let c = allBad
    for (const msg of expected) {
      expect(startBlockReason(c)).toBe(msg)
      // 방금 이유를 고친 것으로 치고 다음 이유를 본다
      c = fix(c, msg)
    }
    expect(startBlockReason(c)).toBeNull()
  })
})

/** 방금 나온 이유를 고친 상태 — 우선순위 순회용 */
function fix(c: StartChecks, msg: string): StartChecks {
  if (msg.startsWith('사용 중지')) return { ...c, inactive: false }
  if (msg.startsWith('Claude')) return { ...c, accountOk: true }
  if (msg.startsWith('저장소')) return { ...c, missingRepoHosts: [] }
  if (msg.startsWith('맡는')) return { ...c, projectCount: 1 }
  if (msg.startsWith('실행 환경을')) return { ...c, hasLocation: true }
  if (msg.startsWith('실행 환경에')) return { ...c, seatOk: true }
  return { ...c, missingRequired: false }
}

describe('withSavedWorkspaceCard', () => {
  test('저장된 방식이 목록에 있으면 그대로', () => {
    expect(withSavedWorkspaceCard(cards, 'WORKSPACE', 'claude-code', true)).toBe(cards)
  })

  test('작업 공간이 아니거나 이름이 없으면 그대로', () => {
    expect(withSavedWorkspaceCard(cards, 'SERVER', 'old', true)).toBe(cards)
    expect(withSavedWorkspaceCard(cards, 'WORKSPACE', null, true)).toBe(cards)
  })

  test('정의 목록에서 빠진 방식은 「(지원 끝남)」 작업 공간 카드로 외부 앞에 더한다', () => {
    const out = withSavedWorkspaceCard(cards, 'WORKSPACE', 'old-runner', true)
    expect(out.map((c) => c.id)).toEqual(['SERVER', 'claude-code', 'old-runner', 'EXTERNAL'])
    expect(out[2]).toMatchObject({ mode: 'WORKSPACE', title: 'old-runner (지원 끝남)', template: null })
    expect(currentCardId('WORKSPACE', 'old-runner', out)).toBe('old-runner')
  })

  test('정의를 아직 못 받았으면 「지원 끝남」 없이 이름만 — 기본·외부 사이에 둔다', () => {
    const out = withSavedWorkspaceCard(runModeCards(undefined), 'WORKSPACE', 'claude-code', false)
    expect(out.map((c) => [c.id, c.title])).toEqual([
      ['SERVER', '기본'],
      ['claude-code', 'claude-code'],
      ['EXTERNAL', '외부'],
    ])
  })
})
