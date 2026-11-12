// @vitest-environment jsdom
// 포커스한 칸의 이름·비밀값 판정(helpFieldInfo) — 비밀값 칸은 값이 결과 객체에 키째 없어야 한다(WP-1511).
import { afterEach, describe, expect, it } from 'vitest'

import { dialogName, fieldName, isSecretField, readFieldInfo } from './helpFieldInfo'

/** html 을 body 에 붙이고 첫 입력 요소(input·textarea·select·contenteditable)를 돌려준다. */
function mount(html: string): Element {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root.querySelector('input, textarea, select, [contenteditable]')!
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isSecretField', () => {
  it.each([
    ['<input type="password" aria-label="비밀번호">'],
    ['<input autocomplete="one-time-code" aria-label="코드">'],
    ['<input autocomplete="current-password" aria-label="x">'],
    ['<label for="t">토큰</label><input id="t">'],
    ['<input name="apiKey">'],
    ['<input placeholder="Access token">'],
    ['<input aria-label="접속 키">'],
    ['<input aria-label="시크릿">'],
    ['<input aria-label="아무거나" data-ai-secret="true">'],
  ])('%s 는 비밀값', (html) => {
    expect(isSecretField(mount(html))).toBe(true)
  })

  it.each([
    ['<input aria-label="프로젝트 키">'],
    ['<input aria-label="키보드 단축키">'],
    ['<input aria-label="키">'],
    ['<input aria-label="토큰 이름" data-ai-secret="false">'],
    ['<input type="password" data-ai-secret="false" aria-label="x">'],
  ])('%s 는 비밀값 아님', (html) => {
    expect(isSecretField(mount(html))).toBe(false)
  })
})

describe('fieldName', () => {
  it('label 요소 > aria-label > aria-labelledby > placeholder > name 순', () => {
    expect(fieldName(mount('<label for="a">호스트  주소</label><input id="a" aria-label="무시">'))).toBe('호스트 주소')
    expect(fieldName(mount('<input aria-label="별칭">'))).toBe('별칭')
    expect(fieldName(mount('<span id="l">제목   칸</span><input aria-labelledby="l">'))).toBe('제목 칸')
    expect(fieldName(mount('<input placeholder="검색어">'))).toBe('검색어')
    expect(fieldName(mount('<input name="host">'))).toBe('host')
  })
})

describe('readFieldInfo', () => {
  it('비밀값 칸은 value 키가 없다', () => {
    const el = mount('<label for="t">토큰</label><input id="t" value="ghp_abc">')
    expect(readFieldInfo(el)).toEqual({ name: '토큰', secret: true })
    expect('value' in readFieldInfo(el)!).toBe(false)
    expect(JSON.stringify(readFieldInfo(el))).not.toContain('ghp_abc')
  })

  it('일반 칸은 이름과 값', () => {
    expect(readFieldInfo(mount('<input aria-label="호스트" value="github.com">'))).toEqual({ name: '호스트', secret: false, value: 'github.com' })
  })

  it('값은 200자로 자른다', () => {
    const info = readFieldInfo(mount(`<input aria-label="메모" value="${'가'.repeat(300)}">`))
    expect(info?.value?.length).toBe(200)
  })

  it('빈 값이면 value 키를 내지 않는다', () => {
    expect(readFieldInfo(mount('<input aria-label="호스트">'))).toEqual({ name: '호스트', secret: false })
  })

  it('select 는 고른 항목 글', () => {
    const el = mount('<select aria-label="유형"><option value="a">가</option><option value="b" selected>나 항목</option></select>')
    expect(readFieldInfo(el)).toEqual({ name: '유형', secret: false, value: '나 항목' })
  })

  it('checkbox·radio 는 켜짐/꺼짐', () => {
    expect(readFieldInfo(mount('<input type="checkbox" aria-label="사용" checked>'))?.value).toBe('켜짐')
    expect(readFieldInfo(mount('<input type="radio" aria-label="선택">'))?.value).toBe('꺼짐')
  })

  it('textarea 값', () => {
    const el = mount('<textarea aria-label="설명"></textarea>')
    ;(el as HTMLTextAreaElement).value = '내용'
    expect(readFieldInfo(el)).toEqual({ name: '설명', secret: false, value: '내용' })
  })

  it('button 같은 컨트롤은 이름만', () => {
    const root = document.createElement('div')
    root.innerHTML = '<button>폐기</button>'
    document.body.appendChild(root)
    expect(readFieldInfo(root.querySelector('button')!)).toEqual({ name: '폐기', secret: false })
  })

  it('입력 칸도 컨트롤도 아니면 null', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>글</p>'
    document.body.appendChild(root)
    expect(readFieldInfo(root.querySelector('p')!)).toBeNull()
  })

  it('이름이 비면 null', () => {
    expect(readFieldInfo(mount('<input>'))).toBeNull()
  })
})

describe('dialogName', () => {
  it('aria-labelledby 글 또는 aria-label', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div role="dialog" id="d1" aria-labelledby="h"><h2 id="h">토큰  만들기</h2></div><div role="dialog" id="d2" aria-label="확인"></div><div role="dialog" id="d3"></div>'
    document.body.appendChild(root)
    expect(dialogName(root.querySelector('#d1')!)).toBe('토큰 만들기')
    expect(dialogName(root.querySelector('#d2')!)).toBe('확인')
    expect(dialogName(root.querySelector('#d3')!)).toBeNull()
  })
})
