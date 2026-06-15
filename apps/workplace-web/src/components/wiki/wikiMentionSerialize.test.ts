import { describe, expect, it } from 'vitest'

import { parseWikiSegments, tokenFor } from './wikiMentionSerialize'

describe('tokenFor', () => {
  it('타입별 토큰 형식을 만든다', () => {
    expect(tokenFor('USER', 9)).toBe('<@9>')
    expect(tokenFor('PAGE', 1)).toBe('<#page:1>')
    expect(tokenFor('ISSUE', 5)).toBe('<#issue:5>')
  })
})

describe('parseWikiSegments', () => {
  it('빈 문자열은 빈 세그먼트', () => {
    expect(parseWikiSegments('')).toEqual([])
  })

  it('토큰 없는 순수 텍스트는 단일 text 세그먼트', () => {
    expect(parseWikiSegments('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('단일 유저 토큰을 mention 세그먼트로 분해', () => {
    expect(parseWikiSegments('<@9>')).toEqual([
      { type: 'mention', mtype: 'USER', id: 9 },
    ])
  })

  it('page/issue 토큰을 PAGE/ISSUE 로 매핑', () => {
    expect(parseWikiSegments('<#page:1><#issue:5>')).toEqual([
      { type: 'mention', mtype: 'PAGE', id: 1 },
      { type: 'mention', mtype: 'ISSUE', id: 5 },
    ])
  })

  it('혼합 토큰 + 텍스트를 순서대로 분해하고 텍스트를 보존', () => {
    expect(parseWikiSegments('안녕 <@9> 님 <#page:1> 참고 <#issue:5> 끝')).toEqual([
      { type: 'text', value: '안녕 ' },
      { type: 'mention', mtype: 'USER', id: 9 },
      { type: 'text', value: ' 님 ' },
      { type: 'mention', mtype: 'PAGE', id: 1 },
      { type: 'text', value: ' 참고 ' },
      { type: 'mention', mtype: 'ISSUE', id: 5 },
      { type: 'text', value: ' 끝' },
    ])
  })

  it('인접 토큰 사이에 빈 text 세그먼트를 만들지 않는다', () => {
    expect(parseWikiSegments('<@1><@2>')).toEqual([
      { type: 'mention', mtype: 'USER', id: 1 },
      { type: 'mention', mtype: 'USER', id: 2 },
    ])
  })

  it('라운드트립: segments → tokens → segments 가 동일', () => {
    const body = '안녕 <@9> 와 <#page:3> 그리고 <#issue:7> 끝'
    const segs = parseWikiSegments(body)
    const rebuilt = segs
      .map((s) => (s.type === 'text' ? s.value : tokenFor(s.mtype, s.id)))
      .join('')
    expect(rebuilt).toBe(body)
    expect(parseWikiSegments(rebuilt)).toEqual(segs)
  })
})
