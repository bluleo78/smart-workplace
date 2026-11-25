import { describe, expect, it } from 'vitest'

import {
  appendBlock,
  instructionHeadings,
  joinInstructionBlocks,
  replaceBlock,
  splitInstructionBlocks,
} from './instructionBlocks'

// 긴 문단 — 지시문이 2천 자 이상이어도 블록 나누기가 깨지지 않는지 보려고 표본에 섞는다.
const LONG = '이 문장은 지시문이 길어지는 상황을 흉내 내기 위한 문장입니다. '.repeat(20).trim()

// 표·목록·코드 펜스(안에 빈 줄과 `## 가짜`)·인용·소제목을 섞은 표본 지시문.
const SAMPLE = `이 노드는 수집한 자료를 정리합니다.

## 입력

| 이름 | 설명 |
|------|------|
| a    | 첫째 |
| b    | 둘째 |

- 항목 하나
- 항목 둘
  - 안쪽 항목

1. 첫 단계
2. 둘째 단계

\`\`\`yaml
key: value

## 가짜
other: 1
\`\`\`

> 인용 한 줄

### 소제목

${LONG}

${LONG}

${LONG}
`

describe('instructionBlocks', () => {
  it('표본은 2천 자 이상이다', () => {
    expect(SAMPLE.length).toBeGreaterThan(2000)
  })

  it.each([SAMPLE, '', '\n\n앞 빈 줄\n', '끝 줄바꿈 없음', 'a\r\n\r\n| x |\r\n|---|\r\n| 1 |\r\n', '## 제목만'])(
    'join(split(s)) === s',
    (s) => {
      expect(joinInstructionBlocks(splitInstructionBlocks(s))).toBe(s)
    },
  )

  it('블록 종류 순서와 코드 블록 하나', () => {
    const doc = splitInstructionBlocks(SAMPLE)
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'heading',
      'table',
      'list',
      'list',
      'code',
      'other',
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
    ])
    const codes = doc.blocks.filter((b) => b.kind === 'code')
    expect(codes).toHaveLength(1)
    expect(codes[0].raw).toContain('## 가짜')
  })

  it('제목 목록은 2·3단계만이고 가짜 제목이 없다', () => {
    const heads = instructionHeadings(splitInstructionBlocks(SAMPLE))
    expect(heads).toEqual([
      { index: 1, depth: 2, text: '입력' },
      { index: 7, depth: 3, text: '소제목' },
    ])
    expect(heads.some((h) => h.text.includes('가짜'))).toBe(false)
  })

  it('블록 0개면 lead 가 원문이다', () => {
    expect(splitInstructionBlocks('')).toEqual({ lead: '', blocks: [] })
    expect(splitInstructionBlocks('\n\n').lead).toBe('\n\n')
  })

  it('replaceBlock 은 그 블록 바이트만 바꾼다', () => {
    const doc = splitInstructionBlocks(SAMPLE)
    doc.blocks.forEach((b, i) => {
      const out = replaceBlock(SAMPLE, i, 'X')
      expect(out).toBe(SAMPLE.slice(0, b.start) + 'X' + SAMPLE.slice(b.end))
      expect(out.length - SAMPLE.length).toBe(1 - b.raw.length)
    })
  })

  it('7천 자 넘는 지시도 왕복·블록 바꾸기가 바이트 그대로다', () => {
    // 표본을 빈 줄로 이어 붙여 실제 긴 지시(7천 자 이상) 크기로 — 블록마다 바꿔도 그 블록 밖은 그대로여야 한다
    const big = Array(4).fill(SAMPLE).join('\n')
    expect(big.length).toBeGreaterThan(7000)
    const doc = splitInstructionBlocks(big)
    expect(joinInstructionBlocks(doc)).toBe(big)
    expect(doc.blocks.length).toBe(splitInstructionBlocks(SAMPLE).blocks.length * 4)
    doc.blocks.forEach((b, i) => {
      expect(replaceBlock(big, i, 'X')).toBe(big.slice(0, b.start) + 'X' + big.slice(b.end))
    })
  })

  it('CRLF 원문에서 블록을 바꿔도 나머지 줄바꿈이 그대로다', () => {
    const src = '첫 문단\r\n\r\n| x |\r\n|---|\r\n| 1 |\r\n\r\n끝 문단\r\n'
    const b = splitInstructionBlocks(src).blocks[1]
    const count = (s: string) => (s.match(/\r\n/g) ?? []).length
    const out = replaceBlock(src, 1, 'X')
    expect(count(out)).toBe(count(src) - count(b.raw))
  })

  it('appendBlock', () => {
    expect(appendBlock('', '새 글')).toBe('새 글')
    expect(appendBlock('   ', '새 글')).toBe('   새 글')
    expect(appendBlock('a', 'b')).toBe('a\n\nb')
    expect(appendBlock('a\n', 'b')).toBe('a\n\nb')
  })
})
