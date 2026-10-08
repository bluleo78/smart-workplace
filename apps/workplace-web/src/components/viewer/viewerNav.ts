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
  /** 현재 형식이 영상·오디오인지(WP-281) — 없으면 문서·이미지. */
  media?: 'video' | 'audio' | null
  /**
   * 포커스가 미디어 요소(재생 막대 등 네이티브 컨트롤 포함) 안인가 — 컨트롤은 shadow DOM 이라 이벤트 대상이 `<video>`/`<audio>` 로 보정되어 온다.
   */
  inMedia?: boolean
  /** 버튼·링크 같은 조작 요소 위인가 — Space 는 그 요소의 활성화 몫으로 남긴다. */
  onControl?: boolean
  /** 미디어가 전체화면 중인가(document.fullscreenElement). */
  fullscreen?: boolean
  /** 방금(가드 시간 안) 전체화면이 풀렸는가 — 브라우저가 전체화면 해제에 쓴 Esc 가 뒤늦게 와도 뷰어를 닫지 않게(스펙 §5.3 #7). */
  fullscreenJustExited?: boolean
}

export type ViewerAction =
  | 'prev'
  | 'next'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'playPause'
  | 'seekBack'
  | 'seekForward'
  | 'exitFullscreen'
  | null

/**
 * 키 → 뷰어 동작.
 * - Esc 는 평소 Radix Dialog(+useAiPanelAwareDialog)가 닫기로 처리하므로 null. 전체화면 중(또는 방금 해제)이면 'exitFullscreen' —
 *   호출부는 닫기를 막고 전체화면만 푼다(스펙 §5.3 #7, 이중 닫기 방지).
 * - ←/→: 영상·오디오에 포커스가 있거나 전체화면이면 탐색(±5초), 그 외는 파일 넘김(스펙 §5.3 #6).
 * - Space: 영상·오디오 형식이면 재생/정지 — 단 버튼·링크 위에서는 그 요소의 활성화 몫(전체화면 중 제외). 문서는 null(브라우저 스크롤).
 */
export function routeKey(ctx: KeyContext): ViewerAction {
  if (ctx.ctrlOrMeta || ctx.inAiPanel || ctx.inEditable) return null
  // 미디어 탐색 — 미디어에 포커스가 있거나 전체화면일 때만(그 밖의 ←/→ 는 파일 넘김이 우선).
  const seeking = !!ctx.media && (!!ctx.inMedia || !!ctx.fullscreen)
  switch (ctx.key) {
    case 'Escape':
      return ctx.fullscreen || ctx.fullscreenJustExited ? 'exitFullscreen' : null
    case 'ArrowLeft':
      if (seeking) return 'seekBack'
      return ctx.inHorizontalScroller ? null : 'prev'
    case 'ArrowRight':
      if (seeking) return 'seekForward'
      return ctx.inHorizontalScroller ? null : 'next'
    case ' ':
      return ctx.media && (ctx.fullscreen || !ctx.onControl) ? 'playPause' : null
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

/**
 * 파일명을 [앞부분, 꼬리] 로 나눈다 — 화면에서 앞부분만 CSS 말줄임(폭 기준)하고 꼬리는 늘 보이게 해 확장자를 잃지 않는다(스펙 §4.2·시안 M1).
 * 꼬리 = 확장자(마지막 . 뒤 1~5자) + 그 앞 2글자(버전 꼬리 "v3" 등). 확장자가 없으면 끝 2글자.
 * 글자 수로 자르면 글꼴·폭(360px 등)에 따라 CSS truncate 가 다시 끝을 잘라 확장자가 사라지므로 폭 판단은 CSS 에 맡긴다.
 */
export function splitName(name: string): [head: string, tail: string] {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(name)
  const tailLen = Math.min(name.length - 1, (m ? m[0].length : 0) + 2)
  if (tailLen <= 0) return [name, '']
  return [name.slice(0, name.length - tailLen), name.slice(name.length - tailLen)]
}

/**
 * 연타 중 "요청했지만 아직 반영 안 된 목표"(항목 key)를 현재 목록 기준으로 해석한다.
 * 왜 key: 목록이 바뀌어도(재조회·삭제) 인덱스가 아니라 파일 자체를 가리켜야 엉뚱한 파일로 튀지 않는다.
 * - 목표가 없거나 목록에서 사라졌거나 이미 현재 항목이면 버린다('clear').
 * - 아직 도달 전이면 현재 목록에서의 위치로 이어서 요청한다('request').
 */
export function resolvePending(
  items: { key: string }[],
  currentKey: string,
  pendingKey: string | null,
): { kind: 'clear' } | { kind: 'request'; index: number } {
  if (pendingKey == null || pendingKey === currentKey) return { kind: 'clear' }
  const index = items.findIndex((i) => i.key === pendingKey)
  return index < 0 ? { kind: 'clear' } : { kind: 'request', index }
}
