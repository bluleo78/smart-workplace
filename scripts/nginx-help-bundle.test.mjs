// 웹 nginx 의 매뉴얼 도움말 묶음 location 글자 검사(WP-1504) — `node --test scripts/nginx-help-bundle.test.mjs`
// /help/ 아래 파일(manual-index.json·manual/<장>.json·figures/*.png)은 해시 없는 이름이라 새 배포가 바로 보이게 재검증해야 하고,
// 없는 파일을 SPA index.html(200)로 돌려주면 도움말 패널이 JSON 파싱 오류를 낸다 — 그 두 가지를 설정 글자로 막는다.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { locationBody, readWebNginxConf } from './nginx-conf-test-utils.mjs'

const conf = readWebNginxConf()

test('/help/ location 이 재검증(no-cache)하고 없는 파일은 404 로 낸다', () => {
  // `^~` 접두 — 뒤에 정규식 location(예: `~* \.(png|json)$` 캐시 규칙)이 생겨도 /help/ 요청은 이 블록이 잡는다.
  const body = locationBody(conf, '^~ /help/')
  assert.ok(body, 'location ^~ /help/ 가 없다')
  assert.match(body, /add_header\s+Cache-Control\s+"no-cache";/)
  assert.match(body, /try_files\s+\$uri\s+=404;/)
  // SPA 대체(index.html)로 떨어지지 않는다 — 떨어지면 프레임 헤더 검사 대상이 되고 패널이 HTML 을 JSON 으로 읽는다.
  assert.doesNotMatch(body, /index\.html/)
})
