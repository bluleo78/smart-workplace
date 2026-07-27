import { describe, expect, it } from 'vitest'

import { stripApiPrefix } from './blobContent'

describe('stripApiPrefix', () => {
  it('앞의 /api/v1 접두어를 제거한다 (client baseURL 과 중복 방지)', () => {
    expect(stripApiPrefix('/api/v1/wiki/attachments/7/content')).toBe(
      '/wiki/attachments/7/content',
    )
  })

  it('접두어가 없으면 그대로 둔다', () => {
    expect(stripApiPrefix('/wiki/attachments/7/content')).toBe('/wiki/attachments/7/content')
  })

  it('경로 중간의 /api/v1 은 건드리지 않는다', () => {
    expect(stripApiPrefix('/files/api/v1/x')).toBe('/files/api/v1/x')
  })
})
