// 이슈 첨부 업로드 순수 판정(WP-2118).
import { describe, expect, it } from 'vitest'

import { attachmentLimitLabel, blockedUploadMessage, remainingHint, splitByRemaining, uploadResultMessage } from './issueAttachmentUpload'

const files = (n: number) => Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.txt`))

describe('splitByRemaining', () => {
  it('17개 + 5개 → 앞 3개 받고 뒤 2개 제외', () => {
    const r = splitByRemaining(files(5), 17, 20)
    expect(r.accepted.map((f) => f.name)).toEqual(['f0.txt', 'f1.txt', 'f2.txt'])
    expect(r.excluded.map((f) => f.name)).toEqual(['f3.txt', 'f4.txt'])
  })
  it('남은 자리가 충분하면 모두 받고, 이미 가득이면 모두 제외', () => {
    expect(splitByRemaining(files(2), 5, 20).excluded).toHaveLength(0)
    expect(splitByRemaining(files(2), 20, 20).accepted).toHaveLength(0)
  })
})

describe('uploadResultMessage', () => {
  it('넘침이 있으면 제목·설명', () => {
    expect(uploadResultMessage(3, ['db-slow.log', 'network.har'], 20)).toEqual({
      level: 'warning',
      title: '첨부 3개 · 제외 2개 — 이슈당 최대 20개',
      description: '제외: db-slow.log, network.har',
    })
  })
  it('넘침이 없으면 제목만', () => {
    expect(uploadResultMessage(4, [], 20)).toEqual({ level: 'success', title: '4개 첨부를 추가했습니다' })
  })
  it('하나도 못 붙었으면 error 레벨', () => {
    expect(uploadResultMessage(0, ['a.txt'], 20).level).toBe('error')
  })
})

describe('remainingHint', () => {
  it('남은 자리 1~5 에서만 보인다', () => {
    expect(remainingHint(15, 20)).toBe('· 5개 남음')
    expect(remainingHint(19, 20)).toBe('· 1개 남음')
    expect(remainingHint(14, 20)).toBeNull()
    expect(remainingHint(20, 20)).toBeNull()
  })
})

describe('attachmentLimitLabel', () => {
  it('한도 도달 · 남은 1~5 · 그 외', () => {
    expect(attachmentLimitLabel(20, 20)).toBe('한도 도달 · 최대 20개')
    expect(attachmentLimitLabel(17, 20)).toBe('· 3개 남음')
    expect(attachmentLimitLabel(5, 20)).toBeNull()
  })
})

describe('blockedUploadMessage', () => {
  it('업로드 중이면 다시 시도 안내(동작어 반영), 한도 도달이면 한도 문구', () => {
    expect(blockedUploadMessage('uploading', 20)).toBe('업로드 중입니다. 끝난 뒤 다시 드롭해 주세요')
    expect(blockedUploadMessage('uploading', 20, '선택')).toBe('업로드 중입니다. 끝난 뒤 다시 선택해 주세요')
    expect(blockedUploadMessage('limit', 20)).toBe('한도 도달 · 최대 20개')
  })
})
