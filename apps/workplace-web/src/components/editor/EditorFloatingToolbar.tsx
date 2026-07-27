import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react'
import type { ReactNode } from 'react'

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
  children: ReactNode
}) {
  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={pluginKey}
      shouldShow={({ editor: ed, state }) => shouldShow({ editor: ed, state })}
      // 기본 250ms 는 빠른 드래그·클릭에서 툴바가 안 뜬 것처럼 느껴진다.
      updateDelay={0}
      tippyOptions={{
        placement: 'top',
        appendTo: () => document.getElementById('root') ?? document.body,
        // 가로 flex 행이라 tippy 기본 350px 이면 줄바꿈된다. 다만 상한을 없애면 좁은
        // 뷰포트에서 화면을 넘치므로 뷰포트 폭으로 가드한다.
        maxWidth: 'calc(100vw - 2rem)',
        ...(getReferenceClientRect
          ? {
              getReferenceClientRect: () =>
                getReferenceClientRect() ?? new DOMRect(0, 0, 0, 0),
            }
          : {}),
      }}
    >
      {/* bg-popover 는 다크에서 솔리드로 정의된 토큰(bg-card 는 알파라 뒤가 비친다).
          role 은 toolbar 가 아니라 group — ARIA toolbar 는 화살표 이동 + roving tabindex 를
          약속하는데 내부에 Radix 트리거(자체 포커스 관리)가 섞이면 충돌한다. */}
      <div
        data-testid={testId}
        role="group"
        aria-label={ariaLabel}
        className="flex items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {children}
      </div>
    </BubbleMenu>
  )
}
