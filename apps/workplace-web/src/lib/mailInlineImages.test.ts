// 인라인 이미지(cid:) 해석 순수 함수 테스트(WP-65).
import { describe, expect, it } from 'vitest'

import type { EmailAttachmentMeta } from '../types/mailMessage'
import {
  decodeCid,
  extractCidRefs,
  findCidAttachment,
  normalizeCid,
  replaceCidRefs,
  resolveCidTargets,
} from './mailInlineImages'

const att = (o: Partial<EmailAttachmentMeta>): EmailAttachmentMeta => ({
  id: 1,
  filename: null,
  contentType: 'image/png',
  sizeBytes: 10,
  contentId: null,
  ...o,
})

describe('normalizeCid', () => {
  it('꺾쇠 제거·URL 디코딩·소문자화', () => {
    expect(normalizeCid('<Image001.PNG@01D>')).toBe('image001.png@01d')
    expect(normalizeCid('a%40b')).toBe('a@b')
    expect(normalizeCid('%E0%A4%A')).toBe('%e0%a4%a')
  })
})

describe('decodeCid', () => {
  it('꺾쇠 제거·URL 디코딩, 대소문자는 보존(발송 Content-ID 용)', () => {
    expect(decodeCid('<Image001.PNG%4001D>')).toBe('Image001.PNG@01D')
  })
})

describe('resolveCidTargets', () => {
  it('본문 cid 중 첨부와 매칭된 것만 돌려준다 (WP-70 첨부 목록 숨김 기준)', () => {
    const list = [att({ id: 1, filename: 'logo.png' }), att({ id: 2, filename: 'a.pdf', contentType: 'application/pdf' })]
    const html = '<img src="cid:logo.png"><img src="cid:none.png">'
    expect(resolveCidTargets(html, list).map((t) => [t.cid, t.att.id])).toEqual([['logo.png', 1]])
  })
})

describe('extractCidRefs', () => {
  it('큰따옴표·작은따옴표·따옴표 없는 src 모두 수집, http src 는 무시', () => {
    const html =
      '<img src="cid:a.png"><img SRC=\'cid:B.png\'><img src=cid:c.png alt=x><img src="https://x/y.png">'
    expect([...extractCidRefs(html)]).toEqual(['a.png', 'b.png', 'c.png'])
  })
  it('따옴표 없는 self-closing 의 / 는 cid 에 포함하지 않고, data-src 는 무시', () => {
    expect([...extractCidRefs('<img src=cid:d.png/><img data-src="cid:e.png">')]).toEqual(['d.png'])
  })
})

describe('findCidAttachment', () => {
  it('contentId 일치를 파일명보다 우선', () => {
    const list = [att({ id: 1, filename: 'x.png' }), att({ id: 2, filename: 'y.png', contentId: '<x.png>' })]
    expect(findCidAttachment('x.png', list)?.id).toBe(2)
  })
  it('contentId 가 없으면(Graph) 파일명 일치로 매칭', () => {
    const list = [att({ id: 7, filename: '7dc8b642.png' })]
    expect(findCidAttachment('7dc8b642.png', list)?.id).toBe(7)
  })
  it('Outlook 형식 cid 는 @ 앞부분을 파일명과 비교', () => {
    const list = [att({ id: 3, filename: 'image001.png' })]
    expect(findCidAttachment('image001.png@01d9a1b2.c3d4e5f0', list)?.id).toBe(3)
  })
  it('이미지가 아니거나 5MB 초과 첨부는 제외', () => {
    const list = [
      att({ id: 1, filename: 'a.pdf', contentType: 'application/pdf' }),
      att({ id: 2, filename: 'big.png', sizeBytes: 6 * 1024 * 1024 }),
    ]
    expect(findCidAttachment('a.pdf', list)).toBeUndefined()
    expect(findCidAttachment('big.png', list)).toBeUndefined()
  })
  it('매칭 없으면 undefined', () => {
    expect(findCidAttachment('none.png', [att({ filename: 'a.png' })])).toBeUndefined()
  })
})

describe('replaceCidRefs', () => {
  it('맵에 있는 참조만 치환하고 나머지는 보존', () => {
    const html = '<img src="cid:A.png" width="10"><img src=\'cid:b.png\'>'
    const out = replaceCidRefs(html, new Map([['a.png', 'data:image/png;base64,AAA']]))
    expect(out).toBe('<img src="data:image/png;base64,AAA" width="10"><img src=\'cid:b.png\'>')
  })
})
