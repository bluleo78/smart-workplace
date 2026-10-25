import { describe, expect, it } from 'vitest'

import {
  parseAddressList,
  parseRecipientInput,
  recipientAddressLabel,
  recipientShortName,
  replyAllCc,
  summarizeRecipients,
} from './mailRecipients'

describe('parseAddressList', () => {
  it('이름 있는 주소·주소만·따옴표 안 쉼표를 사람 단위로 나눈다', () => {
    expect(parseAddressList('홍길동 <hong@example.com>, "김, 철수" <kim@example.com>; ops@example.com')).toEqual([
      { name: '홍길동', address: 'hong@example.com' },
      { name: '김, 철수', address: 'kim@example.com' },
      { name: null, address: 'ops@example.com' },
    ])
  })

  it('닫히지 않은 꺾쇠 뒤의 구분자도 나눈다 — 여러 주소가 한 수신인으로 묶이지 않게 (WP-945)', () => {
    expect(parseAddressList('Kim <kim@x.com, lee@y.com').map((r) => r.address)).toEqual(['Kim <kim@x.com', 'lee@y.com'])
  })
  it('빈 값·빈 토큰은 버린다', () => {
    expect(parseAddressList(null)).toEqual([])
    expect(parseAddressList(' , a@b.c ,')).toEqual([{ name: null, address: 'a@b.c' }])
  })
})

describe('summarizeRecipients', () => {
  const to = parseAddressList('홍길동 <hong@example.com>, a@example.com, b@example.com')
  const cc = parseAddressList('c@example.com, d@example.com')

  it('받는사람은 첫 사람 이름 + 외 N명, 참조는 인원수', () => {
    expect(summarizeRecipients(to, cc, [])).toBe('받는사람 홍길동 외 2명 · 참조 2명')
  })

  it('이름이 없으면 주소 로컬파트, 한 명이면 "외" 없이', () => {
    expect(recipientShortName({ name: null, address: 'devops-team@example.com' })).toBe('devops-team')
    expect(summarizeRecipients(parseAddressList('qa@example.com'), [], cc)).toBe('받는사람 qa · 숨은참조 2명')
  })

  it('아무도 없으면 빈 문자열', () => {
    expect(summarizeRecipients([], [], [])).toBe('')
  })
})

describe('replyAllCc', () => {
  it('따옴표 안 쉼표가 든 수신자를 한 사람으로 두고, 나·보낸 사람·중복을 뺀다', () => {
    const to = '"김, 철수" <kim@example.com>, 나 <Me@example.com>'
    const cc = '홍길동 <hong@example.com>; sender@example.com; KIM@example.com'
    // 이름에 쉼표가 있으면 따옴표로 감싸 작성창 입력으로 다시 나눠도 한 사람으로 남는다.
    expect(replyAllCc(to, cc, 'me@example.com', 'sender@example.com')).toEqual([
      '"김, 철수" <kim@example.com>',
      '홍길동 <hong@example.com>',
    ])
  })

  it('받는사람·참조가 없으면 빈 목록', () => {
    expect(replyAllCc(null, null, 'me@example.com')).toEqual([])
  })
})

describe('recipientAddressLabel', () => {
  it('이름이 없으면 주소만, 구분자·따옴표·꺾쇠가 든 이름만 따옴표로 감싼다', () => {
    expect(recipientAddressLabel({ name: null, address: 'a@b.c' })).toBe('a@b.c')
    expect(recipientAddressLabel({ name: '홍길동', address: 'hong@x.com' })).toBe('홍길동 <hong@x.com>')
    expect(recipientAddressLabel({ name: '김, 철수', address: 'kim@x.com' })).toBe('"김, 철수" <kim@x.com>')
    expect(recipientAddressLabel({ name: 'A "B" C', address: 'abc@x.com' })).toBe('"A B C" <abc@x.com>')
  })
})

describe('parseRecipientInput', () => {
  it('쉼표·세미콜론으로 나누던 동작은 그대로, 따옴표 안 쉼표만 지킨다', () => {
    expect(parseRecipientInput('a@x.com, b@x.com; c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
    expect(parseRecipientInput(' , a@x.com ,, ')).toEqual(['a@x.com'])
    expect(parseRecipientInput('"김, 철수" <kim@x.com>, 홍길동 <hong@x.com>')).toEqual([
      '"김, 철수" <kim@x.com>',
      '홍길동 <hong@x.com>',
    ])
  })

  it('전체답장 참조를 입력칸에 이어 붙였다가 다시 나눠도 같은 사람들이다(왕복)', () => {
    const cc = replyAllCc('"김, 철수" <kim@x.com>, 이영희 <lee@x.com>', null)
    expect(parseRecipientInput(cc.join(', '))).toEqual(cc)
  })
})
