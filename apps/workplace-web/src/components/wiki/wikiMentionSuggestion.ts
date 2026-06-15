// 위키 에디터 @ 통합 멘션용 TipTap 확장. RichInput 의 mention suggestion 을 미러하되,
// 후보가 비동기(TanStack Query)라 @tiptap/suggestion 을 raw Extension 으로 감싸고
// 후보/게이트/쿼리브리지를 전부 ref 로 주입한다(스테일 클로저 회피, slash 확장과 동일 패턴).
//
// 비동기 브리지: suggestion 의 char/query 변화는 ctx.onQueryChange(query) 로 컴포넌트에 알리고,
// 컴포넌트가 useWikiEntitySearch 결과를 ctx.candidatesRef 에 채운 뒤 ctx.refresh() 로 열린 팝업을
// 강제 갱신한다. items 콜백은 항상 candidatesRef 최신값을 반환한다.
//
// 역할 게이트: suggestion.allow 가 ctx.canEditRef 를 읽어 VIEWER 면 팝업 자체를 막는다.

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion'
import tippy, { type Instance as TippyInstance } from 'tippy.js'

// 슬래시('/') suggestion 과 동일 char 가 아니어도 둘 다 @tiptap/suggestion 의 기본 키(suggestion$)를
// 쓰면 "Adding different instances of a keyed plugin" 충돌이 난다. @ 멘션 전용 키를 부여한다.
const wikiMentionPluginKey = new PluginKey('wikiMentionAt')

import type { WikiEntityCandidate } from '../../hooks/queries/useWikiEntitySearch'
import { WikiMentionList, type WikiMentionListHandle } from './WikiMentionList'

// 확장이 외부 React 상태를 스테일 없이 참조하기 위한 컨텍스트(전부 ref/콜백).
export interface WikiMentionContext {
  // OWNER|EDITOR 일 때만 true. allow 게이트가 매 트리거마다 읽는다.
  canEditRef: { current: boolean }
  // useWikiEntitySearch 의 최신 후보. items 콜백이 매번 읽는다.
  candidatesRef: { current: WikiEntityCandidate[] }
  // 현재 suggestion query 변경을 컴포넌트로 통지(컴포넌트가 검색 쿼리 state 에 반영).
  onQueryChange: (query: string) => void
  // 후보 도착 시 컴포넌트가 호출 — 열린 팝업을 강제 갱신(아래 render 가 등록).
  refresh: { current: () => void }
}

/** @ 통합 멘션 확장 생성. ctx 의 ref 로 후보/게이트/쿼리브리지를 동적 주입. */
export function createWikiMentionExtension(ctx: WikiMentionContext): Extension {
  return Extension.create({
    name: 'wikiMentionAt',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: wikiMentionPluginKey,
          char: '@',
          // 역할 게이트 — VIEWER 면 false 를 반환해 팝업 자체를 막는다.
          allow: () => ctx.canEditRef.current,
          // 선택 후보로 wikiMention 노드 삽입 + 트리거 텍스트 제거 + 트레일링 공백.
          // (extension-mention 과 동일하게 노드 뒤 공백을 둬 캐럿이 깔끔히 이어지게 한다.)
          command: ({ editor, range, props }) => {
            const item = props as WikiEntityCandidate
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'wikiMention',
                  attrs: { mtype: item.mtype, id: item.id, label: item.label },
                },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
          // 후보는 비동기로 candidatesRef 에 채워진다. query 변경을 컴포넌트에 통지하고,
          // 현재 보유 후보를 그대로 반환(서버 검색이라 클라 필터 불필요).
          items: ({ query }) => {
            ctx.onQueryChange(query)
            return ctx.candidatesRef.current
          },
          render: () => {
            let component: ReactRenderer<WikiMentionListHandle> | null = null
            let popup: TippyInstance | null = null
            // 가장 최근 props 보관 — 후보 도착 시(refresh) 동일 clientRect 로 갱신.
            let latest: SuggestionProps<WikiEntityCandidate> | null = null
            return {
              onStart: (props: SuggestionProps<WikiEntityCandidate>) => {
                latest = props
                // 후보 도착 시 컴포넌트가 호출할 refresh 등록 — 최신 candidatesRef 로 updateProps.
                ctx.refresh.current = () => {
                  if (!component || !latest) return
                  component.updateProps({ ...latest, items: ctx.candidatesRef.current })
                }
                component = new ReactRenderer(WikiMentionList, { props, editor: props.editor })
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
              onUpdate: (props: SuggestionProps<WikiEntityCandidate>) => {
                latest = props
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
                // 팝업이 닫히면 query 를 비워 다음 트리거 전 검색을 비활성화.
                ctx.onQueryChange('')
                ctx.refresh.current = () => {}
                popup?.destroy()
                component?.destroy()
                popup = null
                component = null
                latest = null
              },
            }
          },
        }),
      ]
    },
  })
}
