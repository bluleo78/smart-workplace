import { describe, expect, it } from 'vitest'

import { mimeToCategory } from './fileCategory'

describe('mimeToCategory', () => {
  it('image/* → IMAGE', () => expect(mimeToCategory('image/png')).toBe('IMAGE'))
  it('application/pdf → PDF', () => expect(mimeToCategory('application/pdf')).toBe('PDF'))
  it('text/* → TEXT', () => expect(mimeToCategory('text/plain')).toBe('TEXT'))
  it('그 외 → OTHER', () => expect(mimeToCategory('application/zip')).toBe('OTHER'))
})
