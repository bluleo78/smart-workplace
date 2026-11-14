// 새 에이전트 폼 스키마 테스트(WP-1559) — 칸별 한국어 안내와 앞뒤 공백 제거를 지킨다.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { newAgentSchema } from './agent'

/** 실패한 검사의 칸 → 첫 메시지 맵. */
function messages(input: { username: string; name: string; email: string }) {
  const r = newAgentSchema.safeParse(input)
  if (r.success) return {}
  const fields = z.flattenError(r.error).fieldErrors as Record<string, string[] | undefined>
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]]))
}

describe('newAgentSchema', () => {
  it('빈 문자열 세 칸은 칸별 안내를 낸다', () => {
    expect(messages({ username: '', name: '', email: '' })).toEqual({
      username: '아이디를 입력하세요',
      name: '이름을 입력하세요',
      email: '이메일을 입력하세요',
    })
  })

  it('공백만 넣은 이름은 이름을 입력하라고 안내한다', () => {
    expect(messages({ username: 'a', name: '   ', email: 'a@b.co' })).toEqual({ name: '이름을 입력하세요' })
  })

  it('아이디·이름 51자는 50자 이하 안내를 낸다', () => {
    expect(messages({ username: 'a'.repeat(51), name: 'b'.repeat(51), email: 'a@b.co' })).toEqual({
      username: '아이디는 50자 이하여야 합니다',
      name: '이름은 50자 이하여야 합니다',
    })
  })

  it('이메일 형식이 아니면 유효한 이메일을 입력하라고 안내한다', () => {
    expect(messages({ username: 'a', name: 'b', email: 'not-an-email' })).toEqual({ email: '유효한 이메일을 입력하세요' })
  })

  it('정상 값은 앞뒤 공백을 잘라 통과한다', () => {
    const r = newAgentSchema.safeParse({ username: ' ws-agent ', name: ' 에이전트 ', email: ' a@b.co ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ username: 'ws-agent', name: '에이전트', email: 'a@b.co' })
  })
})
