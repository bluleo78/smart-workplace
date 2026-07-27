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

// 삽입 계열 — LLM 을 거치지 않고 에디터 트랜잭션만으로 끝나는 명령. '표' 선택 시 메뉴가
// 그리드 피커로 전환돼 행×열 크기를 고른 뒤 삽입한다(#748·#752). 삽입 후 행/열 추가·삭제는
// 표 툴바(WikiTableToolbar)·우클릭 메뉴(WikiTableContextMenu)·단축키(Ctrl-Alt-화살표,
// wikiTableShortcuts.ts) 세 경로로 모두 지원하며, 셋 다 wikiTableCommands.ts 를 단일 원천으로 쓴다.
// 이미지(#751) — 그리드 없이 바로 파일 선택기를 연다(WikiEditor 의 onImageInsertRef 경유).
const INSERT_ITEMS: WikiSlashItem[] = [
  { key: 'table', label: '표', kind: 'insert' },
  { key: 'image', label: '이미지', kind: 'insert' },
]

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
  // '이미지' 항목 선택 시 호출(#751) — WikiEditor 의 숨은 file input 을 연다. 최신값 참조용 ref.
  onImageInsertRef: { current: () => void }
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
              if (props.key === 'image') {
                // 파일 선택 자체가 비동기(사용자 대화상자)라 표처럼 한 체인으로 묶을 수 없다.
                // "/이미지" 텍스트만 먼저 지우고, 실제 업로드는 WikiEditor 의 file input 이 맡는다.
                editor.chain().focus().deleteRange(range).run()
                ctx.onImageInsertRef.current()
                return
              }
              // 표 — 크기는 그리드에서 확정돼 props 로 온다. 아직 안 골랐으면(rows 미지정) 아무것도
              // 하지 않는다 — 메뉴가 그리드 모드로 전환만 한 상태다.
              if (props.rows == null || props.cols == null) return
              // 트리거 삭제와 삽입을 한 체인(= 한 트랜잭션)으로 묶는다. 따로 실행하면 삭제로
              // 문서 위치가 밀린 뒤 삽입돼 커서가 어긋나고, undo 도 두 번 눌러야 한다.
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertTable({ rows: props.rows, cols: props.cols, withHeaderRow: true })
                .run()
              return
            }
            editor.chain().focus().deleteRange(range).run()
            ctx.onActionRef.current(props.key as GenerateActionKey)
          },
          // query 로 라벨/key 필터(예: "/요약"). 셀 안('/'가 tableCell.content='block+' 안에서
          // 눌린 경우)에서는 '표' 항목을 뺀다 — 스키마상 중첩 표는 유효하지만 tiptap-markdown 은
          // 중첩 table 을 GFM 으로 직렬화 못 해 바깥 표 전체가 raw HTML 로 새어버린다(회귀 테스트
          // 참고: e2e/pages/wiki/wiki-table-editing.spec.ts 의 "중첩 표 회귀").
          items: ({ query, editor }) => {
            const base = editor.isActive('table')
              ? SLASH_ITEMS.filter((i) => i.key !== 'table')
              : SLASH_ITEMS
            const q = query.trim().toLowerCase()
            if (!q) return base
            return base.filter((i) => i.label.toLowerCase().includes(q) || i.key.includes(q))
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
                // 메뉴에 먼저 위임한다. 그리드 모드의 Escape 는 팝업을 닫는 게 아니라
                // 목록으로 돌아가는 동작이라, 여기서 먼저 hide 하면 그 복귀가 불가능해진다.
                if (component?.ref?.onKeyDown(props)) return true
                if (props.event.key === 'Escape') {
                  popup?.hide()
                  return true
                }
                return false
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
