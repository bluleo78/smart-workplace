import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { LOOPBACK } from './loopbackListen'

// setupFiles 의 loopbackListen 이 이 패키지 테스트 프로세스에 걸려 있는지 — 빠지면 다른 프로세스와 포트를 나눠 써 요청을 가로채인다.
describe('test servers on ephemeral ports bind 127.0.0.1', () => {
  const servers: Server[] = []
  const listening = (server: Server, listen: (done: () => void) => void) =>
    new Promise<AddressInfo>((resolve) => {
      servers.push(server)
      listen(() => resolve(server.address() as AddressInfo))
    })

  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
  })

  it('binds synchronously like a plain listen(0) — address() is ready right after the call (supertest relies on it)', () => {
    const s = createServer()
    servers.push(s)
    s.listen(0)
    expect((s.address() as AddressInfo | null)?.address).toBe(LOOPBACK)
  })

  it('binds listen(0) and listen({ port: 0 }) to 127.0.0.1', async () => {
    const a = createServer()
    expect((await listening(a, (done) => a.listen(0, done))).address).toBe(LOOPBACK)
    const b = createServer()
    // Hocuspocus 처럼 host 를 undefined 로 넘기는 옵션 객체.
    expect((await listening(b, (done) => b.listen({ port: 0, host: undefined }, done))).address).toBe(LOOPBACK)
  })

  it('keeps an explicitly given address', async () => {
    const s = createServer()
    expect((await listening(s, (done) => s.listen(0, '::1', done))).address).toBe('::1')
  })
})
