// 「HTML 문서」 도우미(WP-1307) — 종류 판정·<title> 읽기·바이트 크기·내려받기 파일 이름.
import { describe, expect, it, test } from 'vitest'

import {
  deriveHtmlLock,
  htmlByteLength,
  htmlDocumentTitle,
  htmlDocumentTitleForFile,
  htmlDownloadFileName,
  htmlLockBannerText,
  isHtmlPage,
  sameInstant,
  UNLOCKED_HTML_LOCK,
} from './wikiHtmlDocument'

test('kind 가 HTML 일 때만 HTML 문서다 — 없으면(구버전 서버) 노트', () => {
  expect(isHtmlPage({ kind: 'HTML' })).toBe(true)
  expect(isHtmlPage({ kind: 'NOTE' })).toBe(false)
  expect(isHtmlPage({})).toBe(false)
  expect(isHtmlPage(null)).toBe(false)
})

test('<title> 을 공백 정리·엔티티 풀어 읽고, 없거나 비면 null', () => {
  expect(htmlDocumentTitle('<html><head><title>\n  매출 &amp; 비용 </title></head></html>')).toBe('매출 & 비용')
  expect(htmlDocumentTitle('<title>  </title>')).toBeNull()
  expect(htmlDocumentTitle('<p>제목 없음</p>')).toBeNull()
})

test('파일 제목은 <title>, 없으면 확장자를 뺀 파일 이름', () => {
  expect(htmlDocumentTitleForFile('<title>보고서</title>', 'a.html')).toBe('보고서')
  expect(htmlDocumentTitleForFile('<p>x</p>', '차트.htm')).toBe('차트')
})

test('크기는 UTF-8 바이트로 잰다 — 한글 한 글자는 3바이트', () => {
  expect(htmlByteLength('가')).toBe(3)
  expect(htmlByteLength('a')).toBe(1)
})

test('내려받기 파일 이름은 못 쓰는 글자를 바꾸고 .html 을 붙인다', () => {
  expect(htmlDownloadFileName('1/2 보고서: 초안?')).toBe('1_2 보고서_ 초안_.html')
  expect(htmlDownloadFileName('  ')).toBe('제목 없음.html')
})

// 편집 잠금(WP-1308) — SSE 가 넣은 캐시(쥔 사람만)에서도 서버와 같은 규칙으로 mine·강제 풀기를 가린다.
describe('deriveHtmlLock', () => {
  const held = { ...UNLOCKED_HTML_LOCK, locked: true, holderId: 2, holderName: '김민지' }
  it('쥔 사람이 나면 mine, 강제 풀기는 없다', () => {
    expect(deriveHtmlLock(held, 2, 'OWNER')).toMatchObject({ mine: true, canForceRelease: false })
  })
  it('남의 잠금은 스페이스 소유자만 강제로 풀 수 있다', () => {
    expect(deriveHtmlLock(held, 1, 'OWNER')).toMatchObject({ mine: false, canForceRelease: true })
    expect(deriveHtmlLock(held, 1, 'EDITOR')).toMatchObject({ mine: false, canForceRelease: false })
  })
  it('풀린 잠금은 그대로다', () => {
    expect(deriveHtmlLock(UNLOCKED_HTML_LOCK, 1, 'OWNER')).toBe(UNLOCKED_HTML_LOCK)
  })
  it('같은 시각이면 직렬화 모양이 달라도 같은 순간이다', () => {
    expect(sameInstant('2026-11-02T09:00:00Z', '2026-11-02T09:00:00.000000Z')).toBe(true)
    expect(sameInstant('2026-11-02T09:00:00Z', '2026-11-02T09:05:00Z')).toBe(false)
    expect(sameInstant(null, null)).toBe(false)
  })
  it('쥔 사람 이름을 모르면 「다른 사람」이다', () => {
    expect(htmlLockBannerText({ holderName: null })).toBe('다른 사람 님이 편집 중입니다 — 저장될 때까지 보기만 할 수 있어요')
  })
})
