// 도움말 층 빌더(WP-1511) — 자리표시 채움, 비밀값 포커스, 상한 자르기, 빈 입력.
import { describe, expect, it } from 'vitest'

import { helpVarsFixture as VARS } from '@/test/kits/help/helpBundleKit'

import { LIMITS } from '../common'
import { buildHelpContext, type HelpContextInput } from './help'

const EMPTY: HelpContextInput = { section: null, values: { placeholders: {}, conditions: {} }, vars: VARS, focus: null, dialog: null, query: '' }
const sec = (markdown: string, path = ['설정']) => ({ id: 'a.b', path, markdown })

describe('buildHelpContext', () => {
  it('절 본문의 자리표시를 화면 값으로, 없으면 <표시 이름> 꼴로 채운다', () => {
    const ctx = buildHelpContext({ ...EMPTY, section: { id: 'agent.run.keys.connect', path: ['설정', '외부 도구 연결'], markdown: '/genia-works:as {agent.username}' } })
    expect(ctx?.section?.body).toBe('/genia-works:as <AI 아이디>')
    const filled = buildHelpContext({ ...EMPTY, values: { placeholders: { 'agent.username': 'dev5' }, conditions: {} }, section: sec('as {agent.username}') })
    expect(filled?.section?.body).toBe('as dev5')
  })

  it('조건 블록은 화면 값으로 걸러 낸다', () => {
    const md = 'A\n\n{if app.customMcpServer}\nB\n{/if}\n\nC'
    const off = buildHelpContext({ ...EMPTY, values: { placeholders: {}, conditions: { 'app.customMcpServer': false } }, section: sec(md) })
    expect(off?.section?.body).not.toContain('B')
    const on = buildHelpContext({ ...EMPTY, values: { placeholders: {}, conditions: { 'app.customMcpServer': true } }, section: sec(md) })
    expect(on?.section?.body).toContain('B')
  })

  it('비밀값 포커스는 value 를 버린다', () => {
    const ctx = buildHelpContext({ ...EMPTY, focus: { name: '토큰', secret: true, value: 'x' } })
    expect(ctx?.focus).toEqual({ name: '토큰', secret: true })
    expect('value' in ctx!.focus!).toBe(false)
  })

  it('일반 포커스는 값이 있을 때만 value 를 싣는다', () => {
    expect(buildHelpContext({ ...EMPTY, focus: { name: '이름', secret: false, value: '홍길동' } })?.focus).toEqual({ name: '이름', value: '홍길동' })
    expect(buildHelpContext({ ...EMPTY, focus: { name: '이름', secret: false } })?.focus).toEqual({ name: '이름' })
  })

  it('모든 문자열을 상한으로 자르고 경로는 8개까지만 둔다', () => {
    const long = (n: number) => 'ㄱ'.repeat(n + 10)
    const ctx = buildHelpContext({
      section: { id: long(LIMITS.helpId), path: Array.from({ length: 12 }, () => long(LIMITS.helpPathItem)), markdown: long(LIMITS.helpBody) },
      values: EMPTY.values,
      vars: VARS,
      focus: { name: long(LIMITS.helpFocusName), secret: false, value: long(LIMITS.helpFocusValue) },
      dialog: long(LIMITS.helpDialog),
      query: long(LIMITS.helpQuery),
    })!
    expect(ctx.section!.id).toHaveLength(LIMITS.helpId)
    expect(ctx.section!.path).toHaveLength(LIMITS.helpPath)
    expect(ctx.section!.path.every((p) => p.length === LIMITS.helpPathItem)).toBe(true)
    expect(ctx.section!.body).toHaveLength(LIMITS.helpBody)
    expect(ctx.focus!.name).toHaveLength(LIMITS.helpFocusName)
    expect(ctx.focus!.value).toHaveLength(LIMITS.helpFocusValue)
    expect(ctx.dialog).toHaveLength(LIMITS.helpDialog)
    expect(ctx.query).toHaveLength(LIMITS.helpQuery)
  })

  it('아무것도 없으면 null, 공백뿐인 값도 뺀다', () => {
    expect(buildHelpContext(EMPTY)).toBeNull()
    expect(buildHelpContext({ ...EMPTY, dialog: '  ', query: ' ' })).toBeNull()
  })

  it('검색어·대화상자만 있어도 만든다(절 없이)', () => {
    expect(buildHelpContext({ ...EMPTY, dialog: '토큰 만들기', query: '만료' })).toEqual({ dialog: '토큰 만들기', query: '만료' })
  })
})
