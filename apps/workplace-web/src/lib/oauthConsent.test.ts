// OAuth 동의 화면의 순수 판정 테스트(WP-1686) — node 프로젝트에서 돈다.
import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import {
  appInitial,
  type AuthorizeFailure,
  CONSENT_PATH,
  decisionBody,
  initialTenantId,
  isFramed,
  isNavigableRedirect,
  loadedDocumentUrl,
  needsDocumentReload,
  readAuthorizeError,
} from './oauthConsent'

/** 응답이 있는 axios 오류 — status·data 만 채운다. */
function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, { status, data } as AxiosResponse)
}

describe('decisionBody', () => {
  it('maps the seven query names', () => {
    const params = new URLSearchParams(
      'response_type=code&client_id=cid&redirect_uri=https%3A%2F%2Fa.test%2Fcb&code_challenge=ch&code_challenge_method=S256&state=st&resource=https%3A%2F%2Fapi.test',
    )
    expect(decisionBody(params, 7, 'ALLOW')).toEqual({
      responseType: 'code',
      clientId: 'cid',
      redirectUri: 'https://a.test/cb',
      codeChallenge: 'ch',
      codeChallengeMethod: 'S256',
      state: 'st',
      resource: 'https://api.test',
      tenantId: 7,
      decision: 'ALLOW',
    })
  })

  it('omits keys that are absent from the query', () => {
    const body = decisionBody(new URLSearchParams('response_type=code&client_id=c'), null, 'DENY')
    expect('state' in body).toBe(false)
    expect('resource' in body).toBe(false)
    expect(body.tenantId).toBeNull()
    expect(body.decision).toBe('DENY')
  })

  it('takes the first of repeated names', () => {
    expect(decisionBody(new URLSearchParams('state=a&state=b'), 1, 'ALLOW').state).toBe('a')
  })

  it('decodes like the server', () => {
    const params = new URLSearchParams('?state=a+b%2Bc&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2Fcb%3Fx%3D1')
    const body = decisionBody(params, 1, 'ALLOW')
    expect(body.state).toBe('a b+c')
    expect(body.redirectUri).toBe('http://127.0.0.1:41234/cb?x=1')
  })
})

describe('initialTenantId', () => {
  const ws = (...ids: number[]) => ids.map((tenantId) => ({ tenantId, name: `n${tenantId}`, slug: `s${tenantId}` }))

  it.each([
    [{ currentTenantId: 2, workspaces: ws(1, 2) }, 2],
    [{ currentTenantId: 9, workspaces: ws(1, 2) }, 1],
    [{ currentTenantId: null, workspaces: ws(3) }, 3],
    [{ currentTenantId: null, workspaces: ws() }, null],
  ])('%j -> %s', (input, expected) => {
    expect(initialTenantId(input)).toBe(expected)
  })
})

describe('isNavigableRedirect', () => {
  it.each(['https://claude.ai/api/mcp/auth_callback?code=x', 'http://127.0.0.1:41234/cb'])('accepts %s', (url) => {
    expect(isNavigableRedirect(url)).toBe(true)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative', 'not a url', ''])('rejects %j', (url) => {
    expect(isNavigableRedirect(url)).toBe(false)
  })
})

describe('readAuthorizeError', () => {
  const cases: Array<[string, unknown, 'validate' | 'decide', 'HUMAN' | 'AGENT', AuthorizeFailure]> = [
    [
      '400 with navigable errorRedirectUrl -> redirect',
      httpError(400, { error: 'invalid_request', errorDescription: 'd', errorRedirectUrl: 'https://a.test/cb?error=x' }),
      'validate',
      'HUMAN',
      { kind: 'redirect', url: 'https://a.test/cb?error=x' },
    ],
    [
      'validate 400 alone -> fatal',
      httpError(400, { error: 'invalid_client', errorDescription: '알 수 없는 앱' }),
      'validate',
      'HUMAN',
      { kind: 'fatal', code: 'invalid_client', description: '알 수 없는 앱' },
    ],
    [
      'decide 400 alone -> inline',
      httpError(400, { error: 'invalid_request', errorDescription: '워크스페이스를 고르세요' }),
      'decide',
      'HUMAN',
      { kind: 'inline', code: 'invalid_request', description: '워크스페이스를 고르세요' },
    ],
    [
      '403 HUMAN -> fatal with message',
      httpError(403, { error: 'WEB_SESSION_REQUIRED', message: '웹 로그인만 허용' }),
      'validate',
      'HUMAN',
      { kind: 'fatal', code: 'WEB_SESSION_REQUIRED', description: '웹 로그인만 허용' },
    ],
    ['400 without error code -> error', httpError(400, {}), 'validate', 'HUMAN', { kind: 'fatal', code: 'error', description: '' }],
    ['403 without error code -> forbidden', httpError(403, { message: 'm' }), 'decide', 'HUMAN', { kind: 'fatal', code: 'forbidden', description: 'm' }],
    ['403 AGENT -> agent', httpError(403, { message: 'm' }), 'validate', 'AGENT', { kind: 'agent' }],
    ['500 -> transient', httpError(500, { message: 'boom' }), 'validate', 'HUMAN', { kind: 'transient' }],
    ['401 -> transient', httpError(401, {}), 'decide', 'HUMAN', { kind: 'transient' }],
    [
      'network (no response) -> transient',
      new AxiosError('Network Error', 'ERR_NETWORK'),
      'validate',
      'HUMAN',
      { kind: 'transient' },
    ],
    ['non-axios error -> transient', new Error('x'), 'decide', 'HUMAN', { kind: 'transient' }],
  ]

  it.each(cases)('%s', (_name, err, phase, userKind, expected) => {
    expect(readAuthorizeError(err, phase, userKind)).toEqual(expected)
  })

  it('rejects non-http errorRedirectUrl', () => {
    const err = httpError(400, { error: 'invalid_request', errorDescription: 'd', errorRedirectUrl: 'javascript:alert(1)' })
    expect(readAuthorizeError(err, 'validate', 'HUMAN')).toEqual({
      kind: 'fatal',
      code: 'invalid_request',
      description: '앱이 알려 준 돌아갈 주소가 올바르지 않습니다.',
    })
  })
})

describe('appInitial', () => {
  it.each([
    ['claude', 'C'],
    ['  가나', '가'],
    ['😀App', '😀'],
    ['   ', '?'],
    // 대문자로 바꾸면 두 글자가 되는 글자('ß' → 'SS')도 타일에는 한 글자만 넣는다.
    ['ßeta', 'S'],
  ])('%j -> %s', (name, expected) => {
    expect(appInitial(name)).toBe(expected)
  })
})

describe('isFramed', () => {
  it('is false when top is self', () => {
    const w: { top?: unknown; self?: unknown } = {}
    w.top = w
    w.self = w
    expect(isFramed(w as unknown as Window)).toBe(false)
  })

  it('is true when top differs', () => {
    expect(isFramed({ top: {}, self: {} } as unknown as Window)).toBe(true)
  })

  it('is true when reading top throws', () => {
    const w = {
      get top(): never {
        throw new Error('cross-origin')
      },
      self: {},
    }
    expect(isFramed(w as unknown as Window)).toBe(true)
  })
})

describe('needsDocumentReload', () => {
  it.each([
    // nginx 의 정확 일치 location = /oauth/authorize 로 받은 문서 — 프레임 금지 헤더가 붙어 있다.
    ['https://w.test/oauth/authorize?client_id=x&state=s', false],
    ['https://w.test/oauth/authorize', false],
    // 같은 화면이 그려지지만 nginx 정확 일치가 아닌 문서 — 'self' 헤더라 다시 받아야 한다.
    ['https://w.test/oauth/authorize/?client_id=x', true],
    ['https://w.test/OAuth/Authorize?client_id=x', true],
    ['https://w.test/oauth/AUTHORIZE', true],
    // 로그인 뒤 SPA 이동으로 들어온 경우 — 문서는 로그인·SSO 완료 화면에서 받았다.
    ['https://w.test/sso/complete', true],
    ['https://w.test/login', true],
    ['https://w.test/', true],
  ])('%s -> %s', (documentUrl, expected) => {
    expect(needsDocumentReload(documentUrl)).toBe(expected)
  })

  it('문서 주소를 알 수 없으면(jsdom 등) 다시 받지 않는다', () => {
    expect(needsDocumentReload(undefined)).toBe(false)
    expect(needsDocumentReload('not a url')).toBe(false)
  })

  it('다시 받은 문서에서는 다시 이동하지 않는다 — 무한 이동이 없다', () => {
    for (const search of ['?client_id=x&state=s', '', '?redirect_uri=https%3A%2F%2Fa.test%2Fcb']) {
      // 화면이 다시 받는 주소(CONSENT_PATH + 지금 쿼리)
      const target = CONSENT_PATH + search
      expect(target).toBe(`/oauth/authorize${search}`)
      // 브라우저가 이 주소로 문서를 받으면 navigation 항목의 이름은 절대 주소가 된다.
      expect(needsDocumentReload(new URL(target, 'https://w.test').href)).toBe(false)
    }
  })
})

describe('loadedDocumentUrl', () => {
  it('navigation 항목의 이름(문서를 받은 주소)을 돌려준다', () => {
    const perf = { getEntriesByType: (type: string) => (type === 'navigation' ? [{ name: 'https://w.test/login' }] : []) }
    expect(loadedDocumentUrl(perf as unknown as Performance)).toBe('https://w.test/login')
  })

  it('항목이 없거나 API 가 없으면 undefined', () => {
    expect(loadedDocumentUrl({ getEntriesByType: () => [] } as unknown as Performance)).toBeUndefined()
    expect(loadedDocumentUrl({} as unknown as Performance)).toBeUndefined()
    expect(loadedDocumentUrl(undefined)).toBeUndefined()
  })
})
