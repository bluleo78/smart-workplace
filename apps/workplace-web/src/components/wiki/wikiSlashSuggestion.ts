// 위키 에디터 슬래시(/) AI 메뉴용 TipTap 확장. RichInput 의 mention suggestion 을 미러하되
// 노드를 삽입하는 @tiptap/extension-mention 대신, raw @tiptap/suggestion 플러그인을
// Extension 으로 감싼다(우리는 노드가 아니라 "/" 트리거를 지우고 액션을 실행하기만 한다).
//
// 역할 게이트: 매번 useEditor 를 재생성하지 않고 suggestion.allow 가 ctx.canUseAiRef 를 읽어
// 동적으로 차단한다(VIEWER → allow false → onStart 미발화 → 팝업 미노출). 액션 콜백·게이트는
// 스테일 클로저를 피하려 ref 로 주입(RichInput 의 membersRef/onSubmitRef 패턴).

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion'
import tippy, { type Instance as TippyInstance } from 'tippy.js'

import { type WikiSlashItem, WikiSlashMenu, type WikiSlashMenuHandle } from './WikiSlashMenu'

// 3 액션 — 라벨은 한국어. key 는 백엔드 와이어 값(소문자).
const SLASH_ITEMS: WikiSlashItem[] = [
  { key: 'summarize', label: 'AI 요약' },
  { key: 'draft', label: 'AI 초안' },
  { key: 'continue', label: 'AI 이어쓰기' },
]

// 확장이 외부 React 상태를 스테일 없이 참조하기 위한 컨텍스트(전부 ref).
export interface WikiSlashContext {
  // OWNER|EDITOR 일 때만 true. allow 게이트가 매 트리거마다 읽는다.
  canUseAiRef: { current: boolean }
  // 액션 선택 시 호출(에디터에서 startWikiAiStream 트리거). 최신값 참조용 ref.
  onActionRef: { current: (action: WikiSlashItem['key']) => void }
}

/** 슬래시 AI 메뉴 확장 생성. ctx 의 ref 를 통해 게이트/액션을 동적으로 주입. */
export function createWikiSlashExtension(ctx: WikiSlashContext): Extension {
  return Extension.create({
    name: 'wikiSlashAi',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          // 줄 어디서든 "/" 로 트리거(기본 prefix 제약 해제).
          allowedPrefixes: null,
          // 역할 게이트 — VIEWER 면 false 를 반환해 팝업 자체를 막는다.
          allow: () => ctx.canUseAiRef.current,
          // "/" 트리거 텍스트를 지우고 액션을 실행한다(노드 삽입 없음).
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run()
            ctx.onActionRef.current(props.key)
          },
          // query 로 라벨/key 필터(예: "/요약").
          items: ({ query }) => {
            const q = query.trim().toLowerCase()
            if (!q) return SLASH_ITEMS
            return SLASH_ITEMS.filter(
              (i) => i.label.toLowerCase().includes(q) || i.key.includes(q),
            )
          },
          render: () => {
            let component: ReactRenderer<WikiSlashMenuHandle> | null = null
            let popup: TippyInstance | null = null
            return {
              onStart: (props: SuggestionProps<WikiSlashItem>) => {
                component = new ReactRenderer(WikiSlashMenu, { props, editor: props.editor })
                popup = tippy(document.body, {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps<WikiSlashItem>) => {
                component?.updateProps(props)
                popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup?.hide()
                  return true
                }
                return component?.ref?.onKeyDown(props) ?? false
              },
              onExit: () => {
                popup?.destroy()
                component?.destroy()
                popup = null
                component = null
              },
            }
          },
        }),
      ]
    },
  })
}
