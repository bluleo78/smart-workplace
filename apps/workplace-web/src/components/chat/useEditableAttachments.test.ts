// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { MessageAttachment } from '@/types/messaging'

import { keepFileIdsForEdit } from './useEditableAttachments'

// WP-1680: 저장 요청에 keepFileIds 를 싣는 규칙 — 채널(WP-1679)·이슈 챗 공용.
const att = (fileId: number) =>
  ({ fileId, originalName: `f${fileId}.pdf`, mimeType: 'application/pdf', sizeBytes: 1 }) as unknown as MessageAttachment

describe('keepFileIdsForEdit', () => {
  it('파일을 뺐으면 남길 id 를 싣는다', () => {
    expect(keepFileIdsForEdit({ kept: [att(1)], removedAny: true, body: 'x' })).toEqual([1])
  })
  it('빼지 않고 본문만 고치면 undefined', () => {
    expect(keepFileIdsForEdit({ kept: [att(1), att(2)], removedAny: false, body: 'x' })).toBeUndefined()
  })
  it('보이는 글자가 없으면 빈 배열이라도 싣는다', () => {
    expect(keepFileIdsForEdit({ kept: [], removedAny: false, body: '​ ' })).toEqual([])
  })
  it('본문이 비고 첨부가 남아 있으면 그 id 를 싣는다', () => {
    expect(keepFileIdsForEdit({ kept: [att(1)], removedAny: false, body: '' })).toEqual([1])
  })
})
