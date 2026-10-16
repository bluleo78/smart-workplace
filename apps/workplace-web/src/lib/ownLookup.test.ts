import { describe, expect, it } from 'vitest'

import { ownLookup } from './ownLookup'

describe('ownLookup', () => {
  const map: Record<string, string> = { a: 'A', empty: '' }

  it('자기 키면 값을 돌려준다(빈 문자열 값 포함)', () => {
    expect(ownLookup(map, 'a')).toBe('A')
    expect(ownLookup(map, 'empty')).toBe('')
  })

  it('없는 키·프로토타입 키는 undefined', () => {
    expect(ownLookup(map, 'missing')).toBeUndefined()
    expect(ownLookup(map, 'constructor')).toBeUndefined()
    expect(ownLookup(map, 'toString')).toBeUndefined()
    expect(ownLookup(map, '__proto__')).toBeUndefined()
  })
})
