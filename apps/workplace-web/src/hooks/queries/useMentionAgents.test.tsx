// useMentionAgents — 멘션 후보 에이전트를 한 페이지(100건)에서 끊지 않고 마지막 페이지까지 받는지(WP-183).
// e2e/pages/chat/mention-plaintext-trigger.spec.ts 의 「에이전트가 100명을 넘어도」에서 옮겼다(WP-984) — 페이지를 이어 받는 판정은
// 브라우저 없이 MSW 로 요청을 보면 된다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'

import { createMember } from '../../../e2e/factories/auth.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'
import { useMentionAgents } from './useMentionAgents'

describe('useMentionAgents', () => {
  it('에이전트가 100명을 넘으면 다음 페이지까지 받아 101번째도 후보에 넣는다', async () => {
    const pages: string[] = []
    server.use(
      http.get('/api/v1/members', ({ request }) => {
        const params = new URL(request.url).searchParams
        expect(params.get('kind')).toBe('AGENT')
        const n = Number(params.get('page') ?? 0)
        pages.push(String(n))
        const agents =
          n === 0
            ? Array.from({ length: 100 }, (_, i) => createMember({ userId: 1000 + i, name: `봇${i}`, username: `bot${i}`, kind: 'AGENT' }))
            : [createMember({ userId: 5000, name: '막내봇', username: 'lastbot', kind: 'AGENT' })]
        return HttpResponse.json(createPageResponse(agents, { page: n, size: 100, totalElements: 101, totalPages: 2 }))
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useMentionAgents(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(101)
    expect(result.current.data?.at(-1)).toEqual({ userId: 5000, username: 'lastbot', name: '막내봇', kind: 'AGENT' })
    expect(pages).toEqual(['0', '1'])
  })
})
