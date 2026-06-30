import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

describe('CSV 파싱', () => {
  it('헤더+행을 2차원 배열로 파싱', () => {
    const { data } = Papa.parse<string[]>('a,b\n1,2', { skipEmptyLines: true })
    expect(data).toEqual([['a', 'b'], ['1', '2']])
  })
})
