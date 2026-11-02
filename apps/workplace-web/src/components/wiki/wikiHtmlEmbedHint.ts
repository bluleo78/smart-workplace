// 노트 HTML 블록 선택 안내(WP-1300) — 블록을 통째 선택하면 블록 아래에 보이는 키 안내 문구.

/**
 * 블록 통째 선택 때 보이는 키 안내 — Enter 다음 줄 · Esc 바깥으로 · ⌘Enter(맥)/Ctrl+Enter(그 밖) 바로 나가기.
 * 플랫폼은 부르는 쪽이 넣는다(isMacLike) — 표기와 실제 키(Mod-Enter)가 어긋나지 않게 같은 판정을 쓴다. 순수 함수라 테스트에서 둘 다 본다.
 */
export function htmlEmbedKeyHint(macLike: boolean): string {
  return `Enter 다음 줄 · Esc 바깥으로 · ${macLike ? '⌘Enter' : 'Ctrl+Enter'} 바로 나가기`
}
