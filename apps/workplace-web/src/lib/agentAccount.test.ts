// AI 계정 종류 규칙(WP-1296·1297) — 화면 이름과 실행 방식마다 쓸 수 있는 계정.
import { describe, expect, test } from 'vitest'

import { CLAUDE_TEMPLATE } from '../test/kits/admin/agentRuntime'
import { accountFits, accountLabel, isLoginProvider, loginProgram } from './agentAccount'

const codexTemplate = { ...CLAUDE_TEMPLATE, name: 'codex', account: 'chatgpt' as const }

describe('agentAccount', () => {
  test('labels_eachProvider', () => {
    expect(['anthropic', 'opencode', 'genia', 'chatgpt'].map((p) => accountLabel(p as never))).toEqual([
      'Claude 구독',
      'OpenAI 호환',
      'Gen:iA 로그인',
      'ChatGPT 로그인',
    ])
  })

  test('marksOnlyGeniaAndChatgpt_asLoginProviders', () => {
    // 로그인 정보로 연결하는 계정만 로그인 정보 창을 쓴다
    expect(isLoginProvider('genia')).toBe(true)
    expect(isLoginProvider('chatgpt')).toBe(true)
    expect(isLoginProvider('anthropic')).toBe(false)
    expect(isLoginProvider('opencode')).toBe(false)
    expect(loginProgram('genia')).toBe('Gen:iA Code')
    expect(loginProgram('chatgpt')).toBe('Codex')
  })

  test('serverMode_fitsOnlyServerAccounts', () => {
    // 기본 방식은 서버가 부를 수 있는 Claude·OpenAI 호환만
    const card = { mode: 'SERVER' as const, template: null }
    expect(accountFits('anthropic', card)).toBe(true)
    expect(accountFits('opencode', card)).toBe(true)
    expect(accountFits('chatgpt', card)).toBe(false)
    expect(accountFits('genia', card)).toBe(false)
  })

  test('workspaceMode_fitsOnlyTheTemplateAccount', () => {
    expect(accountFits('anthropic', { mode: 'WORKSPACE', template: CLAUDE_TEMPLATE })).toBe(true)
    expect(accountFits('opencode', { mode: 'WORKSPACE', template: CLAUDE_TEMPLATE })).toBe(false)
    expect(accountFits('chatgpt', { mode: 'WORKSPACE', template: codexTemplate })).toBe(true)
    expect(accountFits('anthropic', { mode: 'WORKSPACE', template: codexTemplate })).toBe(false)
  })

  test('workspaceMode_opencodeTemplate_fitsOnlyOpencodeAccount', () => {
    // WP-1410: OpenCode 템플릿은 OpenAI 호환 연결만 맞다 — 로그인 정보 창이 아니라 OpenAI 호환 연결 창을 쓰는 계정이다
    const opencodeTemplate = { ...CLAUDE_TEMPLATE, name: 'opencode', account: 'opencode' as const }
    expect(accountFits('opencode', { mode: 'WORKSPACE', template: opencodeTemplate })).toBe(true)
    expect(accountFits('anthropic', { mode: 'WORKSPACE', template: opencodeTemplate })).toBe(false)
    expect(accountFits('chatgpt', { mode: 'WORKSPACE', template: opencodeTemplate })).toBe(false)
    expect(isLoginProvider('opencode')).toBe(false)
  })

  test('workspaceMode_fitsServerAccounts_whenTemplateNeedsNoAccount', () => {
    // 계정을 요구하지 않는 템플릿은 서버와 같이 기본 방식의 계정을 남긴다
    const plain = { ...CLAUDE_TEMPLATE, account: null }
    expect(accountFits('anthropic', { mode: 'WORKSPACE', template: plain })).toBe(true)
    expect(accountFits('chatgpt', { mode: 'WORKSPACE', template: plain })).toBe(false)
  })

  test('externalMode_keepsAnyAccount', () => {
    // 내 컴퓨터 방식은 Works 의 AI 계정을 쓰지 않으니 무엇이든 그대로 둔다
    expect(accountFits('genia', { mode: 'EXTERNAL', template: null })).toBe(true)
  })
})
