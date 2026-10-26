// E2E 판정 태그 강제(WP-971) — 모든 E2E 테스트는 왜 브라우저가 필요한지 태그 하나를 단다.
// @layout(기하) · @input(실제 입력) · @platform(브라우저·외부 연결) · @wiring(화면당 배선 1건) · @flow(여러 화면 흐름).
// 어느 것에도 맞지 않으면 vitest(순수 함수·페이지 테스트)로 쓴다 — 기준은 apps/workplace-web/CLAUDE.md 「테스트 종류 판정」.
//
// 태그는 test(title, { tag }, fn) 의 tag, 제목 안의 @태그, 감싸는 test.describe 의 tag·제목 어디서 와도 된다.
// 이관 전 테스트는 기준선(e2e/untagged-baseline.json — 파일별 태그 없는 테스트 수)만큼 허용한다. 기준선보다 늘면 오류다 —
// 경고로 두면 3천여 건이 lint 출력을 덮어 새로 늘어난 것을 못 본다. 이관하며 `pnpm e2e:tag-baseline` 으로 기준선을 낮춘다.
import path from 'node:path'

export const REASON_TAGS = ['@layout', '@input', '@platform', '@wiring', '@flow']
const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow'])
const DESCRIBE_MODIFIERS = new Set(['only', 'skip', 'fixme', 'serial', 'parallel'])

/** test(...) / test.only(...) 등 — 개별 테스트 호출인가. */
function isTestCall(node) {
  const c = node.callee
  if (c.type === 'Identifier') return c.name === 'test' && hasBody(node)
  return (
    c.type === 'MemberExpression' &&
    c.object.type === 'Identifier' &&
    c.object.name === 'test' &&
    c.property.type === 'Identifier' &&
    TEST_MODIFIERS.has(c.property.name) &&
    hasBody(node) &&
    isTitle(node.arguments[0])
  )
}

/** test.describe(...) / test.describe.serial(...) 등. */
function isDescribeCall(node) {
  let c = node.callee
  if (c.type !== 'MemberExpression') return false
  if (c.property.type === 'Identifier' && DESCRIBE_MODIFIERS.has(c.property.name) && c.object.type === 'MemberExpression') c = c.object
  return c.object.type === 'Identifier' && c.object.name === 'test' && c.property.type === 'Identifier' && c.property.name === 'describe'
}

const isTitle = (n) => n && (n.type === 'Literal' || n.type === 'TemplateLiteral')
const hasBody = (node) => {
  const last = node.arguments[node.arguments.length - 1]
  return last && (last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression')
}

/** 이 호출(테스트·describe)이 판정 태그를 다는가. 태그가 상수 등 리터럴이 아니면 확인할 수 없어 단 것으로 본다. */
function hasReasonTag(node) {
  const [title, opts] = node.arguments
  const titleText = title?.type === 'Literal' ? String(title.value) : title?.type === 'TemplateLiteral' ? title.quasis.map((q) => q.value.raw).join(' ') : ''
  if (REASON_TAGS.some((t) => titleText.includes(t))) return true
  if (opts?.type !== 'ObjectExpression') return false
  const tag = opts.properties.find((p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'tag')
  if (!tag) return false
  const values = tag.value.type === 'ArrayExpression' ? tag.value.elements : [tag.value]
  return values.some((v) => !v || v.type !== 'Literal' || REASON_TAGS.includes(v.value))
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'E2E 테스트마다 브라우저가 필요한 이유 태그(@layout·@input·@platform·@wiring·@flow)를 단다' },
    schema: [{ type: 'object', properties: { baseline: { type: 'object' } }, additionalProperties: false }],
    messages: {
      missing:
        'E2E 판정 태그가 없습니다({{tags}} 중 하나). 어느 것에도 맞지 않으면 vitest 로 쓰세요 — apps/workplace-web/CLAUDE.md 「테스트 종류 판정」. (이 파일 태그 없는 테스트 {{count}}건, 기준선 {{allowed}}건)',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {}
    const file = path.relative(context.cwd, context.filename).split(path.sep).join('/')
    const describeStack = []
    const untagged = []
    return {
      CallExpression(node) {
        if (isDescribeCall(node)) describeStack.push({ node, tagged: hasReasonTag(node) })
        else if (isTestCall(node) && !hasReasonTag(node) && !describeStack.some((d) => d.tagged)) untagged.push(node)
      },
      'CallExpression:exit'(node) {
        if (describeStack.length && describeStack[describeStack.length - 1].node === node) describeStack.pop()
      },
      'Program:exit'() {
        const allowed = baseline[file] ?? 0
        if (untagged.length <= allowed) return
        for (const node of untagged) {
          context.report({ node, messageId: 'missing', data: { tags: REASON_TAGS.join('·'), count: untagged.length, allowed } })
        }
      },
    }
  },
}
