import { describe, expect, it } from 'vitest'

import { stripLeadingTitleHeading } from './wikiAiTitleHeading'

// AI 결과의 제목 H1 반복 제거(WP-255) — 제목과 같은 첫 H1 만 걷어내고 나머지는 보존한다.
describe('stripLeadingTitleHeading', () => {
  it('첫 줄이 페이지 제목과 같은 H1 이면 그 줄과 뒤 빈 줄을 제거한다', () => {
    expect(stripLeadingTitleHeading('# 회의록\n\n## 개요\n본문', '회의록')).toBe('## 개요\n본문')
  })

  it('앞의 빈 줄·공백 차이·닫는 # 은 무시하고 판정한다', () => {
    expect(stripLeadingTitleHeading('\n\n#   주간  회고 ##\n본문', ' 주간 회고 ')).toBe('본문')
  })

  it('굵게로 감싼 제목 H1 도 같은 제목으로 본다', () => {
    expect(stripLeadingTitleHeading('# **회의록**\n본문', '회의록')).toBe('본문')
  })

  it('제목과 다른 H1 은 그대로 둔다', () => {
    const md = '# 다른 제목\n본문'
    expect(stripLeadingTitleHeading(md, '회의록')).toBe(md)
  })

  it('H2 이상은 제목과 같아도 그대로 둔다', () => {
    const md = '## 회의록\n본문'
    expect(stripLeadingTitleHeading(md, '회의록')).toBe(md)
  })

  it('첫 줄이 아닌 위치의 같은 제목 H1 은 그대로 둔다', () => {
    const md = '소개 문단\n\n# 회의록'
    expect(stripLeadingTitleHeading(md, '회의록')).toBe(md)
  })

  it('페이지 제목이 비어 있으면 아무것도 제거하지 않는다', () => {
    const md = '# \n본문'
    expect(stripLeadingTitleHeading(md, '  ')).toBe(md)
  })

  it('결과가 제목 H1 하나뿐이면 빈 문자열이 된다', () => {
    expect(stripLeadingTitleHeading('# 회의록\n\n', '회의록')).toBe('')
  })
})
