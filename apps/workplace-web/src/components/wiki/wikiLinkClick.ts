// 노트 본문 링크 클릭 판정(WP-300) — 편집 모드에서 Ctrl/⌘+클릭한 링크의 열 주소를 고른다. DOM 이벤트 비의존 순수 로직.
//
// 왜 편집 모드만: contenteditable 안의 <a> 는 브라우저가 클릭으로 따라가지 않는다. 그렇다고 그냥 클릭마다 열면
// 링크 글자를 고치려고 누를 때마다 새 탭이 뜬다(공용 스키마가 tiptap 기본 openOnClick 을 끈 이유) — 그래서 수정키 클릭만 연다.
// 보기 전용(편집 불가)은 렌더된 <a target=_blank rel=noopener> 를 브라우저가 그대로 열므로 여기서 손대지 않는다.
import { openableHref } from './wikiLinkUrl'

/** 클릭 대상 요소에서 열 링크 주소 — 열 대상이 아니면 null. */
export function wikiLinkHrefToOpen(
  target: Element | null,
  opts: { editable: boolean; modKey: boolean },
): string | null {
  if (!opts.editable || !opts.modKey || !target) return null
  // 속성값을 직접 읽는다 — a.href 는 href="" (렌더 시 막힌 위험 주소)를 현재 페이지 주소로 풀어 버린다.
  return openableHref(target.closest('a')?.getAttribute('href'))
}
