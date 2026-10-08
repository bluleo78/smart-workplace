import { describe, expect, it } from 'vitest'

import { withItemType } from './blobType'

describe('withItemType', () => {
  it('octet-stream·빈 형식 blob 은 항목 형식으로 다시 감싼다(내용은 그대로)', async () => {
    const b = withItemType(new Blob(['%PDF-1'], { type: 'application/octet-stream' }), 'application/pdf')
    expect(b.type).toBe('application/pdf')
    expect(await b.text()).toBe('%PDF-1')
    expect(withItemType(new Blob(['x']), 'image/svg+xml').type).toBe('image/svg+xml')
  })

  it('서버가 구체적인 형식을 줬거나 항목 형식도 모르면 그대로 둔다', () => {
    const png = new Blob(['x'], { type: 'image/png' })
    expect(withItemType(png, 'application/pdf')).toBe(png)
    const raw = new Blob(['x'], { type: 'application/octet-stream' })
    expect(withItemType(raw, 'application/octet-stream')).toBe(raw)
  })
})
