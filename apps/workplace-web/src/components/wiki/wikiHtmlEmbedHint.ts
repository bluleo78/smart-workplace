// 노트 HTML 블록 선택 안내(WP-1300) — 블록을 통째 선택하면 블록 아래에 보이는 키 안내 문구.

/**
 * 블록 통째 선택 때 보이는 키 안내 — Enter 다음 줄 · Esc 바깥으로 · ⌘Enter(맥)/Ctrl+Enter(그 밖) 바로 나가기.
 * 플랫폼은 부르는 쪽이 넣는다(isMacLike) — 표기와 실제 키(Mod-Enter)가 어긋나지 않게 같은 판정을 쓴다. 순수 함수라 테스트에서 둘 다 본다.
 */
export function htmlEmbedKeyHint(macLike: boolean): string {
  return `Enter 다음 줄 · Esc 바깥으로 · ${macLike ? '⌘Enter' : 'Ctrl+Enter'} 바로 나가기`
}

/**
 * 글자 고치기 안내(WP-1309) — 고칠 글자가 있는 화면과 없는 화면(차트뿐 등). HTML 문서 보이는 화면 편집(WikiHtmlVisualEditor)과
 * HTML 블록 「글자 고치기」(WikiHtmlEmbedView)가 함께 쓴다. 화면 문구라 매뉴얼(10장)도 같은 말을 쓴다.
 */
export const VISUAL_EDIT_HINT = '글자를 눌러 바로 고칩니다 · 차트처럼 스크립트가 그린 부분은 고르기로 골라 AI로 고치세요'
export const VISUAL_EDIT_HINT_NONE = '바로 고칠 수 있는 글자가 없습니다 — 고르기로 골라 AI로 고치세요'
