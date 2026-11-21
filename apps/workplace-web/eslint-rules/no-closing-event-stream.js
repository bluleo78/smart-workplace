// 바로 닫히는 /api/v1/events 스텁 금지(WP-1877).
// 왜: events 를 빈 본문·SSE 주석 같은 유한 본문으로 fulfill 하면 응답 직후 스트림이 끝나 클라이언트가 재연결하고,
//   재연결 catch-up(활성 쿼리 전체 재조회)이 스펙의 요청 카운트·캐시를 흔든다.
// 잡는 것: `<무엇>.route(events 경로, 핸들러)` 안의 `fulfill({...})` 가 body 를 빈 문자열/공백/SSE 주석 줄뿐으로 주거나,
//   body·json·path·response 키가 모두 없을 때(단, 정적 status 가 2xx 가 아닌 오류 응답은 body 가 비어도 전부 제외).
// 안 잡는 것: 값을 알 수 없는 본문(변수·호출), 프레임이 담긴 본문, 변수 경로·이름 붙은 핸들러,
//   열린 스트림 마커(SSE_HOLD_HEADER·'x-e2e-sse-hold')를 headers 에 단 fulfill.
// 대안: 맨 page 는 stubOpenEventStream, 이벤트 전달은 pushHeldEvents·mockGatedEvents(e2e/fixtures).
const EVENTS_PATH = '/api/v1/events'
// fulfill 이 응답 바디를 정하는 키 — 하나도 없으면 바디 없는 응답이다.
const BODY_KEYS = ['body', 'json', 'path', 'response']
// 열린 스트림으로 바꿔치기하라는 마커 헤더(openEventStream.ts SSE_HOLD_HEADER) — 식별자 키 이름 또는 문자열 키.
const HOLD_IDENT = 'SSE_HOLD_HEADER'
const HOLD_STRING = 'x-e2e-sse-hold'
// 빈 문자열 또는 공백·SSE 주석 줄(`:` 로 시작하는 줄)만으로 된 본문.
const CLOSING_BODY = /^(?:\s|:[^\n]*(?:\n|$))*$/

/** 정적으로 값을 알 수 있는 문자열(리터럴·식 없는 템플릿)이면 값을, 아니면 null. */
function staticString(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

/** 노드 하위의 모든 노드마다 visit 를 부른다(parent 링크는 따라가지 않는다). */
function forEachNode(root, visit) {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n.type !== 'string') continue
    visit(n)
    for (const key of Object.keys(n)) {
      if (key === 'parent') continue
      const v = n[key]
      if (Array.isArray(v)) stack.push(...v)
      else if (v && typeof v === 'object') stack.push(v)
    }
  }
}

/** visit 가 true 를 돌려주는 노드가 하위에 있는가. */
function someNode(root, visit) {
  let found = false
  forEachNode(root, (n) => {
    if (!found && visit(n)) found = true
  })
  return found
}

/** 일반 속성(Property, 계산 키 아님)의 키 이름을, 아니면 null. */
function propName(p) {
  if (p.type !== 'Property' || p.computed) return null
  return p.key.type === 'Identifier' ? p.key.name : p.key.value
}

/** fulfill 객체의 headers 에 열린 스트림 마커 키가 있는가. */
function hasHoldMarker(obj) {
  const headers = obj.properties.find((p) => propName(p) === 'headers')
  if (!headers || headers.value.type !== 'ObjectExpression') return false
  return headers.value.properties.some((h) => {
    if (h.type !== 'Property') return false
    // 마커는 계산 키 `[SSE_HOLD_HEADER]` 로도 오므로 propName 대신 직접 본다.
    if (h.key.type === 'Identifier') return h.computed ? h.key.name === HOLD_IDENT : h.key.name === HOLD_STRING
    return h.key.type === 'Literal' && h.key.value === HOLD_STRING
  })
}

/** fulfill 객체 하나를 검사해 닫히는 응답이면 보고한다. */
function checkFulfillObject(context, obj) {
  if (hasHoldMarker(obj)) return
  // 스프레드·계산 키가 있으면 키를 알 수 없으므로 '키 없음' 판정에서 제외한다.
  const names = obj.properties.map(propName)
  // 정적 status 가 2xx 가 아니면 의도한 오류 응답(예: `{ status: 503, body: '' }`)이라 닫히는 스트림 검사 전체를 건너뛴다.
  const statusProp = obj.properties.find((p) => propName(p) === 'status')
  const status = statusProp && statusProp.value.type === 'Literal' && typeof statusProp.value.value === 'number' ? statusProp.value.value : null
  if (status !== null && (status < 200 || status >= 300)) return
  if (!names.includes(null) && !names.some((k) => BODY_KEYS.includes(k))) context.report({ node: obj, messageId: 'closingStream' })
  for (const p of obj.properties) {
    if (propName(p) !== 'body') continue
    const v = staticString(p.value)
    if (v !== null && CLOSING_BODY.test(v)) context.report({ node: p, messageId: 'closingStream' })
  }
}

/** route 첫 인자가 events 경로를 가리키는가 — 문자열 리터럴 또는 본문에 경로 리터럴을 담은 함수. */
function targetsEvents(arg) {
  if (!arg) return false
  const s = staticString(arg)
  if (s !== null) return s.includes(EVENTS_PATH)
  // 정규식 리터럴 — source 가 `api\/v1\/events` 또는 `api/v1/events` 를 담으면 events route.
  if (arg.type === 'Literal' && arg.regex) return /api\\?\/v1\\?\/events/.test(arg.regex.pattern)
  if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
    // 리터럴뿐 아니라 식 없는 템플릿 리터럴(`/api/v1/events`)도 경로로 본다.
    return someNode(arg.body, (n) => {
      const v = staticString(n)
      return v !== null && v.includes(EVENTS_PATH)
    })
  }
  return false
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      closingStream:
        '바로 닫히는 `/api/v1/events` 본문은 재연결·catch-up 으로 테스트를 흔든다 — 맨 page 는 `stubOpenEventStream`, 이벤트는 `pushHeldEvents`·`mockGatedEvents` 를 쓴다(WP-1877).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const c = node.callee
        if (c.type !== 'MemberExpression' || c.property.type !== 'Identifier' || c.property.name !== 'route') return
        if (!targetsEvents(node.arguments[0])) return
        const handler = node.arguments[1]
        if (!handler) return
        // 핸들러 안의 `<무엇>.fulfill({ ... })` 를 모두 검사한다.
        forEachNode(handler, (n) => {
          const callee = n.type === 'CallExpression' ? n.callee : null
          if (!callee || callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier' || callee.property.name !== 'fulfill') return
          const obj = n.arguments[0]
          if (obj && obj.type === 'ObjectExpression') checkFulfillObject(context, obj)
        })
      },
    }
  },
}
