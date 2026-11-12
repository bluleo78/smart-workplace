// 답 표식 해석(순수 함수) 단위 테스트.
import { describe, expect, it } from 'vitest'

import { EVIDENCE_LANG, helpAnswerUrlTransform, parseHelpAnswer } from './helpAnswer'

// 바닥줄 분리 — 한 번 파싱 결과의 body·footer 만 본다.
const splitHelpAnswerFooter = (md: string) => {
  const { body, footer } = parseHelpAnswer(md)
  return { body, footer }
}
const firstFigureId = (md: string) => parseHelpAnswer(md).figureId
const firstSourceId = (md: string) => parseHelpAnswer(md).sourceId

describe('splitHelpAnswerFooter', () => {
  it('끝 문단의 출처·보강 표식을 바닥줄로 뗀다', () => {
    expect(
      splitHelpAnswerFooter('답입니다.\n\n[도움말 · 알림 설정](help:notifications) [매뉴얼 보강](manual-gap:)'),
    ).toEqual({
      body: '답입니다.',
      footer: { source: { id: 'notifications', label: '도움말 · 알림 설정' }, gap: true },
    })
  })

  it('출처만 있어도 뗀다', () => {
    expect(splitHelpAnswerFooter('답.\n\n[도움말 · A](help:a)\n').footer).toEqual({
      source: { id: 'a', label: '도움말 · A' },
      gap: false,
    })
  })

  it('본문 중간의 출처 링크는 떼지 않는다', () => {
    const md = '[도움말 · A](help:a) 를 보세요.\n\n마무리 문장입니다.'
    expect(splitHelpAnswerFooter(md)).toEqual({ body: md, footer: null })
  })

  it('끝 문단에 다른 글이 섞이면 떼지 않는다', () => {
    const md = '답.\n\n자세한 건 [도움말 · A](help:a) 참고'
    expect(splitHelpAnswerFooter(md)).toEqual({ body: md, footer: null })
  })

  it('코드 펜스 안 표식은 무시한다', () => {
    const md = '답.\n\n```\n[도움말 · A](help:a)\n```'
    expect(splitHelpAnswerFooter(md)).toEqual({ body: md, footer: null })
    expect(firstSourceId(md)).toBeNull()
    expect(firstFigureId('```\n![a](figure:x)\n```')).toBeNull()
  })

  it('빈 문서는 그대로 돌려준다', () => {
    expect(splitHelpAnswerFooter('')).toEqual({ body: '', footer: null })
  })
})

describe('helpAnswerUrlTransform', () => {
  it('javascript: 는 지우고 dialog: 는 남긴다', () => {
    expect(helpAnswerUrlTransform('javascript:alert(1)')).toBe('')
    expect(helpAnswerUrlTransform('dialog:agent.run.account')).toBe('dialog:agent.run.account')
  })

  it('네 스킴은 통과하고 일반 https 는 기본 변환을 따른다', () => {
    expect(helpAnswerUrlTransform('help:a')).toBe('help:a')
    expect(helpAnswerUrlTransform('figure:a')).toBe('figure:a')
    expect(helpAnswerUrlTransform('manual-gap:')).toBe('manual-gap:')
    expect(helpAnswerUrlTransform('https://example.com')).toBe('https://example.com')
  })

  it('대소문자·앞 공백이 달라도 위험한 스킴은 지운다', () => {
    expect(helpAnswerUrlTransform('JAVASCRIPT:alert(1)')).toBe('')
    expect(helpAnswerUrlTransform(' javascript:x')).toBe('')
    expect(helpAnswerUrlTransform('JavaScript:alert(1)')).toBe('')
  })

  it('표식 스킴은 정확히 소문자일 때만 통과한다(나머지는 렌더러도 못 알아보도록 지운다)', () => {
    expect(helpAnswerUrlTransform('DIALOG:agent.run.account')).toBe('')
    expect(helpAnswerUrlTransform('Help:a')).toBe('')
    expect(helpAnswerUrlTransform('FIGURE:a')).toBe('')
    expect(helpAnswerUrlTransform(' dialog:agent.run.account')).toBe('')
  })
})

describe('첫 id 찾기', () => {
  it('그림은 첫 id 만', () => {
    expect(firstFigureId('![a](figure:x) ![b](figure:y)')).toBe('x')
  })
  it('출처는 첫 id 만', () => {
    expect(firstSourceId('[a](help:p) [b](help:q)')).toBe('p')
  })
  it('evidence 언어 상수', () => {
    expect(EVIDENCE_LANG).toBe('evidence')
  })
})

describe('parseHelpAnswer(한 번 파싱)', () => {
  const sample = '![그림](figure:x) 본문 [도움말 · 첫째](help:p)\n\n```\n[코드](help:code)\n```\n\n[도움말 · 끝](help:q) [매뉴얼 보강](manual-gap:)'

  it('바닥줄·첫 그림·첫 출처를 한 번에 구한다', () => {
    const one = parseHelpAnswer(sample)
    expect(one.body).toBe('![그림](figure:x) 본문 [도움말 · 첫째](help:p)\n\n```\n[코드](help:code)\n```')
    expect(one.footer?.source).toEqual({ id: 'q', label: '도움말 · 끝' })
    expect(one.figureId).toBe('x')
    expect(one.sourceId).toBe('p')
    expect(one.footer?.gap).toBe(true)
  })

  it('표식이 없으면 본문 그대로, id 는 null', () => {
    expect(parseHelpAnswer('그냥 답')).toEqual({ body: '그냥 답', footer: null, figureId: null, sourceId: null })
  })
})
