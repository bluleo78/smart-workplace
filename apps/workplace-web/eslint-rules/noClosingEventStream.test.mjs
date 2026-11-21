// no-closing-event-stream 규칙(WP-1877) 단위 테스트 — RuleTester 를 vitest 에 연결해 검증한다.
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, it } from 'vitest'

import rule from './no-closing-event-stream.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
})

const err = [{ messageId: 'closingStream' }]

tester.run('no-closing-event-stream', rule, {
  valid: [
    // 변수·함수 호출 본문은 값을 알 수 없으므로 잡지 않는다(실제 이벤트 프레임을 보내는 경우).
    "page.route('**/api/v1/events', (route) => route.fulfill({ status: 200, body: buildWikiAiSse(['x'], 'c') }))",
    "page.route('**/api/v1/events', (route) => route.fulfill({ body: sseFrames }))",
    // 다른 경로의 빈 본문은 대상이 아니다.
    "page.route('**/api/v1/issues', (route) => route.fulfill({ body: '' }))",
    // 이벤트 프레임이 담긴 유한 본문은 허용한다.
    "page.route('**/api/v1/events', (route) => route.fulfill({ status: 200, body: 'event: x\\ndata: 1\\n\\n' }))",
    // 끝나지 않는 핸들러(fulfill 없음)는 열린 스트림이다.
    "a.route('**/api/v1/events', () => new Promise(() => {}))",
    // events 가 아닌 route 의 바디 없는 fulfill 은 대상이 아니다.
    "page.route('**/api/v1/issues', (route) => route.fulfill({ status: 204 }))",
    // events route 라도 response 키로 바디를 넘기면(원 응답 중계) 바로 닫히는 응답이 아니다.
    "page.route('**/api/v1/events', async (route) => { const response = await route.fetch(); return route.fulfill({ response }) })",
    // 열린 스트림 마커 헤더가 붙은 fulfill 은 래퍼가 열린 스트림으로 바꾼다 — 잡지 않는다.
    "page.route('**/api/v1/events', (route) => route.fulfill({ status: 200, headers: { [SSE_HOLD_HEADER]: '1' }, body: '' }))",
    "page.route('**/api/v1/events', (route) => route.fulfill({ headers: { 'x-e2e-sse-hold': '1' }, body: '' }))",
  ],
  invalid: [
    // 정규식 경로 매처도 events route 로 본다.
    {
      code: "page.route(/api\\/v1\\/events/, (route) => route.fulfill({ body: '' }))",
      errors: err,
    },
    // 마지막 주석 줄에 줄바꿈이 없어도 닫히는 본문이다.
    {
      code: "page.route('**/api/v1/events', (route) => route.fulfill({ body: ':keepalive' }))",
      errors: err,
    },
    {
      code: "page.route('**/api/v1/events', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))",
      errors: err,
    },
    {
      code: "page.route((url) => url.pathname === '/api/v1/events', (r) => r.fulfill({ body: ':\\n\\n' }))",
      errors: err,
    },
    {
      code: 'page.route(\'**/api/v1/events\', (route) => route.fulfill({ body: `: ping\\n\\n` }))',
      errors: err,
    },
    {
      code: "page.route('**/api/v1/events', async (route) => { await x(); return route.fulfill({ body: '' }) })",
      errors: err,
    },
    // 바디 키가 없는 응답도 바로 닫힌다.
    {
      code: "page.route('**/api/v1/events', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream' }))",
      errors: err,
    },
  ],
})
