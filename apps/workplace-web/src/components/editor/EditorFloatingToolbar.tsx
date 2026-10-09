import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react'
import { type ReactNode, useEffect, useRef } from 'react'

/** 에디터 플로팅 툴바 표면. tippy 배치와 팝오버 표면 스타일만 담당하고 내용은 children 이 채운다.
 *  AI 변형 툴바 · 표 툴바 · (향후) 기본 서식 툴바가 같은 표면을 쓰게 하려는 프리미티브다.
 *
 *  배치에 두 개의 함정이 있어 옵션을 여기에 고정한다.
 *  - appendTo 를 document.body 로 두면 React 이벤트 위임(#root) 밖이라 children 의 onClick 이
 *    영구히 죽는다. 반대로 지정하지 않으면 popper 가 .ProseMirror 의 스크롤 컨테이너 안에 갇혀
 *    선택 위치가 아닌 좌측 상단에 렌더된다(#733). 그래서 #root 가 유일한 정답이다.
 *  - pluginKey 는 소비자마다 반드시 달라야 한다. 한 에디터에 BubbleMenu 를 두 개 달면서
 *    기본 키('bubbleMenu')를 공유하면 두 플러그인이 같은 상태를 덮어써 한쪽이 뜨지 않는다. */
export function EditorFloatingToolbar({
  editor,
  pluginKey,
  shouldShow,
  ariaLabel,
  testId,
  getReferenceClientRect,
  placement = 'top',
  boundary,
  suppressed = false,
  children,
}: {
  editor: Editor | null
  pluginKey: string
  shouldShow: (props: { editor: Editor; state: EditorState }) => boolean
  ariaLabel: string
  testId: string
  /** 앵커를 선택 좌표가 아닌 다른 요소로 바꿀 때 사용(표 툴바는 표 상단에 붙인다).
   *  null 을 반환하면 tippy 가 기본 앵커(선택 좌표)를 쓰도록 둔다. */
  getReferenceClientRect?: () => DOMRect | null
  /** 위치(기본 'top'). 마운트 때 tippyOptions 로 굳어 이후 바꿔도 반영되지 않는다. */
  placement?: 'top' | 'top-start'
  /**
   * 넘치지 않을 경계(예: 에디터 본문) — 위에 자리가 없으면 아래로 뒤집고 가로로는 경계 안에 머문다.
   * placement 와 같이 마운트 때 굳는다(tiptap BubbleMenu 가 플러그인을 한 번만 등록) — 바꿔도 무시된다.
   */
  boundary?: Element
  /** 지금 떠 있어도 숨긴다(다른 입력 UI 가 열린 동안 등). shouldShow 는 선택·문서가 바뀔 때만 다시 판정되고, 툴바 버튼을 누른 직후의
   *  blur 는 tiptap 이 숨기지 않으므로(mousedown 의 preventHide), 화면 상태로 숨길 땐 표면을 직접 감춘다. */
  suppressed?: boolean
  children: ReactNode
}) {
  // tiptap BubbleMenu 는 플러그인을 마운트 때 한 번만 등록해(effect deps=[editor, element]) 넘긴
  // shouldShow·tippyOptions 가 그 시점 클로저로 굳는다. 권한(disabled)이 늦게 확정되면 false 로 굳어
  // 툴바가 영영 안 뜨므로(WP-225), 최신 콜백을 ref 로 들고 BubbleMenu 에는 ref 를 읽는 함수만 넘긴다.
  const latest = useRef({ shouldShow, getReferenceClientRect })
  useEffect(() => {
    latest.current = { shouldShow, getReferenceClientRect }
  })

  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={pluginKey}
      shouldShow={({ editor: ed, state }) => latest.current.shouldShow({ editor: ed, state })}
      // 기본 250ms 는 빠른 드래그·클릭에서 툴바가 안 뜬 것처럼 느껴진다.
      updateDelay={0}
      tippyOptions={{
        placement,
        ...(boundary
          ? {
              popperOptions: {
                modifiers: [
                  { name: 'flip', options: { boundary, fallbackPlacements: [placement.replace('top', 'bottom')] } },
                  { name: 'preventOverflow', options: { boundary, altAxis: false } },
                ],
              },
            }
          : {}),
        appendTo: () => document.getElementById('root') ?? document.body,
        // 가로 flex 행이라 tippy 기본 350px 이면 줄바꿈된다. 다만 상한을 없애면 좁은
        // 뷰포트에서 화면을 넘치므로 뷰포트 폭으로 가드한다.
        maxWidth: 'calc(100vw - 2rem)',
        ...(getReferenceClientRect
          ? {
              getReferenceClientRect: () =>
                latest.current.getReferenceClientRect?.() ?? new DOMRect(0, 0, 0, 0),
            }
          : {}),
      }}
    >
      {/* bg-popover 는 다크에서 솔리드로 정의된 토큰(bg-card 는 알파라 뒤가 비친다).
          role 은 toolbar 가 아니라 group — ARIA toolbar 는 화살표 이동 + roving tabindex 를
          약속하는데 내부에 Radix 트리거(자체 포커스 관리)가 섞이면 충돌한다. */}
      <div
        data-testid={testId}
        hidden={suppressed}
        role="group"
        aria-label={ariaLabel}
        // flex-wrap — 좁은 뷰포트에서 버튼 수가 많은 툴바(서식 6 + AI 6, #687)가 maxWidth 를
        // 넘으면 한 줄에 다 들어가지 못한다. wrap 없이는 넘치는 버튼이 클리핑되어 클릭 불가
        // 상태로 숨어버리므로, 넘치면 2줄 이상으로 접히게 한다(좁은 화면 실측 필수 — CLAUDE 메모리).
        className="flex flex-wrap items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {children}
      </div>
    </BubbleMenu>
  )
}
