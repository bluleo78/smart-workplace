import { describe, expect, it } from 'vitest'

import { precacheGlobPatterns } from './pwa-precache.mjs'

const PROD = ['**/*.{js,css,html,svg,png,woff2}']

describe('precacheGlobPatterns', () => {
  it('E2E=1 빌드는 앱 셸(index.html)만 미리 받는다', () => {
    expect(precacheGlobPatterns({ E2E: '1' })).toEqual(['index.html'])
  })
  // E2E=1 이 아니면 모두 운영 패턴 — 없음·다른 값·CI 만 있음(운영 이미지 빌드는 CI=true).
  it.each([{}, { E2E: '0' }, { E2E: 'true' }, { E2E: '' }, { CI: 'true' }])('%j 는 운영 패턴', (env) => {
    expect(precacheGlobPatterns(env)).toEqual(PROD)
  })
  it('돌려준 배열을 바꿔도 다음 결과가 오염되지 않는다', () => {
    precacheGlobPatterns({}).push('x')
    precacheGlobPatterns({ E2E: '1' }).push('y')
    expect(precacheGlobPatterns({})).toEqual(PROD)
    expect(precacheGlobPatterns({ E2E: '1' })).toEqual(['index.html'])
  })
})
