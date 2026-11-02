// 「HTML 문서」 도우미(WP-1307) — 종류 판정·<title> 읽기·바이트 크기·내려받기 파일 이름.
import { expect, test } from 'vitest'

import { htmlByteLength, htmlDocumentTitle, htmlDocumentTitleForFile, htmlDownloadFileName, isHtmlPage } from './wikiHtmlDocument'

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
