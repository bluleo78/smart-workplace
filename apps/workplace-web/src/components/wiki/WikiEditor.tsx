import './wiki-editor.css'

import { COLLAB_FRAGMENT, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { useQueryClient } from '@tanstack/react-query'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation,useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as Y from 'yjs'

import { AiLabel } from '@/components/ai/AiLabel'
import { Page, pageBodyInsetClass, pageReadingWidthClass } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { cn } from '@/lib/utils'

import {
  useWikiEntitySearch,
  type WikiEntityCandidate,
} from '../../hooks/queries/useWikiEntitySearch'
import { useWikiMentions } from '../../hooks/queries/useWikiMentions'
import { useDeletePage, useSaveTitle } from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { syncWikiSummaryVersion } from '../../hooks/queries/useWikiSummary'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import { useAuth } from '../../hooks/useAuth'
import { useCollabSession } from '../../hooks/useCollabSession'
import { startWikiAiStream } from '../../hooks/useWikiAiStream'
import { handleApiError } from '../../lib/api-error'
import { isEditRole } from '../../lib/collab/collabStatus'
import type { WikiMentionRef, WikiMentionType, WikiPageDetail } from '../../types/wiki'
import { registerWikiEditorView, useWikiImageUpload } from './useWikiImageUpload'
import { type GenerateActionKey, type TransformActionKey } from './wikiAiActions'
import { WikiAiBubbleToolbar } from './WikiAiBubbleToolbar'
import { insertAiMarkdown } from './wikiAiInsert'
import { WikiAiMarkers } from './wikiAiMarkers'
import { announceAiWriting } from './wikiAiPresence'
import { stripLeadingTitleHeading } from './wikiAiTitleHeading'
import { WikiBacklinksPanel } from './WikiBacklinksPanel'
import { buildBreadcrumb } from './wikiBreadcrumb'
import { anchorPosition, toRelative } from './wikiCollabPosition'
import { type CreatedIssue,WikiCreateIssueDialog } from './WikiCreateIssueDialog'
import { WikiDeletePageDialog } from './WikiDeletePageDialog'
import { WikiImage } from './wikiImageNode'
import { WikiMarkdownSourceDialog } from './WikiMarkdownSourceDialog'
import { rememberMentionLabel, WikiMentionLabelsProvider } from './wikiMentionLabels'
import { WikiMention } from './wikiMentionNode'
import { createWikiMentionExtension } from './wikiMentionSuggestion'
import { type WikiAiState, WikiPageHeader } from './WikiPageHeader'
import { WikiPageSkeleton } from './WikiPageSkeleton'
import type { WikiAiAction } from './WikiSlashMenu'
import { createWikiSlashExtension } from './wikiSlashSuggestion'
import { WikiSummaryCard } from './WikiSummaryCard'
import { WikiSyncNotice, WikiSyncUnreachable } from './WikiSyncNotice'
import { WikiTableContextMenu } from './WikiTableContextMenu'
import { createWikiTableShortcuts } from './wikiTableShortcuts'
import { WikiTableToolbar } from './WikiTableToolbar'
import { createTitleSaver, initTitleSync, needsTitleSave, type TitleSaver, titleSyncReducer } from './wikiTitleSync'
import { WikiUploadPlaceholder } from './wikiUploadPlaceholder'

/** 제목 저장 디바운스 — 제목은 짧은 REST 저장(나중 값 우선)이라 타이핑마다 보내지 않고 잠깐 모아 보낸다. */
const TITLE_SAVE_DEBOUNCE_MS = 400

/**
 * 위키 에디터 — 본문은 동기화 서버와 실시간으로 주고받고(Yjs, WP-287), 제목은 짧은 REST 저장 + 인에디터 /ai 스트리밍.
 * 예전의 0.8초 자동저장·버전 충돌 배너·"최신 내용 불러오기"는 실시간 동기화로 대체돼 없다.
 */
export function WikiEditor({ page, spaceId }: { page: WikiPageDetail; spaceId: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  const saveTitle = useSaveTitle(spaceId)
  const del = useDeletePage(spaceId)
  const { data: tree } = useWikiTree(spaceId)
  // 브레드크럼 — 이미 로드된 전체 트리에서 파생(추가 API 없음).
  const crumbs = useMemo(() => buildBreadcrumb(tree ?? [], page.id), [tree, page.id])
  // 현재 페이지의 하위 페이지 존재 여부 — 트리에서 parentId 가 일치하는 항목 유무로 판단.
  const pageHasChildren = useMemo(
    () => (tree ?? []).some((p) => p.parentId === page.id),
    [tree, page.id],
  )
  // 현재 페이지 삭제 확인 다이얼로그 상태.
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 마크다운 소스 모달(#753). 마크다운은 모달을 열 때 1회 스냅샷으로 만든다.
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceMarkdown, setSourceMarkdown] = useState('')
  // 제목 — 입력 중엔 내 입력을, 아니면 원격(캐시) 제목을 보인다. 판정 규칙은 wikiTitleSync 참조.
  const [titleSync, dispatchTitle] = useReducer(titleSyncReducer, page.title, initTitleSync)
  const title = titleSync.local
  // 원격 제목(SSE·저장 응답이 캐시에 쓴 값) 변화를 판정기에 알린다.
  useEffect(() => {
    dispatchTitle({ type: 'remote', title: page.title, now: Date.now() })
  }, [page.title])
  // AI 결과의 제목 H1 제거 판정용 최신 제목(편집 중 미저장분 포함) — 스트림 완료 콜백이 렌더 밖에서 읽는다.
  const titleRef = useRef(title)
  useEffect(() => {
    titleRef.current = title
  })

  // 역할 게이트 — OWNER|EDITOR 만 /ai 슬래시 사용. VIEWER 면 메뉴 미노출.
  const { data: spaces, isPending: spacesPending } = useWikiSpaces()
  const role = spaces?.find((s) => s.id === spaceId)?.role
  // 화면이 아는 역할로 정한 편집 가능 여부(= /ai 사용 가능) — 실제 편집 가능 여부는 아래 동기화 세션이 최종 판정한다.
  const roleCanEdit = role != null && isEditRole(role)

  // 실시간 동기화 세션(WP-287) — 페이지별 캐시라 셸 전환 재마운트에도 연결·미전송분이 유지된다.
  // readOnly 는 서버가 알려 온 역할 변경(VIEWER 강등·EDITOR 승격)과 종료 상태(forbidden)까지 반영한 값이라
  // 편집 게이트는 모두 이것을 따른다(화면 역할 roleCanEdit 만 보면 강등돼도 입력이 되고, 서버가 버린다).
  // ready=false 는 새 세션의 첫 동기화 전 — 문서가 아직 비어 있어 본문 대신 skeleton 을 보이고 본문 편집을 막는다
  // (빈 에디터의 "내용을 입력하거나…" 안내가 동기화 전 입력을 유도하지 않게). 이미 동기화된 캐시 세션은 처음부터 ready.
  // body='unreachable' 은 첫 연결이 끝내 안 된 경우 — skeleton 대신 안내를 보이고(재시도는 계속), 여전히 본문 편집은 막는다.
  const { session, status: syncStatus, readOnly, body } = useCollabSession(page.id, { readOnly: !roleCanEdit })
  const ready = body === 'ready'
  // 본문 편집 가능 — 권한(readOnly)과 첫 동기화(ready) 둘 다. 제목은 REST 라 readOnly 만 본다.
  const canEdit = !readOnly && ready
  // 헤더 AI 버튼용 3분기 — 로딩(권한 확인 중)과 거부(읽기 전용)를 구분해 사유를 노출한다.
  // 서버가 VIEWER 로 강등했으면(readOnly) 화면 역할과 무관하게 거부.
  // 예전엔 canUseAi=false 하나로 뭉쳐 메뉴를 숨겨서, 스페이스 목록이 아직 안 온 순간에도
  // AI 가 "없는 기능"처럼 보였다(#733).
  // 첫 동기화 전엔 거부가 아니라 아직 준비 중(loading) — 본문이 없어 AI 삽입 위치도 없다.
  const aiState: WikiAiState = spacesPending || !ready ? 'loading' : roleCanEdit && canEdit ? 'ready' : 'denied'

  // @ 통합 멘션 — suggestion 쿼리(현재 '@' 뒤 텍스트) state. 빈 문자열이면 검색 비활성.
  const [mentionQuery, setMentionQuery] = useState('')
  // useWikiEntitySearch 결과를 확장이 읽을 candidatesRef 에 동기화 + 열린 팝업 refresh.
  const { data: mentionCandidates } = useWikiEntitySearch(mentionQuery, spaceId)
  const candidatesRef = useRef<WikiEntityCandidate[]>([])
  const mentionRefreshRef = useRef<() => void>(() => {})
  const canEditRef = useRef(canEdit)
  useEffect(() => {
    canEditRef.current = canEdit
  })
  // 후보가 도착하면 candidatesRef 갱신 후 열린 팝업을 강제 리렌더(비동기 브리지).
  useEffect(() => {
    candidatesRef.current = mentionCandidates ?? []
    mentionRefreshRef.current()
  }, [mentionCandidates])

  // 멘션 확장 — 마운트 시 1회 생성. ctx ref 는 suggestion 콜백에서만 역참조되며 사용자가 '@' 를
  // 입력할 때 ProseMirror 가 호출하므로 렌더 시점에 동기 실행되지 않아 안전하다(슬래시 확장과 동일 —
  // react-hooks/refs 의 보수적 false positive). onQueryChange 는 '@' 타이핑 시 검색 쿼리 state 갱신.
  const mentionExtension = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      createWikiMentionExtension({
        canEditRef,
        candidatesRef,
        onQueryChange: (q) => setMentionQuery(q),
        refresh: mentionRefreshRef,
      }),
    [],
  )

  // AI 생성 진행 상태 + 진행 중 스트림 abort 핸들.
  const [aiBusy, setAiBusy] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  // draft 토픽 입력 다이얼로그 상태. 빈 상태의 "AI 초안으로 시작" 으로 만들어진 페이지면
  // 라우터 state 표식(wikiAiDraft)을 보고 처음부터 열린 채로 시작한다(#733). 이 컴포넌트는
  // key={page.id} 로 리마운트되므로 lazy 초기값으로 충분하다(effect 불필요).
  // 권한 게이트를 두지 않는 이유: 방금 그 스페이스에 페이지를 만든 사용자이므로 쓰기 권한이 자명하다.
  const [draftOpen, setDraftOpen] = useState(
    () => (location.state as { wikiAiDraft?: boolean } | null)?.wikiAiDraft === true,
  )
  // 노트→이슈 다이얼로그 상태 + 캡처한 선택(제목/본문/삽입 위치).
  // insertAt 은 다이얼로그를 여는 동안 원격 편집에 밀리지 않게 상대 위치로 붙잡아 둔 값(anchorPosition).
  const [issueDialog, setIssueDialog] = useState<{
    open: boolean
    title: string
    body: string
    insertAt: ((current: Editor) => number) | null
  }>({ open: false, title: '', body: '', insertAt: null })

  // 슬래시 확장은 게이트로 위의 canEditRef 를 그대로 재사용한다 — 메뉴에 AI 가 아닌 표 삽입이
  // 들어오며(#748) 게이트 의미가 "편집 가능"이 됐고, AI 게이트(roleCanEdit)와 canEdit 는 원래부터 같은 역할 규칙이라
  // 별도 ref 를 두면 이름만 다른 중복이 된다.

  // AI 사용 이력(aiLastUsedAt)은 서버가 스트림 완료 직전에 기록하고 SSE 를 보내지 않는다 — 예전엔 뒤따르는 자동저장 응답이
  // 페이지 캐시를 갱신했지만 이제 본문 저장이 없으므로, 완료 시 페이지를 다시 불러와 헤더 "AI 생성 포함" 배지를 맞춘다(WP-287).
  // 본문은 에디터가 동기화 문서에서만 읽으므로(useEditor deps 에 page.body 없음) 재조회가 에디터를 건드리지 않는다.
  const queryClient = useQueryClient()
  const refreshAiAttribution = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wikiKeys.page(page.id) })
  }, [queryClient, page.id])

  // /ai 생성 중 ✦ 표식(WP-291) — 다른 접속자 화면의 삽입 위치에 "✦ 내 이름" 을 고정한다. 한 번에 하나(latest action wins).
  // 각 실행은 startAiPresence 가 돌려준 자기 stop 으로만 내린다 — 공유 ref 로 내리면 이미 대체된 이전 스트림의 늦은 onDone/onError 가
  // 새 스트림의 표식을 지워 버린다(abortRef 와 같은 함정). 취소·다음 액션·언마운트는 track 이 abortRef 에 묶은 stop 으로 내린다
  // (동기화 세션은 페이지별 캐시라 연결이 남아, 화면을 떠날 때 내리지 않으면 상대 화면에 계속 고정된다).
  const { user } = useAuth()
  const startAiPresence = useCallback(
    (ed: Editor, pos: number): (() => void) => {
      // 상대 위치로 올려야 생성 중 누가 위쪽을 고쳐도 받는 쪽이 삽입 위치를 따라 그린다(결과는 done 때 한 번에 넣으므로 그 사이 움직일 일은 원격·로컬 편집뿐).
      const rel = toRelative(ed.state, pos)
      if (!user || !rel) return () => {}
      return announceAiWriting(session.provider, { userId: user.id, name: user.name }, Y.relativePositionToJSON(rel))
    },
    [session.provider, user],
  )
  /** 진행 중 스트림을 abortRef 에 건다 — 취소(ESC·버튼)·다음 액션·언마운트는 모두 이 abort 를 거치며 표식도 함께 내린다. */
  const track = useCallback((handle: { abort: () => void }, stopPresence: () => void) => {
    abortRef.current = () => {
      handle.abort()
      stopPresence()
    }
  }, [])

  // WP-301 요약 캐시를 노트의 새 버전에 맞춘다(낡음 표시·짧던 노트가 길어지면 재조회). 예전엔 자동저장 응답·원격 반영에서 맞췄지만
  // 이제 본문은 동기화 서버가 파생 저장(version+1)하고 에디터는 wiki.page.updated → 페이지 재조회로만 새 version 을 안다(WP-287).
  // 제목만 저장·상태만 저장은 version 을 올리지 않아 요약을 낡게 만들지 않는다. 같은/옛 version 은 sync 가 무시하므로 마운트·self-echo 는 무해하다.
  useEffect(() => {
    syncWikiSummaryVersion(queryClient, page.id, page.version)
  }, [queryClient, page.id, page.version])

  // action → startWikiAiStream 트리거. continue 는 즉시, draft 는 토픽 입력 후.
  // 스트림을 버퍼링했다가 done 시 1회 삽입한다(WP-255, runTransform 과 같은 방식). 토큰마다 insertContent 하면
  // tiptap-markdown 이 조각마다 따로 파싱해 `**목`/`적**` 처럼 쪼개진 서식·표가 기호로 남고, `- ` 가 목록 안
  // 커서에서 다시 파싱돼 목록이 계단식으로 중첩됐다. 생성 중에는 하단 "생성 중…" 표시·헤더 스피너가 진행을 알린다.
  const runAction = useCallback(
    (action: WikiAiAction, prompt?: string) => {
      const ed = editorRef.current
      if (!ed) return
      // 진행 중 스트림이 있으면 먼저 중단(latest action wins). 이렇게 하지 않으면 두 스트림의
      // 결과가 함께 삽입되고, abortRef 가 덮어써져 이전 스트림이 취소 불가가 되며,
      // 먼저 끝난 스트림의 onDone 이 아직 진행 중인 스트림의 aiBusy/abortRef 를 지워버린다.
      abortRef.current?.()
      abortRef.current = null
      // 삽입 위치는 시작 시점의 커서(슬래시 메뉴를 연 자리·헤더 액션의 본문 끝)로 고정한다.
      // 생성 중 다른 사람이 위쪽을 고칠 수 있어 숫자 위치 대신 동기화 문서의 상대 위치로 붙잡아 둔다.
      const { from, to } = ed.state.selection
      const fromAt = anchorPosition(ed, from)
      const toAt = anchorPosition(ed, to)
      const stopPresence = startAiPresence(ed, from)
      setAiBusy(true)
      let buffer = ''
      const handle = startWikiAiStream({
        pageId: page.id,
        action,
        prompt,
        onDelta: (text) => {
          buffer += text
        },
        onDone: () => {
          stopPresence()
          setAiBusy(false)
          abortRef.current = null
          refreshAiAttribution()
          const e2 = editorRef.current
          // 모델이 페이지 제목을 H1 으로 반복하면 본문 밖 제목 입력란과 이중으로 보인다 — 삽입 전에 걷어낸다.
          const content = stripLeadingTitleHeading(buffer, titleRef.current)
          // 생성 중 읽기 전용으로 바뀌었으면(VIEWER 강등) 넣지 않는다 — 서버가 받지 않는 편집이라 내 화면만 어긋난다.
          if (!e2 || !content.trim() || !canEditRef.current) return
          // 전체 결과를 한 번에 마크다운 파싱·삽입(단일 트랜잭션 → 단일 undo). 로컬 편집이라 동기화로 모두에게 전파된다.
          insertAiMarkdown(e2, fromAt(e2), toAt(e2), content)
        },
        onError: (message) => {
          stopPresence()
          setAiBusy(false)
          abortRef.current = null
          toast.error(message)
        },
      })
      track(handle, stopPresence)
    },
    [page.id, refreshAiAttribution, startAiPresence, track],
  )

  // 변형 액션(선택영역 제자리 교체) — 스트림을 버퍼링했다가 done 시 1회 교체(단일 undo).
  // 생성 계열(runAction)과 달리 선택 텍스트를 입력으로 보내고 결과로 그 범위를 대체한다.
  const runTransform = useCallback(
    (action: TransformActionKey, param?: string) => {
      const ed = editorRef.current
      if (!ed) return
      const { from, to } = ed.state.selection
      if (from === to) return // 선택 없음 — 방어(툴바는 선택 시에만 노출)
      const selection = ed.state.doc.textBetween(from, to, '\n')
      // 생성 중 원격 편집에 밀리지 않게 상대 위치로 붙잡아 둔다(runAction 과 같은 이유).
      const fromAt = anchorPosition(ed, from)
      const toAt = anchorPosition(ed, to)
      abortRef.current?.()
      abortRef.current = null
      const stopPresence = startAiPresence(ed, from)
      setAiBusy(true)
      let buffer = ''
      const handle = startWikiAiStream({
        pageId: page.id,
        action,
        prompt: param,
        selection,
        onDelta: (text) => {
          buffer += text
        },
        onDone: () => {
          stopPresence()
          setAiBusy(false)
          abortRef.current = null
          refreshAiAttribution()
          const e2 = editorRef.current
          if (!e2 || !buffer || !canEditRef.current) return
          // 캡처한 범위를 결과로 1회 교체(삭제+삽입 단일 트랜잭션 → 단일 undo).
          insertAiMarkdown(e2, fromAt(e2), toAt(e2), buffer)
        },
        onError: (message) => {
          stopPresence()
          setAiBusy(false)
          abortRef.current = null
          toast.error(message)
        },
      })
      track(handle, stopPresence)
    },
    [page.id, refreshAiAttribution, startAiPresence, track],
  )

  // "이슈로 만들기" — 선택 텍스트를 제목(첫 줄)/본문으로, 삽입 위치(선택 끝)를 캡처해 다이얼로그를 연다.
  const onCreateIssue = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { from, to } = ed.state.selection
    if (from === to) return
    const selected = ed.state.doc.textBetween(from, to, '\n')
    const firstLine = selected.split('\n').find((l) => l.trim()) ?? selected
    setIssueDialog({ open: true, title: firstLine.trim().slice(0, 200), body: selected, insertAt: anchorPosition(ed, to) })
  }, [])

  // 이슈 생성 성공 → 삽입 위치에 ISSUE 멘션 칩 + 공백 삽입.
  // 저장 시 <#issue:id> 토큰으로 직렬화돼 WikiReferenceParser 가 wiki_reference 에 링크를 기록한다.
  const onIssueCreated = useCallback(
    (issue: CreatedIssue) => {
      const ed = editorRef.current
      if (!ed || !issueDialog.insertAt) return
      // 노드엔 라벨이 없으므로(WP-294) 삽입 전에 기억해 둬야 멘션 재조회 전에도 칩 라벨이 보인다.
      rememberMentionLabel('ISSUE', issue.id, `${issue.projectKey}-${issue.number} ${issue.title}`)
      toast.success(`${issue.projectKey}-${issue.number} 이슈를 만들었어요.`)
      // 이슈는 만들어졌지만 그새 읽기 전용이 됐으면 본문엔 넣지 않는다.
      if (!canEditRef.current) return
      ed
        .chain()
        .focus()
        .insertContentAt(issueDialog.insertAt(ed), [
          { type: 'wikiMention', attrs: { mtype: 'ISSUE', id: issue.id } },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
    [issueDialog],
  )

  // 슬래시 메뉴 선택 콜백 — draft 면 토픽 입력 다이얼로그를 먼저 연다.
  const onSlashAction = useCallback((action: WikiAiAction) => {
    if (action === 'draft') {
      setDraftOpen(true)
      return
    }
    runActionRef.current(action)
  }, [])

  // 헤더 AI 버튼 → 생성 액션. 슬래시 메뉴와 달리 에디터에 포커스가 없을 수 있어,
  // 삽입 위치가 불확정이 되지 않도록 본문 끝으로 커서를 먼저 옮긴다.
  const onHeaderAiAction = useCallback(
    (action: GenerateActionKey) => {
      if (action === 'draft') {
        setDraftOpen(true)
        return
      }
      editorRef.current?.commands.focus('end')
      runAction(action)
    },
    [runAction],
  )

  // 소스 모달 열기 — 편집 내용에 실시간 구독하지 않고 여는 순간의 마크다운만 담는다.
  // 매 타이핑마다 전체 문서를 직렬화하는 비용을 피한다. 서버에 저장된 page.body(최대 수 초 늦음)가 아니라
  // 동시 편집자의 입력까지 반영된 현재 에디터 상태가 보인다.
  const onViewSource = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    setSourceMarkdown(ed.storage.markdown.getMarkdown())
    setSourceOpen(true)
  }, [])

  // runAction·onSlashAction 의 최신값을 확장(1회 생성)이 참조하기 위한 ref.
  // 확장 콜백은 사용자 '/' 입력 시점에만 역참조하므로 렌더 중 읽히지 않는다(스테일 회피 목적).
  const runActionRef = useRef(runAction)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    runActionRef.current = runAction
  })
  const onActionRef = useRef(onSlashAction)
  useEffect(() => {
    onActionRef.current = onSlashAction
  })

  // 슬래시 메뉴 '이미지' 항목(#751) — 숨은 file input 을 여는 진입점. imageInputRef 는 안정된
  // ref 객체라 이 함수 자체가 스테일해지지 않으므로(참조하는 게 ref.current 뿐) 다른 액션
  // ref 들과 달리 렌더마다 갱신하는 useEffect 가 불필요하다.
  const imageInputRef = useRef<HTMLInputElement>(null)
  const onImageInsertRef = useRef<() => void>(() => imageInputRef.current?.click())

  // 슬래시 확장 — 마운트 시 1회 생성. ctx ref 는 suggestion 콜백(allow/command)에서만 역참조되며
  // 사용자가 '/' 를 입력할 때 ProseMirror 가 호출하므로 렌더 시점에 동기 실행되지 않아 안전하다
  // (RichInput 의 membersRef 패턴 동일 — react-hooks/refs 의 보수적 false positive).
  const slashExtension = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => createWikiSlashExtension({ canEditRef, onActionRef, onImageInsertRef }),
    [],
  )
  // 표 단축키 확장 — canEditRef 를 슬래시 확장과 같은 패턴으로 주입(마운트 시 1회 생성).
  // eslint-disable-next-line react-hooks/refs
  const tableShortcutsExtension = useMemo(() => createWikiTableShortcuts({ canEditRef }), [])

  // 본문 이미지 붙여넣기/드래그드롭 업로드(#751). 핸들러는 useCallback 으로 안정화돼 있어
  // useEditor 의 의존성 배열([page.id])에 넣지 않아도 stale closure 가 생기지 않는다.
  // canEditRef 를 넘겨 VIEWER 는 서버 403 전에 클라이언트에서 조용히 막는다(UX 전용, 서버가 최종 판정).
  const { handlePaste, handleDrop, uploadFilesAtCursor } = useWikiImageUpload(page.id, canEditRef)

  const editor = useEditor(
    {
      // '@'(멘션) 과 '/'(AI) 는 char 가 달라 충돌하지 않는다. WikiMention 노드 + 두 suggestion 확장.
      // Placeholder — 빈 본문에서 '/' AI 진입점을 알리는 상시 힌트(미등록이면 빈 페이지에 아무
      // 안내도 없어 AI 기능이 발견 불가였다, #733). showOnlyCurrent=false 여야 포커스 없는
      // 상태에서도 보인다(기본 true 는 커서가 있는 노드에만 표시).
      extensions: [
        // 문서 스키마(텍스트·마크다운·멘션·이미지·표)는 동기화 서버와 공유하는 공용 묶음(WP-284).
        // 이미지·멘션은 웹 NodeView 를 붙인 버전을 주입한다 — 스키마 자체는 패키지와 동일.
        // 실행 취소는 Yjs 가 맡으므로(내 편집만 되돌림) 기본 history 는 끈다 — 켜 두면 남의 편집까지 되돌린다.
        ...wikiSchemaExtensions({ image: WikiImage, mention: WikiMention }),
        // 본문 실시간 동기화(WP-287) — 동기화 서버와 같은 조각 이름(COLLAB_FRAGMENT)을 쓴다. 본문은 서버 문서가 원본이라
        // content 로 초기화하지 않는다(넣으면 동기화 때 본문이 두 벌이 된다).
        Collaboration.configure({ document: session.doc, field: COLLAB_FRAGMENT }),
        mentionExtension,
        slashExtension,
        Placeholder.configure({
          placeholder: "내용을 입력하거나 '/' 를 눌러 AI 사용",
          showOnlyCurrent: false,
        }),
        // 행·열 삽입 단축키(Ctrl-Alt-화살표). 표 밖이거나 뷰어 권한이면 false 를 반환해 기본 동작을 유지한다.
        tableShortcutsExtension,
        // 이미지 업로드 자리표시자 — 공유 문서가 아니라 내 화면에만 그리는 데코레이션(WP-295).
        WikiUploadPlaceholder,
        // 다른 사람의 AI 가 쓰는 자리 ✦ 표식(WP-291) — awareness(서버·다른 접속자의 /ai)에서 읽어 내 화면에만 그린다.
        WikiAiMarkers.configure({ awareness: session.provider.awareness }),
      ],
      // 이미지 붙여넣기·드래그드롭 업로드. 업로드 완료 시 image 노드로 교체된다.
      editorProps: { handlePaste, handleDrop },
      // 권한 게이트 — VIEWER 는 본문을 입력할 수 없다(#756). 미설정 시 tiptap 기본값이 true 라
      // 뷰어도 자유롭게 타이핑할 수 있었고, 서버가 편집을 버리므로 입력이 조용히 사라졌다.
      // 스페이스 목록 로딩 중(role undefined)에는 fail-closed 로 false 였다가 아래 effect 가 뒤집는다.
      editable: canEdit,
    },
    [page.id, session.doc],
  )

  // 권한이 나중에 확정되거나 바뀌어도 반영 — useEditor 는 [page.id, session.doc] 로만 재생성되므로
  // 위 options 의 editable 은 최초 1회 값이다. 서버가 알린 VIEWER 강등이면 즉시 잠그고, 승격이면 다시 연다.
  useEffect(() => {
    editor?.setEditable(canEdit)
  }, [editor, canEdit])

  // 업로드 중 에디터가 재마운트돼도(셸 전환) 새 뷰에서 업로드를 마무리하도록 살아 있는 뷰를 등록한다.
  useEffect(() => {
    if (!editor) return
    return registerWikiEditorView(page.id, editor.view)
  }, [editor, page.id])

  // insertContent·취소 시 editor 참조를 ref 로도 보관(콜백 스테일 회피).
  const editorRef = useRef(editor)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    editorRef.current = editor
  })

  // 슬래시 메뉴 '이미지' 항목이 연 file input 의 onChange 에서 호출된다. useWikiImageUpload 의
  // uploadFilesAtCursor 는 현재 커서 위치에 바로 올리는 전용 진입점이라(#751 C4), 좌표를 역산해
  // handleDrop 용 합성 DragEvent 를 만드는 우회가 필요 없다 — handleDrop 의 내부 가드가 바뀌어도
  // 이 경로가 그 변화를 의도치 않게 상속하지 않는다.
  const insertImagesAtCursor = useCallback(
    (files: FileList | null) => {
      const view = editorRef.current?.view
      if (!view || !files || files.length === 0) return
      uploadFilesAtCursor(view, Array.from(files))
    },
    [uploadFilesAtCursor],
  )

  // 본문 공백 여부 — 빈 페이지 AI CTA 노출 조건. editor.isEmpty 는 리렌더를 유발하지 않으므로
  // 'update' 이벤트에 맞춰 state 로 미러한다(스트리밍 삽입 즉시 CTA 가 사라짐).
  const [bodyEmpty, setBodyEmpty] = useState(true)
  useEffect(() => {
    if (!editor) return
    const sync = () => setBodyEmpty(editor.isEmpty)
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor])

  // 표 툴바의 버튼 활성 상태는 커서 위치에 따라 바뀌는데, 선택 변경은 React 리렌더를
  // 유발하지 않는다(bodyEmpty 와 같은 문제). selectionUpdate 를 state 로 미러해 갱신한다.
  const [, setSelectionTick] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = () => setSelectionTick((n) => n + 1)
    editor.on('selectionUpdate', bump)
    return () => {
      editor.off('selectionUpdate', bump)
    }
  }, [editor])

  // 멘션 해소 결과 — 칩 클릭 내비가 spaceId/projectKey/number 를 얻는 데 쓴다. 토큰→칩 변환은 마크다운 파서가,
  // 칩 라벨은 WikiMentionLabelsProvider 가 맡는다(WP-294).
  const { data: pageMentions } = useWikiMentions(page.id)

  // 멘션 칩 클릭 내비게이션 — 칩 노드 attrs 는 {mtype,id} 뿐이라(spaceId/projectKey 없음)
  // useWikiMentions 해소 결과(WikiMentionRef)를 type+id 로 룩업해 라우트를 계산한다.
  // EditorContent 래퍼 div 의 onClick 에 다는 이유: 이 핸들러는 매 렌더 재생성되어 pageMentions
  // 최신값을 닫아 캡처한다(useEditor 옵션에 넣으면 생성 시점 빈 배열을 캡처해 영구 미스). 칩은
  // data-mtype/data-id 를 렌더하므로 closest 로 클릭된 칩을 찾는다.
  const onChipClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const chip = target.closest('[data-mtype]') as HTMLElement | null
      if (!chip) return
      const mtype = chip.getAttribute('data-mtype') as WikiMentionType | null
      const id = Number(chip.getAttribute('data-id'))
      if (!mtype || !Number.isFinite(id)) return
      // type+id 로 해소 참조를 찾아 라우트의 spaceId/projectKey/number 를 얻는다.
      const ref: WikiMentionRef | undefined = pageMentions?.find(
        (m) => m.type === mtype && m.id === id,
      )
      if (mtype === 'PAGE') {
        // PAGE → 해소된 spaceId 가 있어야 위키 페이지 경로를 만들 수 있다.
        if (ref?.spaceId == null) return
        e.preventDefault()
        navigate(`/wiki/spaces/${ref.spaceId}/pages/${id}`)
      } else if (mtype === 'ISSUE') {
        // ISSUE → 해소된 projectKey+number 로 이슈 상세 경로.
        if (ref?.projectKey == null || ref.number == null) return
        e.preventDefault()
        navigate(`/projects/${ref.projectKey}/issues/${ref.number}`)
      }
      // USER → 일반 사용자 프로필 라우트가 없어(관리자 전용 settings/users/:id 뿐) 무동작.
    },
    [navigate, pageMentions],
  )

  // 생성 취소 — ESC 또는 버튼. abort 후 상태 복귀. 결과는 완료 시에만 삽입하므로 받은 부분 결과는 버려진다(WP-255).
  const cancelAi = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setAiBusy(false)
  }, [])


  // 제목 저장 — 디바운스·blur/언마운트 즉시 보냄·일시 실패 재시도는 createTitleSaver 가 맡는다(규칙은 wikiTitleSync).
  // 페이지 전환은 key 로 리마운트되므로 사실상 마운트당 한 번 만든다. mutateAsync 는 최신 함수를 ref 로 읽는다.
  const pageId = page.id
  const saveTitleRef = useRef(saveTitle.mutateAsync)
  useEffect(() => {
    saveTitleRef.current = saveTitle.mutateAsync
  })
  const titleSaverRef = useRef<TitleSaver | null>(null)
  useEffect(() => {
    const saver = createTitleSaver({
      debounceMs: TITLE_SAVE_DEBOUNCE_MS,
      // mutate 의 호출별 콜백은 마지막 호출에만 불려 겹친 저장의 완료를 놓친다 — 요청마다 끝을 알리도록 promise 로 받는다.
      send: (title) => saveTitleRef.current({ pageId, title }),
      onSent: (title) => dispatchTitle({ type: 'sent', title, now: Date.now() }),
      onSettled: () => dispatchTitle({ type: 'settled' }),
      onFailed: () => dispatchTitle({ type: 'failed' }),
      onAbandoned: () => dispatchTitle({ type: 'abandoned' }),
      // 재시도마다 쌓이지 않게 연속 실패의 첫 번째에만 알린다.
      onError: (e) => handleApiError(e, '제목을 저장하지 못했습니다'),
    })
    titleSaverRef.current = saver
    // 언마운트 — 대기 중인 제목을 보내고(이동해도 마지막 입력을 잃지 않게) 이후 재시도는 멈춘다.
    return () => {
      saver.dispose()
      if (titleSaverRef.current === saver) titleSaverRef.current = null
    }
  }, [pageId])

  // 언마운트 시 진행 중 스트림 정리.
  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  // 헤더 ⋯ → 삭제 확정. 삭제 후 스페이스 루트로 이동.
  const handleDeleteCurrent = useCallback(() => {
    setConfirmDelete(false)
    del.mutate(page.id, {
      onSuccess: () => navigate(`/wiki/spaces/${spaceId}`),
    })
  }, [del, page.id, navigate, spaceId])

  // 생성 중 ESC 로 취소.
  useEffect(() => {
    if (!aiBusy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAi()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aiBusy, cancelAi])

  // 본문 스크롤 영역 — 동기화 안내 띠가 sticky 로 붙고, 띠 높이만큼 scrollTop 을 보정하는 기준(WikiSyncNotice).
  const scrollRef = useRef<HTMLDivElement>(null)

  // 페이지 틀(Page) reading 폭 — 본문은 헤더 경로 nav 와 같은 16px 축에서 왼쪽 정렬로 시작해 768px 로 제한된다
  // (예전 mx-auto 가운데 정렬은 넓은 화면에서 헤더와 본문 시작선이 수백 px 어긋났다).
  // 스크롤 영역은 Page.Body 대신 직접 둔다 — 동기화 안내 띠가 칼럼 밖(스크롤 영역 맨 위)에 붙어야 해서.
  return (
    <Page width="reading">
      <WikiPageHeader
        crumbs={crumbs}
        syncStatus={syncStatus}
        aiState={aiState}
        aiBusy={aiBusy}
        aiAttributed={page.aiLastUsedAt != null}
        onNavigate={(id) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)}
        onAiAction={onHeaderAiAction}
        onDelete={() => setConfirmDelete(true)}
        onViewSource={onViewSource}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* 미전송·접근 불가 안내 — 스크롤 영역 맨 위 sticky 띠(칼럼 밖·BubbleMenu 형제 목록 밖에 둔다). */}
        <WikiSyncNotice status={syncStatus} scrollRef={scrollRef} />
        <div className={cn('flex flex-col', pageBodyInsetClass, pageReadingWidthClass)}>
          {/* 선택 텍스트 변형 툴바(톤/번역/확장/축약/다듬기) — 뷰어·생성 중엔 비노출.
              roleCanEdit(EDITOR/OWNER)일 때만 onCreateIssue 를 전달해 "이슈로 만들기" 버튼을 노출한다.

              형제 목록의 **맨 앞**에 둔다(시각 위치와 무관): BubbleMenu 는 마운트 시 자기 DOM 노드를
              트리에서 떼어내(element.remove()) tippy 에 넘기므로, 그 앞에 조건부 형제가 있으면 해당
              형제가 언마운트될 때 React 가 사라진 앵커에 insertBefore 를 시도해 NotFoundError 로
              페이지 전체가 죽는다. 맨 앞에 두면 뒤따르는 조건부 노드(충돌 배너·빈 CTA 등)가 안전하다. */}
          <WikiAiBubbleToolbar
            editor={editor}
            disabled={!roleCanEdit || !canEdit || aiBusy}
            onAction={runTransform}
            onCreateIssue={roleCanEdit && canEdit ? onCreateIssue : undefined}
          />
          <WikiTableToolbar editor={editor} disabled={!canEdit} />
          <WikiTableContextMenu editor={editor} disabled={!canEdit} />
          <input
            value={title}
            readOnly={readOnly}
            onChange={(e) => {
              const next = e.target.value
              // 원격(서버) 제목으로 되돌렸고 응답 대기도 없으면 보낼 것이 없다 — 실패 재시도도 버리고 원격 제목을 다시 따른다.
              if (needsTitleSave(titleSync, next)) titleSaverRef.current?.schedule(next)
              else titleSaverRef.current?.cancel()
              dispatchTitle({ type: 'change', title: next })
            }}
            onFocus={() => dispatchTitle({ type: 'focus' })}
            // 떠날 때 대기 중인 제목을 바로 보낸다 — 그 뒤 원격 제목 반영은 저장이 끝난 다음(wikiTitleSync).
            onBlur={() => {
              titleSaverRef.current?.flush()
              dispatchTitle({ type: 'blur' })
            }}
            onKeyDown={(e) => {
              // Enter 로 폼 submit(줄바꿈 없음)되며 이후 타이핑이 제목에 이어붙는 것을 막고
              // 본문 에디터로 포커스를 넘긴다(#786).
              if (e.key === 'Enter') {
                e.preventDefault()
                // commands.focus 는 다음 animation frame 에 포커스를 옮겨, Enter 직후 빠른 타이핑의 앞 글자가
                // 제목에 붙는다 → view.focus() 로 동기 이동 후 커서만 시작으로 둔다.
                editor?.view.focus()
                editor?.commands.focus('start')
              }
            }}
            placeholder="제목 없음"
            className={`mb-4 w-full border-0 bg-transparent outline-none placeholder:text-muted-foreground/40 ${pageTitleClass}`}
          />
          {/* WP-301 노트 상단 AI 요약 — 제목 아래·본문 위(시안 A). 본문을 바꾸지 않는 읽기 보조라 뷰어에게도 보인다. */}
          <WikiSummaryCard pageId={page.id} />
          {/* 빈 페이지 AI CTA — 초안 작성이 가장 유효한 순간(#733). 본문이 채워지면 사라진다.
              동기화 연결(live) 뒤에만 보인다 — 처음 열 때 서버 본문이 오기 전 빈 에디터에 잠깐 깜빡이지 않게(WP-287).
              에디터 아래가 아니라 제목 바로 밑에 둔다: 본문 클릭영역(min-h 300px) 뒤에 두면
              placeholder 와 300px 떨어져 시각적 연결이 끊긴다.
              점선 테두리는 디자인시스템에 규정이 없어 일반 border + bg-muted 표면을 쓴다. */}
          {bodyEmpty && aiState === 'ready' && !aiBusy && syncStatus === 'live' && (
            <div
              data-testid="wiki-ai-empty-cta"
              className="mb-4 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2"
            >
              <AiLabel>AI</AiLabel>
              {/* bg-muted 표면 위라 text-muted-foreground 는 대비 마진이 좁다(다크에서 muted 는
                  흰색 5% 알파로 표면 명도가 거의 오르지 않음) → 본문색을 쓴다. AI 강조는 AiLabel 담당. */}
              <span className="text-sm leading-5 text-foreground">
                빈 페이지예요. 주제만 알려주면 AI 가 초안을 작성합니다.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraftOpen(true)}
                data-testid="wiki-ai-empty-draft"
              >
                AI 초안 작성
              </Button>
            </div>
          )}
          {/* 멘션 칩 클릭 내비게이션은 래퍼 onClick 에서 위임 처리(closest[data-mtype]).
              wiki-editor 클래스는 placeholder CSS 의 스코프(wiki-editor.css).
              칩 NodeView 는 EditorContent 가 렌더하는 포털이라 라벨 Provider 로 여기만 감싸면 된다(WP-294).
              클릭 위임은 EditorContent 가 아니라 바깥 div 에 둔다 — 포털은 EditorContent 의 div 형제로 렌더돼
              React 합성 이벤트가 그 div 의 onClick 까지 버블되지 않는다(바깥 div 는 DOM·React 트리 모두 조상). */}
          {/* 첫 동기화 전엔 본문 대신 skeleton(WP-287) — 빈 문서와 입력 안내가 잠깐 보였다가 서버 본문으로 바뀌지 않게.
              첫 연결이 끝내 안 되면 skeleton 대신 연결 못 함 안내(붙으면 본문으로). */}
          {ready ? (
            <WikiMentionLabelsProvider pageId={page.id}>
              <div onClick={onChipClick}>
                <EditorContent
                  editor={editor}
                  className="wiki-editor [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none"
                />
              </div>
            </WikiMentionLabelsProvider>
          ) : body === 'unreachable' ? (
            <WikiSyncUnreachable />
          ) : (
            <WikiPageSkeleton withTitle={false} testId="wiki-body-skeleton" />
          )}
          {/* 슬래시 메뉴 '이미지' 항목(#751) 전용 숨은 file input. accept 는 서버 매직바이트
              판정과 동일 집합(SVG 제외 — 서버가 거부한다). 같은 파일을 연속 선택해도 onChange
              가 다시 발화하도록 선택 직후 value 를 비운다. */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            data-testid="wiki-image-slash-input"
            onChange={(e) => {
              insertImagesAtCursor(e.target.files)
              e.target.value = ''
            }}
          />
          {/* 노트→이슈 생성 다이얼로그 — AI 역할 게이트는 onCreateIssue 전달 여부로 이미 처리됨. */}
          <WikiCreateIssueDialog
            open={issueDialog.open}
            initialTitle={issueDialog.title}
            initialBody={issueDialog.body}
            onCreated={onIssueCreated}
            onClose={() => setIssueDialog((s) => ({ ...s, open: false }))}
          />
          {/* 백링크 패널 — 이 페이지를 참조하는 다른 위키 페이지(빈 배열이면 자체적으로 숨김). */}
          <WikiBacklinksPanel pageId={page.id} />
          {/* 스크린리더용 라이브 리전 — 상시 렌더하고 내부 텍스트만 토글한다.
              조건부로 노드째 삽입하면 라이브 리전이 등록되기 전에 내용이 들어가 공지가 누락된다. */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {aiBusy ? 'AI 생성 중' : ''}
          </div>
          {/* AI 생성 중 시각 표시 + 취소 — 결과는 완료 시 한 번에 삽입되므로 그동안 헤더 스피너와 함께 진행을 알린다(WP-255). */}
          {aiBusy && (
            <div className="flex items-center gap-2 pt-2 text-xs leading-4 text-muted-foreground">
              <span className="flex items-center gap-2" data-testid="wiki-ai-busy">
                <AiLabel>생성 중…</AiLabel>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelAi}
                  data-testid="wiki-ai-cancel"
                >
                  취소
                </Button>
              </span>
            </div>
          )}
        </div>
      </div>
      {/* draft 토픽 입력 — 확인 시 prompt 로 draft 액션 실행. */}
      <RenameDialog
        open={draftOpen}
        title="AI 초안 작성"
        initialValue=""
        onConfirm={(topic) => runAction('draft', topic)}
        onClose={() => setDraftOpen(false)}
      />
      <WikiDeletePageDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        pageTitle={title}
        hasChildren={pageHasChildren}
        onConfirm={handleDeleteCurrent}
      />
      <WikiMarkdownSourceDialog
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        title={title}
        markdown={sourceMarkdown}
      />
    </Page>
  )
}
