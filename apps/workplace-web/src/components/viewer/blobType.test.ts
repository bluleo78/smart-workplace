import { describe, expect, it } from 'vitest'

import { withItemType } from './blobType'

describe('withItemType', () => {
  it('octet-stream·빈 형식 blob 은 항목 형식으로 다시 감싼다(내용은 그대로)', async () => {
    const b = withItemType(new Blob(['%PDF-1'], { type: 'application/octet-stream' }), 'application/pdf')
    expect(b.type).toBe('application/pdf')
    expect(await b.text()).toBe('%PDF-1')
    expect(withItemType(new Blob(['x']), 'image/png').type).toBe('image/png')
  })

  it('파라미터가 붙은 범용 형식도 범용으로 본다', () => {
    const b = new Blob(['x'], { type: 'application/octet-stream; name="logo.png"' })
    expect(withItemType(b, 'image/png').type).toBe('image/png')
  })

  it('SVG 로는 올리지 않는다(보안)', () => {
    const raw = new Blob(['<svg/>'], { type: 'application/octet-stream' })
    expect(withItemType(raw, 'image/svg+xml')).toBe(raw)
    expect(withItemType(raw, 'Image/SVG+XML; charset=utf-8')).toBe(raw)
  })

  it('서버가 구체적인 형식을 줬거나 항목 형식도 모르면 그대로 둔다', () => {
    const png = new Blob(['x'], { type: 'image/png' })
    expect(withItemType(png, 'application/pdf')).toBe(png)
    const raw = new Blob(['x'], { type: 'application/octet-stream' })
    expect(withItemType(raw, 'application/octet-stream')).toBe(raw)
  })
})
