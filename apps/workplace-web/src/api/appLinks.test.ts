// 이슈 키 상태 일괄 로더(WP-2102) — 같은 틱에 모인 키를 한 번의 POST 로(100개씩 나눠) 보내고 키마다 자기 항목을 돌려주는지 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadIssueKeyStatus } from './appLinks'
import { client } from './client'

vi.mock('./client', () => ({ client: { post: vi.fn(), get: vi.fn() } }))

const post = vi.mocked(client.post)

/** 요청 본문의 키마다 「완료」 항목을 돌려주되 ABSENT-1 은 못 보는 키라 뺀다. */
function respondDone() {
  post.mockImplementation(async (_url: string, body?: unknown) => {
    const keys = (body as { keys: string[] }).keys
    return { data: { items: keys.filter((k) => k !== 'ABSENT-1').map((k) => ({ issueKey: k, statusName: '완료', statusCategory: 'DONE' })) } }
  })
}

beforeEach(() => {
  post.mockReset()
})

describe('loadIssueKeyStatus', () => {
  it('같은 틱의 서로 다른 키 30개는 POST 한 번, 각자 자기 항목(없으면 null)', async () => {
    respondDone()
    const keys = Array.from({ length: 29 }, (_, i) => `WP-${i + 1}`).concat('ABSENT-1')
    const results = await Promise.all(keys.map((k) => loadIssueKeyStatus(k)))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe('/app-links/issue-statuses')
    results.slice(0, 29).forEach((r, i) => expect(r).toEqual({ issueKey: `WP-${i + 1}`, statusName: '완료', statusCategory: 'DONE' }))
    expect(results[29]).toBeNull()
  })

  it('같은 키를 두 번 불러도 본문에는 한 번', async () => {
    respondDone()
    const [a, b] = await Promise.all([loadIssueKeyStatus('WP-1'), loadIssueKeyStatus('WP-1')])
    expect((post.mock.calls[0][1] as { keys: string[] }).keys).toEqual(['WP-1'])
    expect(a).toEqual(b)
  })

  it('키 150개는 POST 두 번(100 + 50)', async () => {
    respondDone()
    const keys = Array.from({ length: 150 }, (_, i) => `WP-${i + 1}`)
    await Promise.all(keys.map((k) => loadIssueKeyStatus(k)))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.map((c) => (c[1] as { keys: string[] }).keys.length).sort((x, y) => x - y)).toEqual([50, 100])
  })

  it('한 묶음(100개)이 실패해도 다른 묶음의 키는 거절되지 않는다', async () => {
    post.mockImplementation(async (_url: string, body?: unknown) => {
      const keys = (body as { keys: string[] }).keys
      if (keys.includes('WP-1')) throw new Error('boom')
      return { data: { items: keys.map((k) => ({ issueKey: k, statusName: '완료', statusCategory: 'DONE' })) } }
    })
    const keys = Array.from({ length: 150 }, (_, i) => `WP-${i + 1}`)
    const results = await Promise.allSettled(keys.map((k) => loadIssueKeyStatus(k)))
    expect(results.slice(0, 100).every((r) => r.status === 'rejected')).toBe(true)
    expect(results.slice(100).every((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('요청이 실패하면 그 묶음의 프라미스가 모두 거절된다', async () => {
    post.mockRejectedValue(new Error('boom'))
    const results = await Promise.allSettled([loadIssueKeyStatus('WP-1'), loadIssueKeyStatus('WP-2')])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })
})
