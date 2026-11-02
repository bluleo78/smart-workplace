import type { RefObject } from 'react'

import { acceptHtmlFile } from './wikiHtmlImportInsert'

/** HTML 파일 선택기 accept — 확장자와 MIME 둘 다(운영체제마다 .htm 의 MIME 이 비어 있기도 하다). */
export const HTML_FILE_ACCEPT = '.html,.htm,text/html'

/**
 * 숨은 HTML 파일 input(WP-1241) — 슬래시 「HTML 파일 넣기」와 사이드바 「HTML 파일로 새 노트」가 같은 선택기를 쓴다.
 * 여는 쪽은 inputRef.current.click() 을 부른다(메뉴 선택이 곧 사용자 동작이라 파일 대화상자가 열린다).
 * 같은 파일을 연달아 골라도 onChange 가 다시 불리도록 고른 직후 값을 비운다(이미지 input 과 같다).
 * 종류·크기 상한(5MB) 검사도 읽기 전에 acceptHtmlFile 한 규칙으로 한다 — 선택기로 고르는 길은 모두 이 input 을 지나고,
 * 끌어다 놓기(HTML 블록 「다시 올리기」)도 같은 함수를 부른다.
 */
export function WikiHtmlFileInput({
  inputRef,
  testId,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  testId: string
  onFile: (file: File) => void
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={HTML_FILE_ACCEPT}
      className="hidden"
      data-testid={testId}
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file && acceptHtmlFile(file)) onFile(file)
      }}
    />
  )
}
