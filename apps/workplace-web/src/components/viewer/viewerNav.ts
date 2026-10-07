// 뷰어의 넘김·키보드 판정 순수 로직(WP-277). 컴포넌트는 이 결과대로만 움직인다.

/** 묶음 내 위치 → 이전/다음 존재 여부와 카운터 라벨. 순환하지 않는다(업계 관례, 스펙 §2). */
export function navState(index: number, count: number) {
  return {
    hasPrev: index > 0,
    hasNext: index < count - 1,
    label: count > 1 ? `${index + 1} / ${count}` : '',
  }
}

/** 키 판정에 필요한 맥락 — 이벤트 대상 DOM 에서 호출부가 계산해 넘긴다. */
export interface KeyContext {
  key: string
  ctrlOrMeta: boolean
  /** AI 사이드 패널 안(입력창 커서 이동을 뺏지 않는다). */
  inAiPanel: boolean
  /** input·textarea·contenteditable 안. */
  inEditable: boolean
  /** 가로로 더 스크롤할 수 있는 본문(표 등) 안 — 본문이 키를 먼저 쓴다(스펙 §5.2). */
  inHorizontalScroller: boolean
  /** 현재 형식이 확대 대상인지(이미지·PDF). */
  zoomable: boolean
}

export type ViewerAction = 'prev' | 'next' | 'zoomIn' | 'zoomOut' | 'zoomReset' | null

/** 키 → 뷰어 동작. Esc 는 Radix Dialog(+useAiPanelAwareDialog)가 처리하므로 다루지 않는다. */
export function routeKey(ctx: KeyContext): ViewerAction {
  if (ctx.ctrlOrMeta || ctx.inAiPanel || ctx.inEditable) return null
  switch (ctx.key) {
    case 'ArrowLeft':
      return ctx.inHorizontalScroller ? null : 'prev'
    case 'ArrowRight':
      return ctx.inHorizontalScroller ? null : 'next'
    case '+':
    case '=':
      return ctx.zoomable ? 'zoomIn' : null
    case '-':
      return ctx.zoomable ? 'zoomOut' : null
    case '0':
      return ctx.zoomable ? 'zoomReset' : null
    default:
      return null
  }
}

/** 파일명을 max 글자 안으로 가운데 말줄임 — 확장자(마지막 . 뒤, 5자 이하)를 남겨 형식을 알아보게 한다. */
export function middleEllipsis(name: string, max: number): string {
  if (name.length <= max) return name
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(name)
  // 확장자 앞 몇 글자(버전 꼬리 등)도 함께 남긴다 — "…v3.pdf".
  const tailLen = Math.min(name.length - 1, (m ? m[0].length : 0) + 2)
  const headLen = max - 1 - tailLen
  if (headLen < 1) return name.slice(0, max - 1) + '…'
  return name.slice(0, headLen) + '…' + name.slice(name.length - tailLen)
}
