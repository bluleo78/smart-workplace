import { Extension } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type * as Y from 'yjs'

import { nearestClippingAncestor } from '@/lib/nearestClippingAncestor'

import { clampPos, isRemoteSyncTr, resolveRelative, toRelative } from './wikiCollabPosition'

/**
 * 원격 반영에도 내 커서·화면을 고정한다(WP-293, 스펙 §7.2 "키보드 입력 중 남이 위쪽에 삽입해도 내 커서·스크롤 고정.
 * 스크롤-투-커서는 내 입력일 때만").
 *
 * - y-prosemirror 는 원격 변경을 반영하며 내 캐럿이 보이면 tr.scrollIntoView() 를 건다 — handleScrollToSelection 으로 그 스크롤을 막는다.
 *   내 Yjs 실행 취소·다시 실행도 같은 경로(isChangeOrigin)로 오지만 내 입력이라 막지 않고 보정도 하지 않는다(isRemoteSync, 판정 R10).
 * - 기준점을 Yjs 상대 위치로 들고 있다가(포커스면 내 캐럿, 아니면 화면 맨 위 블록) 원격 반영 직후 그 기준점이 본문 칼럼 안에서
 *   내려간 만큼 스크롤 영역을 옮긴다. 원격 반영은 문서 전체 교체 트랜잭션이라 PM 매핑으로는 위치를 따라갈 수 없어 상대 위치를 쓴다.
 * - 브라우저 스크롤 앵커링과 이중 보정되지 않도록 스크롤 영역엔 overflow-anchor:none 을 건다(WikiEditor). 원격 반영은 문서 전체 교체라
 *   앵커링(Chromium·iOS WebKit 26.x 지원)으로는 지켜지지 않고, overflow-anchor 를 모르는 옛 iOS Safari 엔 앵커링 자체가 없다 —
 *   두 경우 모두 이 보정이 맡는다. 앵커링을 끈 대신, 화면 위쪽이 늦게 커질 때(이미지 로드·AI 요약 카드·노드뷰 렌더)도
 *   본문 칼럼의 크기 변화(ResizeObserver)로 같은 기준점 보정을 한다 — 브라우저 앵커링이 해 주던 일(판정 R6).
 * - ProseMirror 는 overflow-anchor 를 모르는 브라우저에서(view.dom.style.overflowAnchor == null) 트랜잭션마다 스크롤 위치를
 *   스스로 저장·복원하는데(prosemirror-view storeScrollPos/resetScrollPos), 플러그인 뷰 update 뒤에 돌아 이 보정을 되돌린다.
 *   그래서 에디터 DOM 에 overflowAnchor='none' 을 직접 넣어 그 경로를 끈다(지원 브라우저에선 스크롤 영역이 이미 none 이라 무해).
 * - 기준점이 화면 맨 위 블록(포커스·보이는 캐럿 없음)이고 에디터 위쪽(제목·요약 카드)이 화면에 보이면 고정하지 않는다 — 맨 위에서
 *   읽는 사람에겐 위에 새로 들어온 문단이 보이는 게 맞다(크기 변화 보정의 settle 과 같은 기준). 보이는 내 캐럿은 언제나 고정한다.
 * - 기준점 높이는 화면이 아니라 본문 칼럼 top 기준으로 잰다 — 칼럼 위의 동기화 안내 띠가 바뀌어 칼럼째 밀리는 건 여기서 0 이라
 *   그 보정(WikiSyncNotice useKeepContentOnStripResize)과 겹치지 않는다.
 */
export const wikiRemoteScrollAnchorKey = new PluginKey<{ remote: boolean }>('wikiRemoteScrollAnchor')

/** 화면 맨 위에 보이는 본문 위치 — 스크롤 영역 위쪽(또는 에디터 위쪽 중 아래) 바로 안쪽. */
function topVisiblePos(view: EditorView, scroller: HTMLElement): number | null {
  const s = scroller.getBoundingClientRect()
  const e = view.dom.getBoundingClientRect()
  return view.posAtCoords({ left: e.left + 8, top: Math.max(s.top, e.top) + 4 })?.pos ?? null
}

/** 스크롤 영역의 직속 자식 중 에디터를 품은 본문 칼럼(안내 띠 다음 형제). 못 찾으면 에디터 자신. */
function columnOf(dom: HTMLElement, scroller: HTMLElement): HTMLElement {
  let el = dom
  while (el.parentElement && el.parentElement !== scroller) el = el.parentElement
  return el.parentElement === scroller ? el : dom
}

export const WikiRemoteScrollAnchor = Extension.create({
  name: 'wikiRemoteScrollAnchor',
  addProseMirrorPlugins() {
    return [
      new Plugin<{ remote: boolean }>({
        key: wikiRemoteScrollAnchorKey,
        state: {
          init: () => ({ remote: false }),
          // 원격 반영 뒤 다른 플러그인이 덧붙인 트랜잭션까지 원격으로 본다 — 그래야 마지막 상태에서도 보정·스크롤 차단이 유지된다.
          apply: (tr) => ({ remote: isRemoteSyncTr(tr) }),
        },
        props: {
          // 원격 반영으로는 화면을 옮기지 않는다 — true 를 돌려주면 PM 이 기본 scrollIntoView 를 하지 않는다.
          handleScrollToSelection: (view) => wikiRemoteScrollAnchorKey.getState(view.state)?.remote === true,
        },
        view: (view) => {
          // 플러그인 뷰는 에디터 DOM 이 화면에 붙기 전에 만들어진다(tiptap EditorContent 가 나중에 옮겨 붙인다) — 스크롤 영역은 늦게 찾는다.
          let scroller: HTMLElement | null = null
          let column: HTMLElement | null = null
          let ro: ResizeObserver | null = null
          /** 기준점 — Yjs 상대 위치와, 그 위치의 본문 칼럼 top 기준 높이, 내 캐럿인지(아니면 화면 맨 위 블록), 그때 칼럼의 화면 높이(스크롤 영역 top 기준). */
          let anchor: { rel: Y.RelativePosition; offset: number; caret: boolean; colTop: number } | null = null
          /** 원격 보정을 이미 한 상태 — 트랜잭션 없는 updateState(속성 갱신)에 remote 플래그가 남아 있어도 다시 보정하지 않는다. */
          let consumed: EditorState | null = null

          // ProseMirror 자체 스크롤 보존(overflow-anchor 미지원 브라우저 경로)이 이 보정을 되돌리지 않게 끈다 — 위 설명 참조.
          view.dom.style.overflowAnchor = 'none'

          /**
           * 기준 위치 pos 의 높이 — 본문 칼럼 top 에서 얼마나 아래 있는지(px).
           * - 캐럿 기준이면 캐럿이 든 문단(텍스트 블록)의 top: 같은 줄에 막 붙여 넣은 이미지가 자라면 캐럿(과 인라인 위치 좌표)은
           *   줄 아래로 밀리는데, 그걸 되돌리면 이미지가 위로 자라 머리가 화면 위로 잘린다. 문단 top 을 지키면 이미지는 아래로 자란다.
           *   원격 삽입은 내 문단 바깥이라 문단 top 을 지키면 캐럿의 화면 위치도 그대로다.
           * - 화면 맨 위 블록 기준이면 그 자리(읽던 줄)의 좌표: 긴 문단이 회전·창 크기 변경으로 다시 줄바꿈돼도 읽던 줄이 제자리에 있게.
           * 블록 사이 위치(문단 밖)면 언제나 그 자리의 좌표.
           */
          const offsetOf = (pos: number, caret: boolean) => {
            const $p = view.state.doc.resolve(pos)
            const dom = caret && $p.depth > 0 ? view.nodeDOM($p.before($p.depth)) : null
            const top = dom instanceof HTMLElement ? dom.getBoundingClientRect().top : view.coordsAtPos(pos).top
            return top - column!.getBoundingClientRect().top
          }

          /** 본문 칼럼 top 이 스크롤 영역 top 에서 얼마나 아래 있는지(px) — 스크롤하면 바뀐다. */
          const columnTop = () => column!.getBoundingClientRect().top - scroller!.getBoundingClientRect().top

          /** 에디터 위쪽(제목·AI 요약 카드)이 화면 밖으로 올라가 있는가 — 아니면 맨 위를 보고 있는 것이다. */
          const aboveEditorHidden = () =>
            !!scroller && view.dom.getBoundingClientRect().top < scroller.getBoundingClientRect().top

          /**
           * 기준점으로 쓸 위치 — 포커스가 있고 내 캐럿이 실제로 보이면 캐럿, 아니면 화면 맨 위 블록.
           * 캐럿을 둔 채 스크롤해 다른 곳을 읽는 중이면 보던 자리를 지켜야 한다(y-prosemirror 의 _isLocalCursorInView 와 같은 규칙).
           * 보이는 영역은 스크롤 영역과 visualViewport(모바일 키보드에 가린 아래쪽 제외)의 겹친 부분이다.
           */
          const anchorPos = (sc: HTMLElement): { pos: number; caret: boolean } | null => {
            if (view.hasFocus()) {
              const head = view.state.selection.head
              const c = view.coordsAtPos(head)
              const r = sc.getBoundingClientRect()
              const vv = window.visualViewport
              const top = vv ? Math.max(r.top, vv.offsetTop) : r.top
              const bottom = vv ? Math.min(r.bottom, vv.offsetTop + vv.height) : r.bottom
              if (c.bottom > top && c.top < bottom) return { pos: head, caret: true }
            }
            const pos = topVisiblePos(view, sc)
            return pos == null ? null : { pos, caret: false }
          }

          /** 지금 기준점을 잡는다 — 내 입력·선택·스크롤·보정 뒤마다(다음 원격 반영·크기 변화 직전의 위치가 필요하므로). 스크롤 뒤엔 기준 위치를 다시 고른다. */
          const capture = () => {
            if (!scroller || !column) return
            const a = anchorPos(scroller)
            const rel = a ? toRelative(view.state, a.pos) : null
            anchor = a && rel ? { rel, offset: offsetOf(a.pos, a.caret), caret: a.caret, colTop: columnTop() } : null
          }

          /**
           * 기준점이 칼럼 안에서 움직인 만큼 스크롤해 화면상 자리를 되돌린다.
           * scrollTop 을 직접 옮긴다(scrollBy smooth 아님) — 스크롤 영역에 scroll-behavior:smooth 가 걸리면 이 보정도 애니메이션돼
           * 한 번 밀렸다 돌아오는 게 보이므로 그 속성을 걸지 않는다. iOS 관성 스크롤 중에 scrollTop 을 쓰면 관성이 끊기지만, 원격 반영·
           * 위쪽 크기 변화로 보던 자리가 밀리는 것보다 낫다고 본다(관성 중 보정은 드물다).
           *
           * @param screen 칼럼 자체가 화면에서 움직인 것까지 되돌릴지 — 크기 변화(ResizeObserver) 때만. 폭이 바뀌어(회전) 문서가
           *   짧아지면 브라우저가 scrollTop 을 최대값으로 잘라 칼럼째 내려 버리는데, 그 잘림은 스크롤 이벤트보다 먼저(같은 프레임의
           *   크기 콜백 전에) 일어나 칼럼 기준 밀림만으론 못 본다. 스크롤 이벤트 때는 칼럼 이동이 사용자의 스크롤이라 되돌리면 안 된다.
           */
          const restore = (screen = false) => {
            if (!scroller || !anchor) return
            const at = resolveRelative(view.state, anchor.rel)
            if (at == null) return
            const delta =
              offsetOf(clampPos(at, view.state.doc), anchor.caret) - anchor.offset + (screen ? columnTop() - anchor.colTop : 0)
            if (Math.abs(delta) >= 1) scroller.scrollTop += delta
          }

          /**
           * 스크롤·칼럼 크기 변화 때 — 그사이 늦게 커진 위쪽 때문에 기준점이 칼럼 안에서 밀렸으면 먼저 되돌리고, 기준점을 다시 잡는다.
           * 칼럼 기준 높이라 스크롤만으로는 밀림이 0 이다 — 스크롤 이벤트와 크기 변화가 같은 프레임에 겹쳐도 밀림을 기준점에 삼키지 않는다.
           * 에디터 위쪽(제목·AI 요약 카드)이 화면에 보이는 동안엔 되돌리지 않는다 — 맨 위에서 늦게 뜬 요약 카드를 밀어 올려 숨기거나,
           * 화면의 카드를 접고 펼 때 누른 머리글이 튀지 않게(브라우저 앵커링도 그땐 보이는 위쪽 요소를 기준으로 삼아 움직이지 않는다).
           */
          const settle = (screen: boolean) => {
            if (aboveEditorHidden()) restore(screen)
            capture()
          }
          const onScroll = () => settle(false)

          /** 에디터가 화면에 붙었으면 스크롤 영역·칼럼을 찾아 듣기 시작한다(한 번만). */
          const attach = () => {
            if (scroller || !view.dom.isConnected) return
            scroller = nearestClippingAncestor(view.dom, null, 'y')
            if (!scroller) return
            column = columnOf(view.dom, scroller)
            scroller.addEventListener('scroll', onScroll, { passive: true })
            // 에디터를 떠나면 기준점을 다시 고른다 — 남은 캐럿 기준으로 나중의 원격 삽입을 고정하지 않게(맨 위 읽기 정책이 적용되도록).
            view.dom.addEventListener('blur', capture)
            // 칼럼 크기 변화 = 화면 위쪽이 늦게 커지거나(이미지·요약 카드·노드뷰) 줄바꿈이 바뀜. 콜백은 레이아웃 뒤·페인트 전이라
            // 밀린 화면이 그려지지 않는다.
            ro = new ResizeObserver(() => settle(true))
            ro.observe(column)
            capture()
          }

          // 붙기 전이면 다음 프레임마다 다시 본다 — 트랜잭션이 없어도(읽기만 하는 노트) 늦게 커지는 위쪽 보정이 돌아야 한다.
          // 붙었는데 스크롤 영역이 없으면(다른 화면에 끼운 에디터) 더 찾지 않는다.
          let raf = 0
          const attachSoon = () => {
            attach()
            raf = view.dom.isConnected ? 0 : requestAnimationFrame(attachSoon)
          }
          attachSoon()
          return {
            update: (v, prev) => {
              attach()
              // 원격 반영은 한 번만 보정한다. 맨 위 블록 기준이면서 맨 위를 보고 있으면 고정하지 않는다(위 설명).
              if (wikiRemoteScrollAnchorKey.getState(v.state)?.remote && v.state !== consumed) {
                consumed = v.state
                if (anchor?.caret || aboveEditorHidden()) restore()
              }
              if (v.state.doc !== prev.doc || !v.state.selection.eq(prev.selection)) capture()
            },
            destroy: () => {
              cancelAnimationFrame(raf)
              scroller?.removeEventListener('scroll', onScroll)
              view.dom.removeEventListener('blur', capture)
              ro?.disconnect()
            },
          }
        },
      }),
    ]
  },
})
