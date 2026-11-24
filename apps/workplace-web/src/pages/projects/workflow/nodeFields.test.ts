// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { NODE_FIELDS } from './nodeFields'

/** 서버 스키마의 종류별 허용 칸 — 패널 표가 이것과 어긋나면 게시 때 NODE_FIELD_NOT_ALLOWED 가 난다. */
const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../../packages/mcp-tools-shared/src/workflow-schema.json', import.meta.url)), 'utf8'),
) as { 'x-nodeTypes': Record<string, string[]> }

describe('NODE_FIELDS 와 workflow-schema.json', () => {
  it('노드 종류가 같다', () => {
    expect(Object.keys(NODE_FIELDS).sort()).toEqual(Object.keys(schema['x-nodeTypes']).sort())
  })

  it.each(Object.keys(schema['x-nodeTypes']))('%s 의 패널 칸은 스키마가 허용하는 칸뿐이다', (type) => {
    const allowed = new Set(schema['x-nodeTypes'][type])
    for (const field of NODE_FIELDS[type] ?? []) expect(allowed.has(field), field).toBe(true)
  })
})
