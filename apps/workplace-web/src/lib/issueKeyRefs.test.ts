// 본문 이슈 키 나누기(WP-1237) — 어떤 글자를 이슈 키로 보는지(경계·문장부호·대소문자).
import { describe, expect, it } from 'vitest'

import { mayContainIssueKey, renderIssueKeys, splitIssueKeys } from './issueKeyRefs'

/** 찾은 키만 「KEY-n」으로. */
const keysOf = (text: string) =>
  (splitIssueKeys(text) ?? [])
    .filter((s) => s.type === 'issue')
    .map((s) => (s.type === 'issue' ? `${s.projectKey}-${s.number}` : ''))

describe('splitIssueKeys', () => {
  it('키 앞뒤 글자를 그대로 남기고 키를 조각으로 나눈다', () => {
    expect(splitIssueKeys('WP-1201 확인해 주세요')).toEqual([
      { type: 'issue', text: 'WP-1201', projectKey: 'WP', number: 1201 },
      { type: 'text', text: ' 확인해 주세요' },
    ])
  })

  it('키가 없으면 null', () => {
    expect(splitIssueKeys('그냥 글')).toBeNull()
    expect(mayContainIssueKey('그냥 글')).toBe(false)
  })

  it.each([
    ['괄호', '(WP-12)', ['WP-12']],
    ['마침표', 'WP-12.', ['WP-12']],
    ['쉼표·여러 개', 'WP-1, WP-2와 AB2-30', ['WP-1', 'WP-2', 'AB2-30']],
    ['조사', 'WP-12에서 봤어요', ['WP-12']],
    ['앞에 한글', '이슈WP-12', ['WP-12']],
    ['물음표·느낌표', 'WP-12? WP-13!', ['WP-12', 'WP-13']],
    ['따옴표·대괄호', '"WP-12" [WP-13]', ['WP-12', 'WP-13']],
    ['줄바꿈', '위\nWP-12\n아래', ['WP-12']],
    ['서식 기호', '*WP-12* ~WP-13~', ['WP-12', 'WP-13']],
    ['슬래시로 이어 씀', 'WP-12/WP-13', ['WP-12', 'WP-13']],
    ['마침표로 이어 씀', 'WP-12.WP-13', ['WP-12', 'WP-13']],
    ['앞 문장 마침표', '완료.WP-12', ['WP-12']],
    ['앞 숫자 마침표', '1.WP-12', ['WP-12']],
    // 맨 글자 경로 — URL·코드 조각이 아니면 링크가 된다(받아들인 동작). URL 은 렌더러가 먼저 뺀다.
    ['경로처럼 쓴 글자', 'src/WP-12', ['WP-12']],
  ])('경계: %s', (_n, text, keys) => {
    expect(keysOf(text)).toEqual(keys)
  })

  it.each([
    ['소문자', 'wp-12'],
    ['첫 글자만 대문자', 'Wp-12'],
    ['긴 낱말의 끝', 'XXWPXXXXXXX-12'],
    ['앞에 영문', 'aWP-12'],
    ['뒤에 영문', 'WP-12a'],
    ['하이픈 이어짐', 'WP-12-3'],
    ['0 시작 번호', 'WP-012 WP-0'],
    ['한 글자 키', 'W-12'],
    ['메일', 'me@WP-12.com'],
    ['버전', 'WP-12.5'],
    ['10자리 번호', 'WP-1234567890'],
  ])('키가 아니다: %s', (_n, text) => {
    expect(keysOf(text)).toEqual([])
  })

  it('번호는 9자리까지', () => {
    expect(keysOf('WP-123456789')).toEqual(['WP-123456789'])
  })

  it('mayContainIssueKey 는 서식 기호·이스케이프가 섞인 마크다운 원문도 놓치지 않는다(느슨한 후보)', () => {
    expect(mayContainIssueKey('_WP-12_')).toBe(true)
    expect(mayContainIssueKey('__WP-12__')).toBe(true)
    expect(mayContainIssueKey('WP\\-12')).toBe(true)
    expect(mayContainIssueKey('WP-1')).toBe(true)
  })
})

describe('renderIssueKeys', () => {
  const render = (seg: { projectKey: string; number: number }) => `<${seg.projectKey}#${seg.number}>`

  it('여러 번 불러도 첫 키를 놓치지 않는다', () => {
    expect(renderIssueKeys('WP-12 와 WP-34', render, 'k')).toEqual(['<WP#12>', ' 와 ', '<WP#34>'])
    expect(renderIssueKeys('WP-12 와 WP-34', render, 'k')).toEqual(['<WP#12>', ' 와 ', '<WP#34>'])
  })

  it('키가 없으면 글자 하나 그대로', () => {
    expect(renderIssueKeys('평문', render, 'k')).toEqual(['평문'])
    expect(renderIssueKeys('', render, 'k')).toEqual([''])
  })
})
