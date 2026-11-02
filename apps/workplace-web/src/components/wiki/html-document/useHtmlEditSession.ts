// 「HTML 문서」 편집 잠금·편집 세션(WP-1308) — 「편집」을 누른 한 편집 세션(창 하나)만 원본을 고치고, 다른 사람·창은 저장될 때까지 보기만 한다.
// 잠금 상태 조회, 편집 시작(잠금 얻기 + 이어 고치기 묻기), 편집 중 신호(고치던 소스를 임시 저장본으로), 10분 무입력 종료,
// 잠금을 잃었을 때 종료, 취소·저장 뒤 정리, 「잠금 풀기」를 한곳에 둔다. 화면(WikiHtmlDocumentView)은 결과 상태와 동작만 쓴다.
// 서버는 편집 세션 표지(token)로 잠금을 가른다 — 신호·취소·저장이 「편집」 때 받은 token 을 돌려줘야 이 세션의 것으로 본다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { handleApiError } from '@/lib/api-error'

import { wikiApi } from '../../../api/wiki'
import { wikiKeys } from '../../../hooks/queries/wikiKeys'
import type { WikiHtmlDraftInfo, WikiHtmlLockStatus, WikiPageDetail, WikiRole } from '../../../types/wiki'
import { deriveHtmlLock, holderLabel, HTML_DRAFT_KEPT_TAIL, sameInstant, UNLOCKED_HTML_LOCK } from './wikiHtmlDocument'

/** 편집 중 신호 간격(ms) — 이 사이에 입력이 있었을 때만 보낸다(입력이 없으면 서버의 10분 규칙이 흐른다). 창이 갑자기 닫히면 이만큼까지 잃을 수 있다. */
export const HTML_EDIT_HEARTBEAT_MS = 30_000
/** 입력이 이만큼 없으면 편집을 끝낸다(서버 잠금 만료와 같은 10분). 고치던 내용은 임시 저장본으로 남는다. */
export const HTML_EDIT_IDLE_MS = 10 * 60_000
/** 남이 잠근 동안 잠금 상태를 다시 받는 간격(ms) — 입력이 없어 저절로 풀린 잠금은 알림(SSE)이 없어서 가볍게 다시 본다. */
export const HTML_LOCK_POLL_MS = 60_000

/** 입력이 없어 편집을 끝냈을 때 안내. */
const IDLE_END_MESSAGE = `입력이 10분 동안 없어 편집을 마쳤습니다 — ${HTML_DRAFT_KEPT_TAIL}`

/** 잠금을 잃어 편집을 끝냈을 때 안내 — 누가 가져갔는지(다른 사람·내 다른 창) 또는 풀렸는지. */
function lostLockMessage(lock: WikiHtmlLockStatus): string {
  const who = !lock.locked ? '편집 잠금이 풀려' : lock.mine ? '다른 창에서 편집을 시작해' : `${holderLabel(lock)} 님이 편집을 시작해`
  return `${who} 내 편집이 끝났습니다 — ${HTML_DRAFT_KEPT_TAIL}`
}

/**
 * 「HTML 문서」 편집 잠금 상태. 남이 잠근 동안만 {@link HTML_LOCK_POLL_MS} 마다 다시 받는다(바뀌면 SSE wiki.page.lock 이 캐시를 바로 바꾼다).
 * mine·canForceRelease 는 내 id·스페이스 역할로 가린다(SSE 가 넣은 캐시에는 쥔 사람만 있다 — deriveHtmlLock).
 */
export function useWikiHtmlLock(pageId: number, enabled: boolean, viewer: { userId?: number; role?: WikiRole }) {
  const { userId, role } = viewer
  const select = useCallback((s: WikiHtmlLockStatus) => deriveHtmlLock(s, userId, role), [userId, role])
  return useQuery<WikiHtmlLockStatus, Error, WikiHtmlLockStatus>({
    queryKey: wikiKeys.htmlLock(pageId),
    queryFn: () => wikiApi.getHtmlLock(pageId).then((r) => r.data),
    enabled,
    staleTime: 0,
    select,
    refetchInterval: (q) => (q.state.data?.locked && q.state.data.holderId !== userId ? HTML_LOCK_POLL_MS : false),
  })
}

/** 고치는 중인 소스 — 고치기 시작한 version 을 기준으로 저장한다(그사이 남이 저장했으면 409 로 알린다). edited: 저장된 원본과 달라졌는지(이어 고치기면 처음부터 true). */
export type HtmlEditing = { html: string; baseVersion: number; edited: boolean }

/** 이어 고칠지 묻는 중 — 남아 있던 내 임시 저장본과 편집을 시작하며 다시 받은 페이지. */
export type HtmlResumePrompt = { draft: WikiHtmlDraftInfo; fresh: WikiPageDetail }

/** 쥐고 있는 편집 세션 — 서버가 준 표지와 쥔 사람·잠금 시작 시각(캐시의 잠금이 아직 이 세션인지 가린다 — 같은 사람의 다른 창이 가져가면 시각이 바뀐다). */
type LockSession = { token: string; holderId: number | null; acquiredAt: string | null }

/** 잠금 상태가 이 세션의 잠금인지 — 쥔 사람과 시작 시각이 같다. */
function isSessionLock(lock: WikiHtmlLockStatus | undefined, s: LockSession): boolean {
  return lock?.locked === true && lock.holderId === s.holderId && sameInstant(lock.acquiredAt, s.acquiredAt)
}

/**
 * 편집 세션. editing 이 있으면 이 창이 잠금을 쥐고 고치는 중이다.
 * - start: 잠금을 얻고 페이지를 다시 받아(최신 원본·version 으로 시작) 남은 임시 저장본이 지금 원본과 다르면 resume 으로 묻는다.
 * - change: 입력 — 다음 신호 때 임시 저장본으로 보낸다.
 * - cancel: 잠금을 풀고 임시 저장본도 지운다. lockToken: 편집 「저장」에 실을 표지. finishSaved: 저장 성공 뒤(서버가 이미 풀었다) 화면만 정리한다.
 * - 입력이 10분 없거나, 잠금이 이 세션 것이 아니게 됐거나(강제 풀기·남·내 다른 창), 화면을 떠나면 편집을 끝내고 내용은 임시 저장본으로 남긴다.
 * - forceRelease: 「잠금 풀기」(스페이스 소유자) — 편집하던 사람의 내용은 그 사람의 임시 저장본으로 남는다.
 *
 * lock 은 useWikiHtmlLock 의 결과, userId 는 나다. saving 인 동안은 잠금을 잃은 것으로 보지 않는다 — 내 저장이 푼 잠금의 알림이 저장 응답보다 먼저 와도 「잠금이 풀려
 * 편집이 끝났다」고 잘못 알리지 않게(저장이 끝나면 finishSaved 가 정리한다).
 */
export function useHtmlEditSession(
  pageId: number,
  { lock, saving, userId }: { lock: WikiHtmlLockStatus | undefined; saving: boolean; userId: number | undefined },
) {
  const qc = useQueryClient()
  // 상태와 ref 를 함께 바꾼다 — 타이머·정리 콜백은 렌더를 기다리지 않고 ref 로 지금 값을 본다(끝낸 직후 도착한 잠금 상태를 「잃음」으로 오해하지 않게).
  const [editing, setEditingState] = useState<HtmlEditing | null>(null)
  const editingRef = useRef<HtmlEditing | null>(null)
  const setEditing = useCallback((next: HtmlEditing | null) => {
    editingRef.current = next
    setEditingState(next)
  }, [])
  const [resume, setResume] = useState<HtmlResumePrompt | null>(null)
  // 쥔 편집 세션 — 「편집」 성공부터 저장·취소·끝내기까지(이어 고칠지 묻는 동안도 쥐고 있다).
  const sessionRef = useRef<LockSession | null>(null)
  // 마지막 입력 시각·마지막 신호 뒤 입력이 있었는지·마지막으로 서버에 남긴 소스 — 렌더와 무관한 타이머 판정용이라 ref 에 둔다.
  const lastInputAt = useRef(0)
  const unsent = useRef(false)
  const lastSentHtml = useRef<string | null>(null)

  // 잠금 캐시가 아직 이 세션 것이면 「풀림」으로 바꾼다(내가 풀었다) — 그사이 남·다른 창이 가져갔으면 그 상태를 그대로 둔다.
  const clearOwnLock = useCallback(
    (s: LockSession) =>
      qc.setQueryData<WikiHtmlLockStatus>(wikiKeys.htmlLock(pageId), (old) =>
        isSessionLock(old, s) ? UNLOCKED_HTML_LOCK : old,
      ),
    [pageId, qc],
  )

  // 편집 중 신호 — 마지막으로 남긴 소스와 같으면 소스 없이(시각만 미룬다) 보낸다. 남기면 lastSentHtml 을 바꾼다.
  const sendHeartbeat = useCallback(
    (s: LockSession, cur: HtmlEditing) => {
      const html = cur.html === lastSentHtml.current ? undefined : cur.html
      return wikiApi
        .heartbeatHtmlLock(pageId, { token: s.token, ...(html != null ? { html, baseVersion: cur.baseVersion } : {}) })
        .then((r) => {
          if (html != null && r.data.mine) lastSentHtml.current = html
          return r.data
        })
    },
    [pageId],
  )

  // 세션을 놓는다 — 마지막 신호 뒤 입력이 있었으면 먼저 신호로 남기고(「이어서 고칠 수 있어요」가 최대 한 간격 분량을 잃지 않게) 잠금만 푼다(임시 저장본은 남긴다).
  // 편집 끝내기(무입력·잠금 잃음·묻는 창 닫기)와 화면 떠나기가 함께 쓴다. 세션이 이미 넘어갔으면 서버가 둘 다 거절한다(다른 창의 잠금·저장본을 건드리지 않는다).
  const flushAndRelease = useCallback(
    (cur: HtmlEditing | null) => {
      const s = sessionRef.current
      sessionRef.current = null
      if (!s) return
      const flush = cur && unsent.current ? sendHeartbeat(s, cur).catch(() => undefined) : Promise.resolve()
      unsent.current = false
      void flush
        .then(() => wikiApi.releaseHtmlLock(pageId, { keepDraft: true, token: s.token }))
        .then(() => clearOwnLock(s))
        .catch(() => undefined)
    },
    [pageId, sendHeartbeat, clearOwnLock],
  )

  // 편집을 끝내고 내용은 임시 저장본으로 남긴다(잠금만 푼다). 입력이 없을 때·잠금을 잃었을 때·묻는 창을 답 없이 닫을 때.
  const endKeepingDraft = useCallback(
    (message?: string) => {
      const cur = editingRef.current
      setEditing(null)
      setResume(null)
      flushAndRelease(cur)
      if (message) toast.info(message)
    },
    [flushAndRelease, setEditing],
  )

  const begin = useCallback(
    (html: string, baseVersion: number, fromDraft = false) => {
      lastInputAt.current = Date.now()
      // 이어 고치면 지금 소스를 다음 신호에 그대로 남긴다(새 base 로). 새로 시작하면 입력 전까지 보낼 것이 없다.
      unsent.current = fromDraft
      lastSentHtml.current = null
      setResume(null)
      setEditing({ html, baseVersion, edited: fromDraft })
    },
    [setEditing],
  )

  const start = useMutation({
    mutationFn: async () => {
      const acquired = (await wikiApi.acquireHtmlLock(pageId)).data
      // 잠금을 얻은 뒤의 원본·version 으로 시작한다 — 캐시가 낡았으면 남의 저장을 덮지 않게.
      // 원본을 못 받으면 편집을 시작하지 못하니 얻은 잠금을 바로 돌려준다(남이 10분 동안 막히지 않게).
      try {
        const fresh = (await wikiApi.getPage(pageId)).data
        return { acquired, fresh }
      } catch (e) {
        await wikiApi.releaseHtmlLock(pageId, { keepDraft: true, token: acquired.token }).catch(() => undefined)
        throw e
      }
    },
    onSuccess: ({ acquired, fresh }) => {
      sessionRef.current = { token: acquired.token, holderId: acquired.lock.holderId, acquiredAt: acquired.lock.acquiredAt }
      qc.setQueryData(wikiKeys.page(pageId), fresh)
      qc.setQueryData(wikiKeys.htmlLock(pageId), acquired.lock)
      const draft = acquired.draft
      if (draft && draft.html !== (fresh.html ?? '')) setResume({ draft, fresh })
      else begin(fresh.html ?? '', fresh.version)
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: wikiKeys.htmlLock(pageId) })
      handleApiError(e, '편집을 시작하지 못했습니다')
    },
  })

  /** 이어 고칠지 답한다 — true 면 임시 저장본, false 면 지금 원본으로 시작. 기준은 다시 받은 지금 version(알린 뒤라 그사이 저장을 덮어도 된다 — 먼저 저장된 내용은 버전 기록에 남는다). */
  const answerResume = (continueDraft: boolean) => {
    if (!resume) return
    const { draft, fresh } = resume
    if (continueDraft) begin(draft.html, fresh.version, true)
    else begin(fresh.html ?? '', fresh.version)
  }

  /** 묻는 창을 답 없이 닫으면 편집을 시작하지 않는다 — 잠금만 풀고 임시 저장본은 그대로 둔다. */
  const dismissResume = () => endKeepingDraft()

  const change = (html: string) => {
    const cur = editingRef.current
    if (!cur) return
    lastInputAt.current = Date.now()
    unsent.current = true
    setEditing({ ...cur, html, edited: true })
  }

  const cancel = () => {
    const s = sessionRef.current
    sessionRef.current = null
    setEditing(null)
    if (!s) return
    void wikiApi
      .releaseHtmlLock(pageId, { token: s.token })
      .then(() => clearOwnLock(s))
      .catch((e) => {
        handleApiError(e, '편집을 취소하지 못했습니다')
        void qc.invalidateQueries({ queryKey: wikiKeys.htmlLock(pageId) })
      })
  }

  /**
   * 저장이 version 충돌(409)로 막힌 뒤 다시 받은 version 으로 기준을 옮긴다 — 다음 「저장」이 같은 409 에 갇히지 않게.
   * 잠금을 쥔 동안엔 서버가 다른 쓰기를 모두 막으므로, 이 409 는 「편집」으로 잠금을 얻기 직전에 끼어든 저장(얻기와 원본 다시 받기 사이)에서만 생긴다.
   * 그 저장은 버전 기록에 남으니 알린 뒤 다시 저장하면 덮어도 된다.
   */
  const rebase = (baseVersion: number) => {
    const cur = editingRef.current
    if (cur) setEditing({ ...cur, baseVersion })
  }

  /** 편집 「저장」에 실을 이 세션의 표지 — 맞으면 서버가 저장과 함께 잠금을 풀고 임시 저장본을 지운다. */
  const lockToken = () => sessionRef.current?.token

  const finishSaved = () => {
    const s = sessionRef.current
    sessionRef.current = null
    setEditing(null)
    if (s) clearOwnLock(s)
  }

  // 「잠금 풀기」(스페이스 소유자) — 풀리면 캐시를 바로 「풀림」으로 바꾼다(SSE 도 같은 상태를 보낸다). 실패하면 지금 상태를 다시 받는다.
  const forceRelease = useMutation({
    mutationFn: () => wikiApi.releaseHtmlLock(pageId, { force: true }),
    onSuccess: () => qc.setQueryData(wikiKeys.htmlLock(pageId), UNLOCKED_HTML_LOCK),
    onError: (e) => {
      handleApiError(e, '잠금을 풀지 못했습니다')
      void qc.invalidateQueries({ queryKey: wikiKeys.htmlLock(pageId) })
    },
  })

  const isEditing = editing != null
  // 고친 내용이 있으면 탭 닫기·새로고침을 경고하고, 다른 창의 새 버전 자동 새로고침이 편집을 날리지 않게 「저장 안 한 입력」으로 등록한다.
  useUnsavedChangesWarning(editing?.edited === true)

  // 편집 중 신호·10분 무입력 판정 — 편집하는 동안만 돈다. 신호 응답이 mine=false 면(잠금을 잃음 — 내 다른 창이 가져간 경우는 이것으로만 안다) 편집을 끝낸다.
  useEffect(() => {
    if (!isEditing) return
    const timer = setInterval(() => {
      const cur = editingRef.current
      const s = sessionRef.current
      if (!cur || !s) return
      if (Date.now() - lastInputAt.current >= HTML_EDIT_IDLE_MS) {
        endKeepingDraft(IDLE_END_MESSAGE)
        return
      }
      if (!unsent.current) return
      unsent.current = false
      sendHeartbeat(s, cur)
        .then((status) => {
          if (sessionRef.current !== s) return
          qc.setQueryData(wikiKeys.htmlLock(pageId), status)
          // 신호 응답의 mine 은 세션으로 가린다 — 안내 문구(내 다른 창인지)는 쥔 사람으로 다시 가린다.
          if (!status.mine) endKeepingDraft(lostLockMessage(deriveHtmlLock(status, userId, undefined)))
        })
        .catch(() => {
          // 신호가 실패하면(연결 끊김) 다음 간격에 다시 보낸다.
          unsent.current = true
        })
    }, HTML_EDIT_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [isEditing, pageId, qc, userId, endKeepingDraft, sendHeartbeat])

  // 편집 중인데 잠금 캐시가 이 세션 것이 아니게 됐다(SSE·다시 받은 상태 — 소유자가 풀었거나 남·내 다른 창이 시작함) — 편집을 끝내고 내용은 임시 저장본으로 남긴다.
  // 이 세션인지는 쥔 사람과 시작 시각으로 가린다 — 내 다른 창이 가져가면 쥔 사람은 같지만 시작 시각이 바뀐다.
  useEffect(() => {
    const s = sessionRef.current
    if (!isEditing || saving || !lock || !s) return
    if (isSessionLock(lock, s)) return
    endKeepingDraft(lostLockMessage(lock))
  }, [lock, isEditing, saving, endKeepingDraft])

  // 화면을 떠나면(다른 페이지로 이동) 고치던 내용을 남기고 잠금을 푼다 — 다른 사람이 10분을 기다리지 않게. 이어 고칠지 묻는 중이었어도 쥔 잠금을 푼다.
  useEffect(() => () => flushAndRelease(editingRef.current), [flushAndRelease])

  return { editing, resume, start, answerResume, dismissResume, change, cancel, rebase, lockToken, finishSaved, forceRelease }
}
