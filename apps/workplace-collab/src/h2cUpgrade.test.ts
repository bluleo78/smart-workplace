import './dom-install'

import { connect as netConnect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { buildCollabServer } from './app'
import type { CollabConfig } from './config'
import { yDocToMarkdown } from './markdownCodec'
import type { CollabServer } from './server'
import { connectClient, type TestClient } from './testing/clients'
import { TEST_MODE_INTERNAL_TOKEN } from './testMode'

/** 원시 소켓 응답 — 상태 코드·헤더(소문자 키)·본문. */
interface RawResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * 원시 HTTP/1.1 요청을 소켓에 그대로 써서 응답을 받는다. fetch(undici)는 Upgrade 헤더를 막으므로 h2c 업그레이드 요청을 흉내 낼 수 없다.
 * 응답은 Content-Length 만큼(또는 청크 인코딩의 마지막 청크까지) 본문이 오면 끝난 것으로 본다.
 */
function rawRequest(port: number, method: string, path: string, headers: Record<string, string>, body = ''): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1')
    const payload = Buffer.from(body, 'utf8')
    const lines = [`${method} ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`]
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
    if (payload.length > 0 || method !== 'GET') lines.push(`Content-Length: ${payload.length}`)
    let buf = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`no complete response within 5s: ${buf.toString('utf8')}`))
    }, 5000)
    const tryParse = () => {
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const head = buf.subarray(0, sep).toString('utf8').split('\r\n')
      const status = Number(head[0].split(' ')[1])
      const hs: Record<string, string> = {}
      for (const l of head.slice(1)) {
        const i = l.indexOf(':')
        hs[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim()
      }
      const rest = buf.subarray(sep + 4)
      let body: string
      if (hs['transfer-encoding'] === 'chunked') {
        // 청크 인코딩 — 마지막 0 청크까지 와야 끝.
        const raw = rest.toString('latin1')
        if (!raw.includes('\r\n0\r\n\r\n') && !raw.startsWith('0\r\n\r\n')) return
        const out: Buffer[] = []
        let i = 0
        for (;;) {
          const eol = rest.indexOf('\r\n', i)
          const size = parseInt(rest.subarray(i, eol).toString('latin1'), 16)
          if (size === 0) break
          out.push(rest.subarray(eol + 2, eol + 2 + size))
          i = eol + 2 + size + 2
        }
        body = Buffer.concat(out).toString('utf8')
      } else {
        const len = Number(hs['content-length'] ?? 0)
        if (rest.length < len) return
        body = rest.subarray(0, len).toString('utf8')
      }
      clearTimeout(timer)
      socket.destroy()
      resolve({ status, headers: hs, body })
    }
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      tryParse()
    })
    // 서버가 응답 없이 끊으면(업그레이드 경로의 404 후 destroy 등) 받은 만큼으로 판정한다.
    socket.on('end', () => {
      tryParse()
      clearTimeout(timer)
      const m = /^HTTP\/1\.1 (\d+)/.exec(buf.toString('utf8'))
      resolve({ status: m ? Number(m[1]) : 0, headers: {}, body: buf.toString('utf8') })
    })
    socket.on('error', reject)
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    if (payload.length > 0) socket.write(payload)
  })
}

// JDK HttpClient(HTTP/2 기본)가 평문 요청에 붙이는 h2c 업그레이드 헤더 — 이걸 WebSocket 업그레이드로 오인해 404 를 냈다.
const H2C = {
  Connection: 'Upgrade, HTTP2-Settings',
  Upgrade: 'h2c',
  'HTTP2-Settings': 'AAMAAABkAARAAAAAAAIAAAAA',
}

describe('non-websocket Upgrade header (h2c) is served as plain HTTP', () => {
  let app: CollabServer
  let clients: TestClient[] = []

  const start = async () => {
    const cfg: CollabConfig = {
      port: 0,
      // 테스트 모드는 API 를 부르지 않는다 — 닿을 수 없는 주소로 둬 실수로 부르면 실패하게.
      apiUrl: 'http://127.0.0.1:9',
      internalToken: '',
      testMode: true,
      debounceMs: 50,
      maxDebounceMs: 200,
    }
    app = buildCollabServer(cfg)
    await app.listen()
  }

  afterEach(async () => {
    for (const c of clients) c.provider.destroy()
    clients = []
    await app.destroy()
  })

  it('answers GET /health with 200 despite Upgrade: h2c', async () => {
    await start()
    const res = await rawRequest(app.address.port, 'GET', '/health', H2C)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    // 프로토콜은 바꾸지 않는다 — 101 이 아니라 평범한 응답.
    expect(res.headers.upgrade).toBeUndefined()
  })

  it('routes POST /internal/docs/{id}/apply-markdown with Upgrade: h2c to the internal handler', async () => {
    await start()
    const port = app.address.port
    const doc = 'e2e-h2c/wiki-page:5'
    const seed = await rawRequest(port, 'POST', '/__test/seed', { 'Content-Type': 'application/json' }, JSON.stringify({ docName: doc, body: '원래 본문' }))
    expect(seed.status).toBe(204)
    const res = await rawRequest(
      port,
      'POST',
      '/internal/docs/5/apply-markdown',
      { ...H2C, 'Content-Type': 'application/json', Authorization: `Internal ${TEST_MODE_INTERNAL_TOKEN}` },
      JSON.stringify({ tenantId: 1, mode: 'replace', body: 'AI 본문', actor: { userId: 1, name: '양동희' }, ai: true, docName: doc }),
    )
    expect(res.status).toBe(200)
    expect((JSON.parse(res.body) as { body: string }).body).toBe('AI 본문')
    // 인증도 평소대로 — 토큰이 없으면 401(업그레이드 경로의 404 가 아님).
    const unauth = await rawRequest(port, 'POST', '/internal/docs/revalidate', { ...H2C, 'Content-Type': 'application/json' }, JSON.stringify({ tenantId: 1, pageIds: [5] }))
    expect(unauth.status).toBe(401)
  })

  it('still upgrades real WebSocket requests on /collab', async () => {
    await start()
    const doc = 'e2e-h2c/wiki-page:6'
    await rawRequest(app.address.port, 'POST', '/__test/seed', { 'Content-Type': 'application/json' }, JSON.stringify({ docName: doc, body: '본문' }))
    const c = connectClient(app.address.port, doc, 'uid=1')
    clients.push(c)
    await expect.poll(() => c.provider.isSynced, { timeout: 5000 }).toBe(true)
    expect(yDocToMarkdown(c.doc)).toBe('본문')
  })
})
