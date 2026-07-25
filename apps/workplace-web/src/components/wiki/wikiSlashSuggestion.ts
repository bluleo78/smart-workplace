// 위키 에디터 슬래시(/) AI 메뉴용 TipTap 확장. RichInput 의 mention suggestion 을 미러하되
// 노드를 삽입하는 @tiptap/extension-mention 대신, raw @tiptap/suggestion 플러그인을
// Extension 으로 감싼다(우리는 노드가 아니라 "/" 트리거를 지우고 액션을 실행하기만 한다).
//
// 역할 게이트: 매번 useEditor 를 재생성하지 않고 suggestion.allow 가 ctx.canUseAiRef 를 읽어
// 동적으로 차단한다(VIEWER → allow false → onStart 미발화 → 팝업 미노출). 액션 콜백·게이트는
// 스테일 클로저를 피하려 ref 로 주입(RichInput 의 membersRef/onSubmitRef 패턴).

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion'
import tippy, { type Instance as TippyInstance } from 'tippy.js'

// @tiptap/suggestion 의 기본 플러그인 키(suggestion$)는 @ 멘션 suggestion 과 충돌하므로 전용 키 부여.
const wikiSlashPluginKey = new PluginKey('wikiSlashAi')

import { GENERATE_ACTIONS, type GenerateActionKey } from './wikiAiActions'
import { type WikiSlashItem, WikiSlashMenu, type WikiSlashMenuHandle } from './WikiSlashMenu'

// 삽입 계열 — LLM 을 거치지 않고 에디터 트랜잭션만으로 끝나는 명령. 표는 헤더 행 포함 3×3 으로
// 시작하고, 행 추가는 tiptap 기본 동작(마지막 셀에서 Tab)에 맡긴다(#748). 명시적인 행/열 추가·삭제
// 컨트롤은 새 팝오버 표면이 필요해 범위에서 제외했다.
const INSERT_ITEMS: WikiSlashItem[] = [{ key: 'table', label: '표', kind: 'insert' }]

// 생성 계열 3 액션 — 헤더 AI 버튼과 라벨을 공유하려 wikiAiActions 의 단일 원천에서 파생한다.
const SLASH_ITEMS: WikiSlashItem[] = [
  ...INSERT_ITEMS,
  ...GENERATE_ACTIONS.map(({ key, label }) => ({ key, label, kind: 'ai' as const })),
]

// 확장이 외부 React 상태를 스테일 없이 참조하기 위한 컨텍스트(전부 ref).
export interface WikiSlashContext {
  // OWNER|EDITOR 일 때만 true. allow 게이트가 매 트리거마다 읽는다.
  //
  // AI 전용 메뉴이던 시절엔 canUseAiRef 였으나, 표 삽입(#748)이 들어오며 게이트의 의미가
  // "AI 사용 가능"이 아니라 "편집 가능"이 됐다. 두 값은 원래부터 동일 식(OWNER|EDITOR)이라
  // 동작 변화는 없고, 에디터가 이미 갖고 있던 canEditRef 를 그대로 재사용한다.
  canEditRef: { current: boolean }
  // AI 액션 선택 시 호출(에디터에서 startWikiAiStream 트리거). 최신값 참조용 ref.
  onActionRef: { current: (action: GenerateActionKey) => void }
}

/** 슬래시 AI 메뉴 확장 생성. ctx 의 ref 를 통해 게이트/액션을 동적으로 주입. */
export function createWikiSlashExtension(ctx: WikiSlashContext): Extension {
  return Extension.create({
    name: 'wikiSlashAi',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: wikiSlashPluginKey,
          char: '/',
          // 줄 어디서든 "/" 로 트리거(기본 prefix 제약 해제).
          allowedPrefixes: null,
          // 역할 게이트 — VIEWER 면 false 를 반환해 팝업 자체를 막는다.
          allow: () => ctx.canEditRef.current,
          // "/" 트리거 텍스트를 지우고 명령을 실행한다.
          command: ({ editor, range, props }) => {
            if (props.kind === 'insert') {
              // 삽입 계열은 트리거 삭제와 삽입을 한 체인(= 한 트랜잭션)으로 묶는다. 따로 실행하면
              // 삭제로 문서 위치가 밀린 뒤 삽입돼 커서가 어긋나고, undo 도 두 번 눌러야 한다.
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
              return
            }
            editor.chain().focus().deleteRange(range).run()
            ctx.onActionRef.current(props.key as GenerateActionKey)
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
