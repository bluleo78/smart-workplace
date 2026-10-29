// 앱 링크 호스트 설정 훅(WP-1165) — 설정 API 로 받은 공개 호스트가 더해지면 구독한 화면이 다시 그린다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { setPublicAppHost } from '@/lib/appLinks'
import { server } from '@/test/msw/server'

import { useAppHosts, useAppLinkConfig } from './useAppLinks'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useAppLinkConfig · useAppHosts', () => {
  afterEach(() => setPublicAppHost(null))

  it('설정을 받으면 공개 호스트가 더해져 다시 그린다', async () => {
    server.use(http.get('*/api/v1/app-links/config', () => HttpResponse.json({ appHost: 'works.example.com' })))
    const { result } = renderHook(
      () => {
        useAppLinkConfig()
        return useAppHosts()
      },
      { wrapper },
    )
    expect(result.current).toEqual(['localhost'])
    await waitFor(() => expect(result.current).toEqual(['localhost', 'works.example.com']))
  })

  it('서버 설정이 비었으면(null) 지금 호스트만 남는다', async () => {
    let called = false
    server.use(
      http.get('*/api/v1/app-links/config', () => {
        called = true
        return HttpResponse.json({ appHost: null })
      }),
    )
    const { result } = renderHook(
      () => {
        useAppLinkConfig()
        return useAppHosts()
      },
      { wrapper },
    )
    await waitFor(() => expect(called).toBe(true))
    expect(result.current).toEqual(['localhost'])
  })
})
