// 본문 편집칸 안 여부 판정(WP-1657) — 이슈 만들기 창(데스크톱 다이얼로그·모바일 시트)의 Esc 처리가 쓴다.
// 왜: 본문 칸은 본문 모드 RichInput(ProseMirror)이라 Esc 를 스스로 처리한다(멘션 팝업이 있으면 팝업만 닫고, 없으면 onCancel).
// 바깥 모달이 그 Esc 로 바로 닫히면 팝업과 창이 함께 닫히므로, 대상이 편집칸 안이면 모달은 닫지 않고(preventDefault) 편집칸에 맡긴다.

/** 이벤트 대상이 ProseMirror 편집칸(.ProseMirror) 안이면 true. 대상이 없거나 요소가 아니면(글자 노드 등은 부모로 본다) 그 밖으로 본다. */
export function isRichBodyTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return el?.closest('.ProseMirror') != null
}
