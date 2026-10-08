import type { Schema } from '@tiptap/pm/model'

/**
 * 스키마 지문(WP-313) — WIKI_SCHEMA_VERSION 을 올리지 않은 스키마 변경을 테스트가 잡게 한다.
 * 패키지 테스트(공용 확장 묶음)와 웹 테스트(웹이 실제로 쓰는 확장 목록, NodeView 를 얹은 extend 포함)가 같은 함수로 계산해
 * 아래 판별 기록과 비교한다. 런타임 코드가 아니라 테스트 전용이지만 두 패키지가 공유하므로 subpath(`/schema-fingerprint`)로 낸다.
 * node:crypto 없이 순수 JS 해시를 쓴다 — 웹(jsdom)·서버 어디서든 같은 값.
 */

/**
 * 판별 스키마 지문 기록 — 덧붙이기만 한다(이미 있는 줄을 고치지 않는다).
 * 스키마를 바꿨다면: WIKI_SCHEMA_VERSION 을 1 올리고, 실패 메시지의 새 지문을 새 판 번호로 한 줄 추가한다.
 */
export const WIKI_SCHEMA_FINGERPRINTS: Readonly<Record<number, string>> = {
  1: '0641a89ba38ca7',
}

/** attrs 한 벌 — 이름과 기본값 유무·기본값(JSON)까지. 기본값이 바뀌면 옛 탭이 만든 노드의 attrs 해석이 달라진다. */
function attrsShape(attrs: Record<string, { default?: unknown }> | undefined): string {
  return Object.entries(attrs ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, spec]) => (spec && 'default' in spec ? `${name}=${JSON.stringify(spec.default) ?? 'undefined'}` : `${name}!`))
    .join(',')
}

/**
 * 스키마 모양을 정렬된 평문으로 — y-prosemirror 가 Y 항목을 해석할 때 쓰는 것(이름·attrs·허용 내용·허용 마크·그룹)만 담는다.
 * 순서 무관(정렬)이라 확장 등록 순서가 바뀌어도 같다.
 */
export function schemaShape(schema: Schema): string {
  const nodes = Object.values(schema.nodes)
    .map(
      (n) =>
        `node ${n.name} attrs[${attrsShape(n.spec.attrs)}] content[${n.spec.content ?? ''}] marks[${n.spec.marks ?? ''}] group[${n.spec.group ?? ''}] inline[${n.isInline}]`,
    )
    .sort()
  const marks = Object.values(schema.marks)
    .map((m) => `mark ${m.name} attrs[${attrsShape(m.spec.attrs)}] excludes[${m.spec.excludes ?? ''}]`)
    .sort()
  return [...nodes, ...marks].join('\n')
}

/** 모양 평문의 짧은 해시(cyrb53, 16진 14자리 남짓) — 기록에 적어 두는 지문. */
export function schemaFingerprint(schema: Schema): string {
  const str = schemaShape(schema)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}
