import { describe, expect, it } from 'vitest'

import { readNodeDetail, updateNode } from './graphYaml'
import { appendBlock, replaceBlock, splitInstructionBlocks } from './instructionBlocks'
import { SPEC } from './specFixture'

/**
 * WP-2092 — 넓은 편집 창이 넘기는 문자열(한 블록만 고친 지시)이 YAML 을 거쳐 한 바이트도 안 바뀌고 돌아오는지,
 * 그리고 그 노드 밖 줄은 건드리지 않는지 확인한다.
 */
const KEY = 'triage'
const INSTRUCTIONS = [
  '## 절차',
  '',
  '| 단계 | 내용 |',
  '| --- | --- |',
  '| 1 | 읽기 |',
  '',
  '- 첫째',
  '- 둘째',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '마지막 단락',
].join('\n')

/** 노드 밖 줄 = 대상 노드 블록(다음 노드 키 줄 앞까지)을 뺀 나머지. 마지막 노드라 다음 키 줄이 없으면 파일 끝까지가 노드 블록이다. */
function outside(y: string): string[] {
  const lines = y.split('\n')
  const s = lines.findIndex((l) => l === `  ${KEY}:`)
  const found = lines.findIndex((l, i) => i > s && /^ {2}\S/.test(l))
  const e = found < 0 ? lines.length : found
  return [...lines.slice(0, s), ...lines.slice(e)]
}

describe('지시 편집 YAML 왕복', () => {
  it('블록 하나를 고친 지시가 YAML 을 거쳐 그대로 돌아오고 노드 밖 줄은 그대로다', () => {
    const first = updateNode(SPEC, KEY, { instructions: INSTRUCTIONS })
    expect(readNodeDetail(first, KEY)?.instructions).toBe(INSTRUCTIONS)

    const blocks = splitInstructionBlocks(INSTRUCTIONS).blocks
    const idx = blocks.findIndex((b) => b.raw.includes('첫째'))
    expect(idx).toBeGreaterThanOrEqual(0)
    const edited = replaceBlock(INSTRUCTIONS, idx, '- 첫째 고침\n- 둘째\n- 셋째')
    const second = updateNode(first, KEY, { instructions: edited })
    expect(readNodeDetail(second, KEY)?.instructions).toBe(edited)

    // 노드 밖 줄이 첫 갱신 뒤와 같아야 한다
    expect(outside(second)).toEqual(outside(first))
  })

  it('손으로 쓴 instructions: | 블록(값이 줄바꿈으로 끝남)에서 시작해도 고친 블록만 바뀌어 돌아온다', () => {
    // 픽스처 그대로의 지시 — 블록 스칼라라 값 끝에 \n 이 붙는다
    const original = readNodeDetail(SPEC, KEY)?.instructions ?? ''
    expect(original.endsWith('\n')).toBe(true)
    // 넓은 편집 창의 「+ 블록 추가」처럼 끝에 블록을 붙이고(끝 줄바꿈이 사라진다), 첫 블록을 고친다
    const appended = appendBlock(original, '| 단계 | 내용 |\n| --- | --- |\n| 1 | 읽기 |')
    const edited = replaceBlock(appended, 0, '이슈를 꼼꼼히 읽는다.')
    const next = updateNode(SPEC, KEY, { instructions: edited })
    expect(readNodeDetail(next, KEY)?.instructions).toBe(edited)
    // 노드 밖 줄은 원본 픽스처와 같다
    expect(outside(next)).toEqual(outside(SPEC))
    // 그 상태에서 한 번 더 고쳐도(왕복 두 번째) 그대로다
    const again = replaceBlock(edited, 1, '| 단계 | 내용 |\n| --- | --- |\n| 1 | 읽기 |\n| 2 | 쓰기 |')
    const next2 = updateNode(next, KEY, { instructions: again })
    expect(readNodeDetail(next2, KEY)?.instructions).toBe(again)
    expect(outside(next2)).toEqual(outside(SPEC))
  })
})
