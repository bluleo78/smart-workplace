// 작업 설정 「모델」 칸 선택지(WP-1405) — 정적 별칭 + 연결된 계정의 모델 목록 합치기, 상태 판정, 저장값 보존.
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'

import type { AgentTemplateConfigField } from '../types/agentRuntime'
import { type AgentCredentialQuery, type AgentModelsQuery, modelFieldOptions, withSavedOption } from './agentModelOptions'

const FIELD: AgentTemplateConfigField = {
  key: 'model',
  label: '모델',
  type: 'select',
  optionsFrom: 'account-models',
  options: [
    { value: 'opus', label: 'Opus(최신)' },
    { value: 'sonnet', label: 'Sonnet(최신)' },
  ],
  default: 'opus',
  required: true,
}

const LIVE = {
  provider: 'anthropic' as const,
  models: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'opus', label: '중복 별칭' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  ],
}

/** 상태 코드를 가진 Axios 오류 — 화면이 받는 조회 실패와 같은 모양. */
function httpError(status: number) {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', String(status), { headers }, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers },
    data: {},
  })
}

/** Claude 구독이 연결된 상태 — 템플릿 계정과 같다. */
const CLAUDE: AgentCredentialQuery = { provider: 'anthropic', isPending: false }

/** 모델 목록 조회 결과 모양 — 받음·조회 중·실패. */
const loaded = (data: AgentModelsQuery['data']): AgentModelsQuery => ({ data, error: null, isPending: false })
const PENDING: AgentModelsQuery = { data: undefined, error: null, isPending: true }
const failed = (status: number): AgentModelsQuery => ({ data: undefined, error: httpError(status), isPending: false })

/** Claude Code 모델 칸으로 부른다 — 기본은 Claude 연결·계정 목록 받음·저장값 opus. */
function run({ query = loaded(LIVE), credential = CLAUDE, saved = 'opus' }: { query?: AgentModelsQuery; credential?: AgentCredentialQuery; saved?: string } = {}) {
  return modelFieldOptions({ field: FIELD, account: 'anthropic', credential, query, saved })
}

const values = (r: ReturnType<typeof modelFieldOptions>) => r.options.map((o) => o.value)

describe('modelFieldOptions', () => {
  test('live — 정적 별칭을 맨 앞에, 이어 계정 목록을 두고 겹치는 값은 하나만 남긴다', () => {
    const r = run()

    expect(r.status).toBe('live')
    expect(r.hint).toBeNull()
    expect(values(r)).toEqual(['opus', 'sonnet', 'claude-opus-5-5', 'claude-sonnet-5'])
    // 겹친 값은 정적 쪽 이름을 쓴다
    expect(r.options[0]).toEqual({ value: 'opus', label: 'Opus(최신)' })
    expect(r.options[2]).toEqual({ value: 'claude-opus-5-5', label: 'Claude Opus 5.5' })
  })

  test('loading — 조회 중이면 정적 선택지와 불러오는 중 안내', () => {
    const r = run({ query: PENDING })

    expect(r.status).toBe('loading')
    expect(values(r)).toEqual(['opus', 'sonnet'])
    expect(r.hint).toContain('불러오는 중')
  })

  test('응답 계정이 템플릿 계정과 다르면 otherAccount — 그 계정의 모델을 섞지 않는다', () => {
    const r = run({ query: loaded({ provider: 'opencode', models: [{ id: 'openai/gpt-x', label: 'GPT X' }] }) })

    expect(r.status).toBe('otherAccount')
    expect(values(r)).toEqual(['opus', 'sonnet'])
  })

  test('연결된 계정 종류가 다르면 otherAccount — 정적 선택지·저장값만, 필요한 계정 이름으로 안내', () => {
    const r = run({ credential: { provider: 'opencode', isPending: false }, query: PENDING, saved: 'claude-haiku-4-5' })

    expect(r.status).toBe('otherAccount')
    expect(values(r)).toEqual(['claude-haiku-4-5', 'opus', 'sonnet'])
    expect(r.hint).toBe(
      '연결된 AI 계정이 이 실행 방식에 맞지 않아 기본 선택지를 보여요. Claude 구독 계정을 연결하면 그 계정의 모델이 보여요.',
    )
  })

  test('AI 계정이 연결돼 있지 않으면 noAccount — 모델 조회 결과를 보지 않는다', () => {
    const r = run({ credential: { provider: null, isPending: false }, query: PENDING })

    expect(r.status).toBe('noAccount')
    expect(values(r)).toEqual(['opus', 'sonnet'])
    expect(r.hint).toContain('AI 계정을 연결하면')
  })

  test('연결 조회 중이면 loading, 연결 조회가 실패하면 failed', () => {
    expect(run({ credential: { provider: undefined, isPending: true }, query: PENDING }).status).toBe('loading')
    expect(run({ credential: { provider: undefined, isPending: false }, query: PENDING }).status).toBe('failed')
  })

  test('빈 목록이면 failed — 정적 선택지로', () => {
    const r = run({ query: loaded({ provider: 'anthropic', models: [] }) })

    expect(r.status).toBe('failed')
    expect(values(r)).toEqual(['opus', 'sonnet'])
    expect(r.hint).toContain('불러오지 못해')
  })

  test('404(연결 없음)면 noAccount', () => {
    const r = run({ query: failed(404) })

    expect(r.status).toBe('noAccount')
    expect(values(r)).toEqual(['opus', 'sonnet'])
  })

  test('그 밖의 오류(500)면 failed', () => {
    const r = run({ query: failed(500) })

    expect(r.status).toBe('failed')
    expect(values(r)).toEqual(['opus', 'sonnet'])
  })

  test('저장값이 목록 밖이면 그 값을 맨 앞에 덧붙인다 — 빈칸으로 보이지 않게', () => {
    const r = run({ saved: 'claude-haiku-4-5' })

    expect(r.options[0]).toEqual({ value: 'claude-haiku-4-5', label: 'claude-haiku-4-5' })
    expect(values(r)).toEqual(['claude-haiku-4-5', 'opus', 'sonnet', 'claude-opus-5-5', 'claude-sonnet-5'])
  })

  test('저장값이 목록 안이면 덧붙이지 않는다(중복 없음)', () => {
    expect(values(run({ saved: 'claude-sonnet-5' }))).toEqual(['opus', 'sonnet', 'claude-opus-5-5', 'claude-sonnet-5'])
  })

  test('저장값이 비었으면 덧붙이지 않는다', () => {
    expect(values(run({ query: failed(500), saved: '' }))).toEqual(['opus', 'sonnet'])
  })
})

describe('withSavedOption', () => {
  const OPTS = [{ value: 'a', label: 'A' }]

  test('저장값이 선택지 밖이면 맨 앞에 그 값 그대로 덧붙인다', () => {
    expect(withSavedOption(OPTS, 'gone')).toEqual([{ value: 'gone', label: 'gone' }, ...OPTS])
  })

  test('선택지 안이거나 비었거나 공백뿐이면 그대로 둔다', () => {
    for (const saved of ['a', '', '  ', null, undefined]) expect(withSavedOption(OPTS, saved)).toBe(OPTS)
  })
})
