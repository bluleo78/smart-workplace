// 웹·운영자 콘솔 nginx 설정의 보안 헤더 회귀 테스트 (WP-1291) — `node --test scripts/nginx-security-headers.test.mjs`
// nginx 의 add_header 는 location 사이에 상속되지 않아, index.html 을 내보내는 location 을 새로 만들 때 프레임 헤더를 빠뜨리기 쉽다.
// 실제 헤더는 nginx 컨테이너에 curl 로 확인했고(이슈 기록), 여기서는 설정 글자로 빠뜨림을 막는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// 저장소 루트 — 실행 위치(cwd)와 상관없이 설정 파일을 찾는다(다른 scripts/*.test.mjs 와 같은 방식).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CONFS = ['apps/workplace-web/nginx.conf', 'apps/workplace-admin/nginx.conf']

/** 주석을 지운 설정에서 server 블록 바로 아래 location 블록(머리·본문)을 차례로 꺼낸다 — 중첩 location 은 바깥 블록 본문에 남는다. */
function topLevelLocations(conf) {
  const text = conf.replace(/#.*$/gm, '')
  const out = []
  const re = /location\s+([^{]+)\{/g
  let m
  while ((m = re.exec(text))) {
    let depth = 1
    let i = re.lastIndex
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      i++
    }
    out.push({ head: m[1].trim(), body: text.slice(re.lastIndex, i - 1) })
    re.lastIndex = i
  }
  return out
}

for (const confPath of CONFS) {
  const conf = readFileSync(path.join(root, confPath), 'utf8')

  test(`${confPath}: index.html 을 내보내는 location 마다 프레임 헤더가 있다`, () => {
    const htmlLocations = topLevelLocations(conf).filter((l) => /try_files[^;]*\/index\.html/.test(l.body))
    assert.ok(htmlLocations.length > 0, 'index.html 을 내보내는 location 을 찾지 못했다')
    for (const l of htmlLocations) {
      assert.match(l.body, /add_header\s+Content-Security-Policy\s+"frame-ancestors 'self'"\s+always;/, `location ${l.head}`)
      assert.match(l.body, /add_header\s+X-Frame-Options\s+"SAMEORIGIN"\s+always;/, `location ${l.head}`)
    }
  })

  test(`${confPath}: 리다이렉트가 내부 포트가 붙은 절대 주소로 나가지 않는다`, () => {
    // server 블록에 있어야 모든 location 에 걸린다 — location 안으로 옮기면 나머지는 다시 절대 주소로 나간다.
    let serverLevel = conf.replace(/#.*$/gm, '')
    for (const l of topLevelLocations(conf)) serverLevel = serverLevel.replace(l.body, '')
    assert.match(serverLevel, /^\s*absolute_redirect\s+off;/m)
  })
}
