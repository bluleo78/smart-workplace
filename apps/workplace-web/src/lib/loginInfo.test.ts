// 로그인 정보 미리 보기(WP-1296·1297) — 붙여 넣은 auth.json 이 어떤 로그인인지·계정·만료를 읽고, 다른 프로그램의 파일을 알아본다.
// 값은 모두 가짜다(실제 토큰 모양만 흉내 낸다).
import { describe, expect, test } from 'vitest'

import { checkLoginInfo } from './loginInfo'

/** 서명 없는 가짜 JWT — 가운데 부분만 의미가 있다. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `h.${b64}.s`
}

const chatgpt = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fakeJwt({ email: 'ai-dev@example.com' }),
      access_token: fakeJwt({ exp: 1_800_000_000 }),
      refresh_token: 'rt-fake',
      account_id: 'acc-fake',
    },
    ...over,
  })

/** 키 하나를 뺀 사본 — auth_mode·OPENAI_API_KEY 가 없는 파일을 만든다. */
const without = (v: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key))

const genia = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    genia: { type: 'oauth', access: 'at-fake', refresh: 'rt-fake', expires: 1_800_000_000_000, email: 'ai-dev@example.com', ...over },
  })

describe('checkLoginInfo', () => {
  test('returnsNull_whenEmpty', () => {
    // 아직 넣지 않았으면 아무 안내도 하지 않는다
    expect(checkLoginInfo('  ', 'chatgpt')).toBeNull()
  })

  test('readsAccountAndExpiry_whenChatgptLogin', () => {
    // 계정은 id_token 의 email, 만료는 access_token 의 exp(초)
    expect(checkLoginInfo(chatgpt(), 'chatgpt')).toEqual({
      ok: true,
      account: 'ai-dev@example.com',
      expiresAt: new Date(1_800_000_000 * 1000),
    })
  })

  test('rejects_whenChatgptUsesApiKeyMode', () => {
    // API 키로 로그인한 파일은 받지 않는다
    expect(checkLoginInfo(chatgpt({ auth_mode: 'apikey' }), 'chatgpt')).toMatchObject({ ok: false, reason: expect.stringContaining('ChatGPT 로 로그인한 정보가 아니에요') })
  })

  test('accepts_whenChatgptFileHasNoAuthModeAndNoApiKey', () => {
    // 옛 codex 의 auth.json 은 auth_mode 키가 없다 — 갱신 토큰이 있고 API 키가 비었으면 ChatGPT 로그인으로 받는다
    const rest = without(JSON.parse(chatgpt()) as Record<string, unknown>, 'auth_mode')
    expect(checkLoginInfo(JSON.stringify({ ...rest, last_refresh: '2026-11-01T00:00:00Z' }), 'chatgpt')).toMatchObject({ ok: true, account: 'ai-dev@example.com' })
    expect(checkLoginInfo(JSON.stringify(without(rest, 'OPENAI_API_KEY')), 'chatgpt')).toMatchObject({ ok: true })
    expect(checkLoginInfo(JSON.stringify({ ...rest, OPENAI_API_KEY: '' }), 'chatgpt')).toMatchObject({ ok: true })
  })

  test('rejects_whenChatgptFileHasNoAuthModeButHasApiKey', () => {
    // auth_mode 가 없는데 API 키가 들어 있으면 API 키 로그인이다
    const rest = without(JSON.parse(chatgpt({ OPENAI_API_KEY: 'sk-fake' })) as Record<string, unknown>, 'auth_mode')
    expect(checkLoginInfo(JSON.stringify(rest), 'chatgpt')).toMatchObject({ ok: false, reason: expect.stringContaining('ChatGPT 로 로그인한 정보가 아니에요') })
  })

  test('rejects_whenChatgptHasNoRefreshToken', () => {
    // 갱신 토큰이 없으면 AI 가 로그인을 이어 가지 못한다
    const text = chatgpt({ tokens: { id_token: fakeJwt({}), access_token: fakeJwt({}) } })
    expect(checkLoginInfo(text, 'chatgpt')).toMatchObject({ ok: false, reason: expect.stringContaining('갱신 토큰') })
  })

  test('readsAccountAndExpiry_whenGeniaLogin', () => {
    // 만료는 밀리초
    expect(checkLoginInfo(genia(), 'genia')).toEqual({ ok: true, account: 'ai-dev@example.com', expiresAt: new Date(1_800_000_000_000) })
  })

  test('rejects_whenGeniaIsNotOauth', () => {
    expect(checkLoginInfo(genia({ type: 'api' }), 'genia')).toMatchObject({ ok: false, reason: expect.stringContaining('Gen:iA 로그인 정보가 아니에요') })
  })

  test('namesTheOtherProgram_whenWrongKind', () => {
    // 다른 프로그램의 로그인 정보를 넣으면 무엇을 넣었는지 알려 준다
    expect(checkLoginInfo(chatgpt(), 'genia')).toEqual({ ok: false, reason: 'ChatGPT 로그인 정보예요 — Gen:iA 로그인 정보를 넣어 주세요.' })
    expect(checkLoginInfo(genia(), 'chatgpt')).toEqual({ ok: false, reason: 'Gen:iA 로그인 정보예요 — ChatGPT 로그인 정보를 넣어 주세요.' })
  })

  test('rejects_whenNotJsonOrUnknownShape', () => {
    expect(checkLoginInfo('{"auth_mode":', 'chatgpt')).toMatchObject({ ok: false, reason: expect.stringContaining('읽지 못했어요') })
    expect(checkLoginInfo('[1,2]', 'chatgpt')).toMatchObject({ ok: false, reason: expect.stringContaining('읽지 못했어요') })
    expect(checkLoginInfo('{"foo":1}', 'genia')).toMatchObject({ ok: false, reason: expect.stringContaining('다른 프로그램의 파일') })
  })

  test('decodesNonAsciiEmail_asUtf8', () => {
    // JWT 가운데 부분은 UTF-8 — 한글이 섞인 이메일도 깨지지 않는다
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ email: '개발@example.com' })))).replace(/=+$/, '')
    const text = chatgpt({ tokens: { id_token: `h.${payload}.s`, access_token: 'x', refresh_token: 'rt-fake' } })
    expect(checkLoginInfo(text, 'chatgpt')).toMatchObject({ ok: true, account: '개발@example.com' })
  })

  test('leavesAccountNull_whenTokensAreNotJwt', () => {
    // 표시용 정보를 못 읽어도 연결은 막지 않는다
    const text = chatgpt({ tokens: { id_token: 'x', access_token: 'y', refresh_token: 'rt-fake' } })
    expect(checkLoginInfo(text, 'chatgpt')).toEqual({ ok: true, account: null, expiresAt: null })
  })
})
