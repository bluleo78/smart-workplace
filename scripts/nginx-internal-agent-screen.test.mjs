// web·admin nginx 가 AI 작업 화면 내부 경로를 밖에서 막는지 글자 검사(WP-1978) — `node --test scripts/nginx-internal-agent-screen.test.mjs`
// 내부 경로(/api/v1/internal/agent-screen/)는 다른 api 파드가 파드 IP:9090 으로 바로 부르는 경로라 nginx 를 거쳐 들어오면 안 된다.
// `location /api/` 프록시보다 먼저(`^~` 접두) 404 로 끝나야 한다 — 빠지면 내부 토큰 하나만 남는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { locationBody, readWebNginxConf } from './nginx-conf-test-utils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** admin nginx.conf 를 주석을 지운 글자로 읽는다(웹 쪽 도구와 같은 방식). */
function readAdminNginxConf() {
  return readFileSync(path.join(root, 'apps/workplace-admin/nginx.conf'), 'utf8').replace(/#.*$/gm, '')
}

for (const [name, conf] of [
  ['web', readWebNginxConf()],
  ['admin', readAdminNginxConf()],
]) {
  test(`${name} nginx 가 작업 화면 내부 경로를 404 로 막는다`, () => {
    const body = locationBody(conf, '^~ /api/v1/internal/agent-screen/')
    assert.ok(body, 'location ^~ /api/v1/internal/agent-screen/ 가 없다')
    assert.match(body, /return\s+404;/)
    assert.doesNotMatch(body, /proxy_pass/)
  })
}
