// renderPage 의 비동기 대기 범위(WP-1006) — 페이지 테스트에서만 RTL 기본 대기를 늘리고, 다음 테스트에는 기본값으로 돌아간다.
import { getConfig } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { PAGE_ASYNC_TIMEOUT, renderPage } from './renderPage'

describe('renderPage — 비동기 대기', () => {
  test('렌더하면 그 테스트의 기본 대기가 PAGE_ASYNC_TIMEOUT 이 된다', () => {
    expect(getConfig().asyncUtilTimeout).toBe(1000)
    renderPage('/login')
    expect(getConfig().asyncUtilTimeout).toBe(PAGE_ASYNC_TIMEOUT)
  })

  // 순서에 기댄다 — 위 테스트가 늘린 값이 afterEach(setup.ts)로 되돌아가야 컴포넌트 테스트가 RTL 기본값을 쓴다.
  test('다음 테스트에는 RTL 기본값(1초)으로 돌아간다', () => {
    expect(getConfig().asyncUtilTimeout).toBe(1000)
  })
})
