import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { LinkPreview, MessageResponse } from '../../types/messaging'
import { withLatestLinkPreviews } from './linkPreviewCache'
import { messagingKeys } from './messagingKeys'

// 쓰기 응답이 SSE 로 받은 미리보기를 덮지 않는다(WP-874) — 채널·스레드 캐시 모두에서 찾는다.
const P = (title: string): LinkPreview => ({ position: 0, url: `https://${title}.com`, title, description: null, siteName: null, hasImage: false })
const msg = (id: number, linkPreviews: LinkPreview[]) => ({ id, linkPreviews }) as unknown as MessageResponse
const page = (items: MessageResponse[]) => ({ pages: [{ items, nextCursor: null, hasMore: false }], pageParams: [null] })

describe('withLatestLinkPreviews', () => {
  it('채널 캐시에 같은 id 가 있으면 그 linkPreviews(빈 배열 포함)를 얹는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.messages(1), page([msg(5, [P('sse')])]))
    expect(withLatestLinkPreviews(qc, 1, msg(5, [P('rest')])).linkPreviews).toEqual([P('sse')])
    qc.setQueryData(messagingKeys.messages(1), page([msg(5, [])]))
    expect(withLatestLinkPreviews(qc, 1, msg(5, [P('rest')])).linkPreviews).toEqual([])
  })

  it('스레드 캐시의 답글도 찾는다', () => {
    const qc = new QueryClient()
    qc.setQueryData(messagingKeys.thread(9), page([msg(6, [P('sse')])]))
    expect(withLatestLinkPreviews(qc, 1, msg(6, [])).linkPreviews).toEqual([P('sse')])
  })

  it('캐시에 없으면 응답 그대로', () => {
    const qc = new QueryClient()
    const saved = msg(7, [P('rest')])
    expect(withLatestLinkPreviews(qc, 1, saved)).toBe(saved)
  })
})
