import {
  COLLAB_CURSOR_FIELD,
  COLLAB_USER_FIELD,
  type CollabCursor,
  parseCollabCursor,
  parseCollabUser,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, Selection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

import { type AwarenessStates, presenceColorVar, resolveSelfUserId } from '@/lib/collab/presence'
import type { AwarenessChanges, PresenceAwareness } from '@/lib/collab/presenceAwareness'
import { nearestClippingAncestor } from '@/lib/nearestClippingAncestor'

import { CARET_SLOP_MOUSE, CARET_SLOP_TOUCH, createLabelClock, cursorSignature, hitCaret } from './presenceLabels'
import { remoteAiMarkers } from './wikiAiMarkers'
import { isRemoteSyncTr, resolveJson, toRelative } from './wikiCollabPosition'
import { cancelFitTags, observeTagRoot, scheduleFitTags } from './wikiTagLayout'

/**
 * 노트 원격 커서(WP-292, 스펙 §7.1·§7.2) — 다른 사람의 캐럿(사람 색) + 이름표를 내 화면에만 그리고, 내 커서를 awareness 로 알린다.
 *
 * y-prosemirror yCursorPlugin 대신 직접 만든 이유: 포커스만 있으면 커서를 무조건 올려 세션 도중 VIEWER 로 강등돼도 내 커서가
 * 공개되고(에디터는 재생성되지 않는다), 이름표 "움직일 때만 3초"·hover/탭·✦ 태그와의 배치 통합을 제어할 수 없다.
 * - 발행: 편집 가능 + 포커스 + 숨김 아님일 때만 {anchor, head}(Yjs 상대 위치 JSON), 아니면 null. 로컬 상태가 null(provider 가
 *   pagehide·파기로 지움)이면 되살리지 않는다 — 재동기화 때 announcePresence 가 user 를 다시 올리고 다음 선택 변경에 커서도 올라간다.
 * - 그리기: user 와 cursor 가 있는 다른 접속자만. 나·내 다른 탭(같은 userId)은 그리지 않는다. 숨김(종단)이면 아무것도.
 * - 이름표: 움직일 때만 LABEL_SHOW_MS 동안 — 위치(anchor·head)가 다른 곳으로 바뀌거나 활동 횟수(seq — 문단 중간 타이핑)가 바뀔 때. 캐럿 근처 마우스 hover·터치 탭·목록에서 이동하면 다시 보인다.
 *   AI 작성 중(어느 상태든 그 사람 userId 의 aiMarkers 가 있음)인 사람은 ✦ 표식 태그가 고정 이름표라 커서 이름표를 보이지 않는다
 *   (이름표 하나 원칙). 캐럿도 숨긴다(R13 + user decision 2026-10-09: caret hidden too) — 같은 자리의 ✦ 캐럿을 사람 색 캐럿이 가려
 *   ✦ 태그 아래 사람 색이 붙어 보였다(Task 11 디자인 리뷰). 위젯은 남겨(이동·배치 기준) wiki-editor.css 가 캐럿만 감추고, AI 작성이 끝나면 되돌아온다.
 * - 이름 글자는 data-name + CSS ::before 로 그린다 — 글자 노드로 넣으면 본문 textContent·글자 탐색에 섞인다.
 * - awareness 는 presenceAwarenessOf 덮개다 — 끊긴 동안 provider 가 지운 원격 커서를 마지막 위치에 남겨 흐리게 보인다(판정 11).
 *   내 커서 발행(setLocalState)은 덮개가 실제 awareness 로 넘긴다.
 */

export const wikiPresenceCursorsKey = new PluginKey<DecorationSet>('wikiPresenceCursors')

/** 에디터 뷰별 이름표 제어 — 목록에서 이동할 때(React 쪽) 그 사람 이름표를 켠다. */
const controllers = new WeakMap<EditorView, { reveal: (clientIds: number[]) => void }>()

/** awareness 에서 읽은 그릴 대상 커서(아직 문서 위치로 풀기 전). */
interface RemoteCursorState {
  clientId: number
  userId: number
  name: string
  ai: boolean
  cursor: CollabCursor
}

/** 문서 위치로 푼 원격 커서. */
type RemoteCursor = Omit<RemoteCursorState, 'cursor'> & { head: number; anchor: number }

/**
 * 그릴 대상 — user 와 cursor 가 있는 다른 접속자(나·내 다른 탭 제외). 그리기(remoteCursors)와 비교 키(cursorsSignature)가
 * 이 한 번의 순회를 같이 쓴다 — 두 곳이 따로 거르면 "그리는 것" 과 "다시 그릴지 판단하는 것" 이 어긋난다.
 * 내 userId 는 로그인 사용자 id(화면이 넘긴 ref, 헤더 usePresence 와 같은 기준)가 우선이다(resolveSelfUserId).
 */
function remoteCursorStates(
  awareness: PresenceAwareness,
  selfRef: { current: number | null },
  states: AwarenessStates = awareness.getStates(),
): RemoteCursorState[] {
  const me = resolveSelfUserId(selfRef.current, awareness.getLocalState())
  // AI 작성 중은 사람 단위다(판정 R13, derivePeople 과 같은 규칙) — 표식은 그 사람 탭이 아니라 동기화 서버 상태(MCP·채팅 비서 적용,
  // user 없음)에 올 수도 있어 모든 상태의 표식 userId 를 모은다. 접속별로만 보면 서버가 쓰는 동안 "✦ 이름" 옆에 커서 이름표가 또 뜬다.
  const aiUsers = new Set<number>()
  for (const { marker } of remoteAiMarkers(states, awareness.clientID)) if (marker.userId !== me) aiUsers.add(marker.userId)
  const out: RemoteCursorState[] = []
  for (const [clientId, st] of states) {
    if (clientId === awareness.clientID || !st) continue
    const user = parseCollabUser(st[COLLAB_USER_FIELD])
    const cursor = parseCollabCursor(st[COLLAB_CURSOR_FIELD])
    if (!user || !cursor || user.id === me) continue
    out.push({ clientId, userId: user.id, name: user.name, ai: aiUsers.has(user.id), cursor })
  }
  return out
}

/** 그릴 커서 — 지금 문서에서 풀 수 없는 위치(삭제된 자리·동기화 전)는 건너뛴다. */
function remoteCursors(state: EditorState, list: RemoteCursorState[]): RemoteCursor[] {
  const out: RemoteCursor[] = []
  for (const c of list) {
    const head = resolveJson(state, c.cursor.head)
    const anchor = resolveJson(state, c.cursor.anchor)
    if (head == null || anchor == null) continue
    out.push({ clientId: c.clientId, userId: c.userId, name: c.name, ai: c.ai, head, anchor })
  }
  return out
}

/** 커서 목록 비교 키 — 그릴 것이 같으면 다시 그리지 않는다. */
function cursorsSignature(list: RemoteCursorState[]): string {
  return list
    .map((c) => `${c.clientId}|${c.userId}|${c.name}|${cursorSignature(c.cursor)}|${c.ai}`)
    .sort()
    .join('\n')
}

/** 캐럿 위젯 DOM — 폭 0 의 사람 색 캐럿 + 위쪽 이름표(글자는 CSS ::before). 편집·선택 대상이 아니다. */
function cursorWidget(c: RemoteCursor, labelVisible: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = 'wiki-presence-cursor'
  el.contentEditable = 'false'
  el.dataset.testid = 'wiki-presence-cursor'
  el.dataset.clientId = String(c.clientId)
  el.dataset.userId = String(c.userId)
  el.dataset.tagKey = `presence-${c.clientId}`
  if (c.ai) el.dataset.ai = 'true'
  if (labelVisible && !c.ai) el.dataset.labelVisible = ''
  el.style.setProperty('--presence-color', presenceColorVar(c.userId))
  // 보조기기엔 숨긴다 — 본문 글 사이에 이름을 끼워 읽으면 방해가 된다. 누가 어디 있는지는 접속자 목록(이동 버튼)이 접근 경로다.
  el.setAttribute('aria-hidden', 'true')
  const caret = document.createElement('span')
  caret.className = 'wiki-presence-cursor__caret'
  const tag = document.createElement('span')
  tag.className = 'wiki-presence-cursor__tag'
  tag.dataset.name = c.name
  el.append(caret, tag)
  return el
}

/** 위젯 spec — 매핑 때 같은 커서를 다시 만들 수 있게 그린 값을 함께 둔다. */
interface CursorSpec {
  key: string
  cursor: RemoteCursor
}

/** 한 사람 커서의 데코레이션 — 캐럿 위젯 + (선택이 있으면) 옅은 선택 영역. */
function cursorDecorations(c: RemoteCursor, labelOn: (clientId: number) => boolean): Decoration[] {
  const spec: CursorSpec & { side: number; ignoreSelection: boolean } = {
    // 이름·AI 여부가 바뀌면 DOM 을 새로 만든다(같은 키면 PM 이 기존 위젯 DOM 을 재사용한다 — 매핑으로 다시 만들어도 이름표가 깜빡이지 않는다).
    key: `presence-${c.clientId}-${c.userId}-${c.name}-${c.ai ? 'ai' : ''}`,
    cursor: c,
    side: 10,
    ignoreSelection: true,
  }
  const out = [Decoration.widget(c.head, () => cursorWidget(c, labelOn(c.clientId)), spec)]
  if (c.anchor !== c.head) {
    out.push(
      Decoration.inline(
        Math.min(c.anchor, c.head),
        Math.max(c.anchor, c.head),
        { class: 'wiki-presence-selection', style: `--presence-color: ${presenceColorVar(c.userId)}` },
        { inclusiveStart: false, inclusiveEnd: true },
      ),
    )
  }
  return out
}

/** 지금 그려진 커서들(위젯 spec 에서). */
function drawnCursors(set: DecorationSet): RemoteCursor[] {
  return set
    .find()
    .map((d) => (d.spec as Partial<CursorSpec>).cursor)
    .filter((c): c is RemoteCursor => c != null)
}

/**
 * 내 편집(아직 Yjs 에 반영 전이라 상대 위치를 다시 풀 수 없다)을 따라 커서를 옮긴다. PM 기본 매핑(DecorationSet.map)은 삭제 범위 안의
 * 위젯을 버려, 내가 지운 글 안에 가만히 있던 다른 사람 캐럿이 사라졌다 — 지운 자리로 옮겨 남긴다. 블록째 지워 글 상자 밖이 되면
 * 가장 가까운 글 위치로.
 */
function mapCursor(c: RemoteCursor, tr: Transaction): RemoteCursor {
  const map = (pos: number) => {
    const at = tr.mapping.map(pos, 1)
    const $at = tr.doc.resolve(at)
    if ($at.parent.inlineContent) return at
    return (Selection.findFrom($at, 1, true) ?? Selection.findFrom($at, -1, true))?.head ?? at
  }
  return { ...c, head: map(c.head), anchor: map(c.anchor) }
}

/**
 * 목록에서 그 사람을 골랐을 때 — 상대 위치를 화면 위쪽 1/3 지점으로 스크롤한다(모션 줄이기면 즉시).
 * 스크롤 영역은 본문 스크롤 컨테이너(가장 가까운 세로 overflow 조상), 없으면 문서.
 */
export function scrollToRelative(view: EditorView, json: object): boolean {
  const pos = resolveJson(view.state, json)
  if (pos == null) return false
  const coords = view.coordsAtPos(pos)
  const scroller = nearestClippingAncestor(view.dom, null, 'y') ?? document.scrollingElement
  if (!scroller) return false
  const box =
    scroller === document.scrollingElement ? { top: 0, height: window.innerHeight } : scroller.getBoundingClientRect()
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  scroller.scrollBy({ top: coords.top - box.top - box.height / 3, behavior: reduce ? 'auto' : 'smooth' })
  return true
}

/** 그 접속자들의 이름표를 지금부터 LABEL_SHOW_MS 동안 보인다(목록에서 이동 — 터치 대안). */
export function revealPresence(view: EditorView, clientIds: number[]): void {
  controllers.get(view)?.reveal(clientIds)
}

/**
 * 위치는 그대로이고 활동 횟수(seq)만 오른 내 커서를 다시 알리는 최소 간격(ms) — 문단 중간 타이핑은 캐럿의 상대 위치가 그대로라
 * seq 로만 "움직임" 을 알린다. 글자마다 awareness 를 보내지 않고 이 간격에 한 번(이름표 3초보다 짧아 타이핑하는 동안 이름표가 이어진다).
 * 위치가 바뀌는 움직임(화살표·클릭·줄 끝 타이핑)은 예전처럼 바로 보낸다.
 */
export const SEQ_PUBLISH_MS = 1000

/** 숨김 ref 를 넘기지 않았을 때(늘 보임). */
const NEVER_HIDDEN = { current: false } as const
/** 로그인 사용자 ref 를 넘기지 않았을 때 — 내 로컬 상태의 user 로만 뺀다. */
const NO_SELF_USER = { current: null } as const

export const WikiPresenceCursors = Extension.create<{
  awareness: PresenceAwareness | null
  hiddenRef: { current: boolean } | null
  /** 로그인 사용자 id — 내 다른 탭(같은 userId) 커서를 빼는 기준. 로컬 awareness user 가 아직 없어도 맞게 뺀다. */
  selfUserIdRef: { current: number | null } | null
}>({
  name: 'wikiPresenceCursors',
  addOptions() {
    // ref 기본값은 null 이어야 한다 — tiptap configure 는 기본값과 넘긴 값이 둘 다 일반 객체면 깊은 병합으로 "복사본" 을 만들어,
    // 호출자가 나중에 바꾸는 ref.current 가 확장에 보이지 않는다(기본값이 { current: false } 면 종단 숨김이 영영 반영되지 않는다).
    return { awareness: null, hiddenRef: null, selfUserIdRef: null }
  },
  addProseMirrorPlugins() {
    const awareness = this.options.awareness
    const hiddenRef = this.options.hiddenRef ?? NEVER_HIDDEN
    const selfRef = this.options.selfUserIdRef ?? NO_SELF_USER
    if (!awareness) return []
    const clock = createLabelClock()
    /** 내 활동 횟수(커서 seq) — 내 트랜잭션이 문서·선택을 바꿀 때만 오른다(원격 편집·바인딩 초기화는 y-prosemirror 메타로 거른다). */
    let localSeq = 0
    /** 이 커서의 이름표가 지금 보여야 하는가(위젯을 새로 만들 때) — hover 중인 사람은 view 쪽이 덮어쓴다(applyLabels). */
    const labelOn = (id: number) => clock.visible(id, Date.now())
    const create = (doc: PMNode, list: RemoteCursor[]) =>
      DecorationSet.create(
        doc,
        list.flatMap((c) => cursorDecorations(c, labelOn)),
      )
    /** 다시 그린다 — onChange 가 방금 계산한 그릴 대상(메타)이 있으면 그것을 쓰고, 없으면(초기화·Yjs 쪽 변화) 지금 awareness 에서 읽는다. */
    const build = (state: EditorState, list?: RemoteCursorState[]): DecorationSet =>
      hiddenRef.current
        ? DecorationSet.empty
        : create(state.doc, remoteCursors(state, list ?? remoteCursorStates(awareness, selfRef)))

    return [
      new Plugin<DecorationSet>({
        key: wikiPresenceCursorsKey,
        state: {
          init: (_config, state) => build(state),
          // 다시 계산은 awareness 변화(내 메타)·Yjs 쪽 변화(원격 편집·바인딩 초기화)일 때만, 나머지는 매핑(WikiAiMarkers 와 같은 규칙).
          apply: (tr, old, _prev, state) => {
            // Yjs 쪽에서 온 변화(원격 편집·바인딩 초기화·내 실행 취소)는 문서를 통째로 바꾸므로 다시 계산한다.
            const remote = tr.getMeta(ySyncPluginKey) !== undefined
            // 활동 횟수는 내 입력일 때만 — 내 실행 취소·다시 실행도 내 입력이다(판정 R10, 원격 판정은 isRemoteSyncTr 한곳).
            if (!isRemoteSyncTr(tr) && (tr.docChanged || tr.selectionSet)) localSeq++
            // 메타는 true(다시 걸러 그리기) 또는 onChange 가 계산한 그릴 대상 목록.
            const meta = tr.getMeta(wikiPresenceCursorsKey) as RemoteCursorState[] | true | undefined
            return meta || remote
              ? build(state, Array.isArray(meta) ? meta : undefined)
              : tr.docChanged
                ? create(tr.doc, drawnCursors(old).map((c) => mapCursor(c, tr)))
                : old
          },
        },
        props: {
          decorations: (state) => wikiPresenceCursorsKey.getState(state),
        },
        view: (view) => {
          const lastSig = new Map<number, string>()
          /** 접속자별 마지막으로 본 활동 횟수(seq). */
          const lastSeq = new Map<number, number>()
          /** 이 접속자의 마지막 커서 위치 키·활동 횟수를 적는다(없으면 지운다) — 다음 변경에서 "움직였나" 를 판단할 기준. */
          const remember = (id: number, cursor: CollabCursor | null) => {
            const sig = cursorSignature(cursor)
            if (sig) lastSig.set(id, sig)
            else lastSig.delete(id)
            if (cursor?.seq !== undefined) lastSeq.set(id, cursor.seq)
            else lastSeq.delete(id)
          }
          let lastCursors = cursorsSignature(remoteCursorStates(awareness, selfRef))
          let timer: ReturnType<typeof setTimeout> | null = null
          /** 마우스가 지금 올라가 있는 캐럿(접속자 clientId) — 올라가 있는 동안은 시계와 무관하게 이름표를 켜 둔다. */
          let hovered: number | null = null

          /**
           * 이름표 켜기·끄기를 DOM 에 반영하고, 다음 꺼질 때 다시 부른다. 배치(scheduleFitTags — 다음 프레임 한 번)는 이름표가 실제로
           * 켜지거나 꺼졌을 때와 위젯이 다시 그려졌을 때(relayout)만 — 꺼진 이름표의 옛 배치를 지우고, 그 이름표에 밀려 쌓였던 다른
           * 이름표(✦ 포함)도 제자리로 돌린다. hover 로 계속 켜 두는 동안은 바뀐 것이 없어 다시 재지 않는다.
           */
          const applyLabels = (relayout = false) => {
            if (view.isDestroyed) return
            const now = Date.now()
            let changed = relayout
            for (const el of view.dom.querySelectorAll<HTMLElement>('.wiki-presence-cursor')) {
              const id = Number(el.dataset.clientId)
              const show = el.dataset.ai !== 'true' && (hovered === id || clock.visible(id, now))
              if (show === el.hasAttribute('data-label-visible')) continue
              changed = true
              if (show) el.dataset.labelVisible = ''
              else delete el.dataset.labelVisible
            }
            if (changed) scheduleFitTags(view.dom)
            if (timer) clearTimeout(timer)
            const next = clock.nextChange(now)
            timer = next === null ? null : setTimeout(() => applyLabels(), next)
          }
          const reveal = (ids: number[]) => {
            const now = Date.now()
            ids.forEach((id) => clock.touch(id, now))
            applyLabels()
          }
          controllers.set(view, { reveal })

          /** 마지막으로 내 커서를 보낸 때·seq 만 바뀐 재발행 예약. */
          let publishedAt = 0
          let seqTimer: ReturnType<typeof setTimeout> | null = null
          /** 지금 내 커서를 공개해도 되는가 — 편집 가능 + 포커스 + 숨김 아님. */
          const canShare = () => view.editable && view.hasFocus() && !hiddenRef.current
          /** 마지막 publish 가 본 공개 여부·활동 횟수 — update 가 바뀐 것이 없으면 publish 를 건너뛰는 기준. */
          let lastShare: boolean | null = null
          let lastPublishSeq = -1
          /**
           * 내 커서 발행 — 편집 가능 + 포커스 + 숨김 아님일 때만. 같은 값이면 쓰지 않는다(awareness 방송 절약).
           * 위치가 같고 seq 만 올랐으면(문단 중간 타이핑) SEQ_PUBLISH_MS 에 한 번만 보낸다 — 남은 시간 뒤 한 번 더 부른다.
           */
          const publish = () => {
            const local = awareness.getLocalState()
            if (local == null) return
            const share = canShare()
            lastShare = share
            lastPublishSeq = localSeq
            const relJson = (pos: number) => {
              const r = toRelative(view.state, pos)
              return r ? (Y.relativePositionToJSON(r) as object) : null
            }
            const anchor = share ? relJson(view.state.selection.anchor) : null
            const head = share ? relJson(view.state.selection.head) : null
            const prev = parseCollabCursor(local[COLLAB_CURSOR_FIELD])
            const samePos = cursorSignature(prev) === (anchor && head ? cursorSignature({ anchor, head }) : '')
            if (samePos) {
              if (!prev || prev.seq === localSeq) return
              const wait = publishedAt + SEQ_PUBLISH_MS - Date.now()
              if (wait > 0) {
                seqTimer ??= setTimeout(() => {
                  seqTimer = null
                  if (!view.isDestroyed) publish()
                }, wait)
                return
              }
            }
            if (seqTimer) clearTimeout(seqTimer)
            seqTimer = null
            publishedAt = Date.now()
            awareness.setLocalState({ ...local, [COLLAB_CURSOR_FIELD]: anchor && head ? { anchor, head, seq: localSeq } : null })
          }

          /**
           * 새 상대 위치가 지금 그린 자리와 같은 곳으로 풀리는가 — 내가 지운 글 안의 캐럿을 지운 자리로 옮겨 두면, 상대 화면이 그 삭제를 받아
           * 같은 자리의 새 상대 위치를 다시 알린다. 상대가 움직인 것이 아니므로 이름표를 켜지 않는다.
           */
          const sameAsDrawn = (prev: RemoteCursor | undefined, cursor: CollabCursor | null) => {
            if (!prev || !cursor) return false
            return resolveJson(view.state, cursor.head) === prev.head && resolveJson(view.state, cursor.anchor) === prev.anchor
          }

          const onChange = (changes?: AwarenessChanges) => {
            if (view.isDestroyed) return
            const ids = changes ? [...changes.added, ...changes.updated, ...changes.removed] : []
            if (changes && !ids.some((id) => id !== awareness.clientID)) return
            const states = awareness.getStates()
            const now = Date.now()
            for (const id of changes?.removed ?? []) {
              lastSig.delete(id)
              lastSeq.delete(id)
              clock.forget(id)
              if (hovered === id) hovered = null
            }
            // 그려진 커서 표 — 위치가 바뀐 커서가 있을 때만 만든다(sameAsDrawn 이 커서 있는 접속자에만 쓴다).
            let drawn: Map<number, RemoteCursor> | undefined
            const drawnOf = (id: number) =>
              (drawn ??= new Map(
                drawnCursors(wikiPresenceCursorsKey.getState(view.state) ?? DecorationSet.empty).map((c) => [c.clientId, c]),
              )).get(id)
            for (const id of [...(changes?.added ?? []), ...(changes?.updated ?? [])]) {
              if (id === awareness.clientID) continue
              const cursor = parseCollabCursor(states.get(id)?.[COLLAB_CURSOR_FIELD])
              const sig = cursorSignature(cursor)
              // 움직임 = 위치가 다른 곳으로 바뀜, 또는 활동 횟수(seq)가 바뀜(문단 중간 타이핑은 위치 JSON 이 그대로다). seq 없는 옛 클라이언트는 위치로만.
              const seqMoved = cursor?.seq !== undefined && cursor.seq !== lastSeq.get(id)
              const posMoved = sig !== lastSig.get(id) && !(cursor && sameAsDrawn(drawnOf(id), cursor))
              if (sig && (posMoved || seqMoved)) clock.touch(id, now)
              remember(id, cursor)
            }
            // 그릴 대상은 한 번만 계산해 비교 키와 다시 그리기(메타)에 같이 쓴다.
            const list = remoteCursorStates(awareness, selfRef, states)
            const sig = cursorsSignature(list)
            if (sig === lastCursors) {
              applyLabels()
              return
            }
            lastCursors = sig
            view.dispatch(view.state.tr.setMeta(wikiPresenceCursorsKey, list))
          }
          awareness.on('change', onChange)

          /** 보이는 사람 커서 캐럿 위치(AI 작성 중 제외 — 이름표가 없다). */
          const caretBoxes = () =>
            [...view.dom.querySelectorAll<HTMLElement>('.wiki-presence-cursor')]
              .filter((el) => el.dataset.ai !== 'true')
              .map((el) => {
                const r = el.querySelector('.wiki-presence-cursor__caret')!.getBoundingClientRect()
                return { id: Number(el.dataset.clientId), x: r.left + r.width / 2, top: r.top, bottom: r.bottom }
              })
          /**
           * 마우스 hover — 캐럿에 올라가면(enter) 이름표를 켜고 올라가 있는 동안 계속 보인다. 벗어나면(leave) 그때부터 LABEL_SHOW_MS 뒤 꺼진다.
           * 위젯은 본문 클릭을 가로채지 않게 pointer-events 가 없어 루트에서 좌표로 판정한다.
           */
          const setHovered = (id: number | null) => {
            if (id === hovered) return
            const now = Date.now()
            if (hovered !== null) clock.touch(hovered, now) // 떠난 캐럿 — 지금부터 3초
            if (id !== null) clock.touch(id, now)
            hovered = id
            applyLabels()
          }
          // 판정은 프레임당 한 번 — pointermove 는 프레임보다 자주 오고 판정마다 캐럿 위치를 잰다(강제 레이아웃).
          let lastPoint: { x: number; y: number } | null = null
          let hoverFrame = 0
          const hitTest = () => {
            hoverFrame = 0
            if (view.isDestroyed || !lastPoint) return
            setHovered(hasCursors ? hitCaret(lastPoint, caretBoxes(), CARET_SLOP_MOUSE) : null)
          }
          const scheduleHitTest = () => {
            if (!hoverFrame) hoverFrame = requestAnimationFrame(hitTest)
          }
          const onPointerMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return
            // 원격 커서가 없으면 잴 것도 없다(hover 중이던 커서가 막 사라졌으면 한 번 더 돌아 hover 를 푼다).
            if (!hasCursors && hovered === null) return
            lastPoint = { x: e.clientX, y: e.clientY }
            scheduleHitTest()
          }
          const onPointerLeave = () => {
            lastPoint = null
            setHovered(null)
          }
          // 터치 탭 — hover 가 없으니 캐럿 근처(24px 폭)를 탭하면 이름표 3초. 기본 동작(내 캐럿 이동)은 막지 않는다.
          const onPointerDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse') return
            const id = hitCaret({ x: e.clientX, y: e.clientY }, caretBoxes(), CARET_SLOP_TOUCH)
            if (id !== null) reveal([id])
          }
          view.dom.addEventListener('pointermove', onPointerMove)
          view.dom.addEventListener('pointerleave', onPointerLeave)
          view.dom.addEventListener('pointerdown', onPointerDown)
          view.dom.addEventListener('focusin', publish)
          view.dom.addEventListener('focusout', publish)
          // 처음 그린 이름표(방금 들어온 사람)도 시계에 올린다.
          for (const [id, st] of awareness.getStates()) {
            if (id !== awareness.clientID) remember(id, parseCollabCursor(st?.[COLLAB_CURSOR_FIELD]))
          }
          // 크기가 바뀌면 이름표 배치를 다시 맞춘다 — 관찰자는 루트마다 하나(✦ 표식 확장과 함께 쓴다, observeTagRoot).
          const releaseResize = observeTagRoot(view.dom)
          let lastSet = wikiPresenceCursorsKey.getState(view.state)
          /** 그릴 원격 커서가 있는가 — 없으면 pointermove 판정을 건너뛴다(빈 목록이면 DecorationSet.create 가 empty 를 돌려준다). */
          let hasCursors = lastSet != null && lastSet !== DecorationSet.empty

          return {
            update: (v, prevState) => {
              // 트랜잭션마다 상대 위치 두 번 변환 + 비교는 아깝다 — 문서·선택·공개 여부·내 활동 횟수(seq, R15 문단 중간 타이핑) 중
              // 하나라도 바뀐 때만 발행을 판단한다. 원격 커서 메타 같은 다른 트랜잭션은 내 커서와 무관하다.
              if (
                v.state.doc !== prevState.doc ||
                !v.state.selection.eq(prevState.selection) ||
                localSeq !== lastPublishSeq ||
                canShare() !== lastShare
              ) {
                publish()
              }
              const set = wikiPresenceCursorsKey.getState(v.state)
              if (set === lastSet) return
              lastSet = set
              hasCursors = set != null && set !== DecorationSet.empty
              // 위젯이 새로 그려졌거나 옮겨졌다 — 이름표가 그대로여도 자리를 다시 잰다. 위치·키가 같아도 다시 잰다: 속성만 바뀐 원격 편집(표 열 너비·정렬)은
              // 위치·루트 높이를 그대로 둔 채 캐럿 화면 자리를 옮기고, 이 배치가 ✦ 태그의 원격 편집 뒤 재배치도 겸한다.
              applyLabels(true)
              // 멈춘 마우스 아래에서 캐럿이 옮겨 갔을 수 있다 — hover 를 다시 판정한다.
              if (hovered !== null) scheduleHitTest()
            },
            destroy: () => {
              awareness.off('change', onChange)
              view.dom.removeEventListener('pointermove', onPointerMove)
              view.dom.removeEventListener('pointerleave', onPointerLeave)
              view.dom.removeEventListener('pointerdown', onPointerDown)
              view.dom.removeEventListener('focusin', publish)
              view.dom.removeEventListener('focusout', publish)
              if (timer) clearTimeout(timer)
              if (seqTimer) clearTimeout(seqTimer)
              if (hoverFrame) cancelAnimationFrame(hoverFrame)
              releaseResize()
              cancelFitTags(view.dom)
              controllers.delete(view)
              const local = awareness.getLocalState()
              if (local != null && local[COLLAB_CURSOR_FIELD] != null) awareness.setLocalState({ ...local, [COLLAB_CURSOR_FIELD]: null })
            },
          }
        },
      }),
    ]
  },
})
