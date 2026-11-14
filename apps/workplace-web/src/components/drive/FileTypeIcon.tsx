// 파일 mime → 유형 아이콘(이미지/표/문서/영상/오디오/압축/기타). 이슈 첨부 칩과 이슈 드라이브 링크 행이 함께 쓴다.
// 왜: 같은 이슈 화면에서 같은 파일 유형이 행마다 다른 아이콘으로 보이지 않게 한 곳에서 정한다(WP-203). 판정은 fileTypeIconOf.

import { createElement } from 'react'

import { cn } from '../../lib/utils'
import { fileTypeIconOf } from './fileTypeIconOf'

/** className 으로 기본 크기·색(h-4 · muted)을 덮어쓸 수 있다 — 미리보기 헤더처럼 더 크게 쓰는 곳용(WP-274). */
export function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  // 판정 결과(모듈 수준 아이콘 컴포넌트)를 createElement 로 그린다 — 렌더 중 지역 변수 컴포넌트로 두면 정적 컴포넌트 lint 가 막는다.
  return createElement(fileTypeIconOf(mimeType), { className: cn('h-4 w-4 shrink-0 text-muted-foreground', className), 'aria-hidden': true })
}
