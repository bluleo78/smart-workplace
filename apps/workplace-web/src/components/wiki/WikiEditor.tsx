import './wiki-editor.css'

import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation,useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Markdown } from 'tiptap-markdown'

import { AiLabel } from '@/components/ai/AiLabel'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { RenameDialog } from '@/components/ui/rename-dialog'

import {
  useWikiEntitySearch,
  type WikiEntityCandidate,
} from '../../hooks/queries/useWikiEntitySearch'
import { useWikiMentions } from '../../hooks/queries/useWikiMentions'
import { useDeletePage, useSavePage } from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import { startWikiAiStream } from '../../hooks/useWikiAiStream'
import type { WikiMentionRef, WikiMentionType, WikiPageDetail } from '../../types/wiki'
import { useWikiImageUpload } from './useWikiImageUpload'
import { type GenerateActionKey, type TransformActionKey } from './wikiAiActions'
import { WikiAiBubbleToolbar } from './WikiAiBubbleToolbar'
import { insertAiMarkdown } from './wikiAiInsert'
import { stripLeadingTitleHeading } from './wikiAiTitleHeading'
import { WikiBacklinksPanel } from './WikiBacklinksPanel'
import { buildBreadcrumb } from './wikiBreadcrumb'
import { type CreatedIssue,WikiCreateIssueDialog } from './WikiCreateIssueDialog'
import { WikiDeletePageDialog } from './WikiDeletePageDialog'
import { trackWikiFlush } from './wikiFlushRegistry'
import { WikiImage } from './wikiImageNode'
import { WikiMarkdownSourceDialog } from './WikiMarkdownSourceDialog'
import { WikiMarkdownText } from './wikiMarkdownText'
import { hydrateWikiMentions } from './wikiMentionHydrate'
import { WikiMention } from './wikiMentionNode'
import { createWikiMentionExtension } from './wikiMentionSuggestion'
import { type SaveState,type WikiAiState,WikiPageHeader } from './WikiPageHeader'
import type { WikiAiAction } from './WikiSlashMenu'
import { createWikiSlashExtension } from './wikiSlashSuggestion'
import { WikiSummaryCard } from './WikiSummaryCard'
import { WikiTableContextMenu } from './WikiTableContextMenu'
import { createWikiTableShortcuts } from './wikiTableShortcuts'
import { WikiTableToolbar } from './WikiTableToolbar'

/** 위키 에디터 — 마크다운 직렬화 + debounce 자동저장(낙관적 동시성) + 인에디터 /ai 스트리밍. */
export function WikiEditor({ page, spaceId }: { page: WikiPageDetail; spaceId: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  const save = useSavePage(spaceId)
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
  const [title, setTitle] = useState(page.title)
  // AI 결과의 제목 H1 제거 판정용 최신 제목(편집 중 미저장분 포함) — 스트림 완료 콜백이 렌더 밖에서 읽는다.
  const titleRef = useRef(title)
  useEffect(() => {
    titleRef.current = title
  })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const versionRef = useRef(page.version)
  // WP-301 요약 카드의 낡음 판정용 — versionRef 는 렌더를 일으키지 않으므로 같은 값을 상태로도 들고 있는다.
  const [liveVersion, setLiveVersion] = useState(page.version)
  const firstSaveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 역할 게이트 — OWNER|EDITOR 만 /ai 슬래시 사용. VIEWER 면 메뉴 미노출.
  const { data: spaces, isPending: spacesPending } = useWikiSpaces()
  const role = spaces?.find((s) => s.id === spaceId)?.role
  const canUseAi = role === 'OWNER' || role === 'EDITOR'
  // 헤더 AI 버튼용 3분기 — 로딩(권한 확인 중)과 거부(읽기 전용)를 구분해 사유를 노출한다.
  // 예전엔 canUseAi=false 하나로 뭉쳐 메뉴를 숨겨서, 스페이스 목록이 아직 안 온 순간에도
  // AI 가 "없는 기능"처럼 보였다(#733).
  const aiState: WikiAiState = spacesPending ? 'loading' : canUseAi ? 'ready' : 'denied'
  // 멘션 삽입 게이트 — /ai 와 같은 OWNER|EDITOR 집합이지만 의미상 별개라 분리(향후 분기 대비).
  const canEdit = role === 'OWNER' || role === 'EDITOR'

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
  const [issueDialog, setIssueDialog] = useState<{
    open: boolean
    title: string
    body: string
    insertAt: number
  }>({ open: false, title: '', body: '', insertAt: 0 })

  // 슬래시 확장은 게이트로 위의 canEditRef 를 그대로 재사용한다 — 메뉴에 AI 가 아닌 표 삽입이
  // 들어오며(#748) 게이트 의미가 "편집 가능"이 됐고, canUseAi 와 canEdit 는 원래부터 동일 식이라
  // 별도 ref 를 두면 이름만 다른 중복이 된다.

  // action → startWikiAiStream 트리거. summarize/continue 는 즉시, draft 는 토픽 입력 후.
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
      const { from, to } = ed.state.selection
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
          setAiBusy(false)
          abortRef.current = null
          const e2 = editorRef.current
          // 모델이 페이지 제목을 H1 으로 반복하면 본문 밖 제목 입력란과 이중으로 보인다 — 삽입 전에 걷어낸다.
          const content = stripLeadingTitleHeading(buffer, titleRef.current)
          if (!e2 || !content.trim()) return
          // 전체 결과를 한 번에 마크다운 파싱·삽입(단일 트랜잭션 → 단일 undo, 'update' 로 자동저장 트리거).
          insertAiMarkdown(e2, from, to, content)
        },
        onError: (message) => {
          setAiBusy(false)
          abortRef.current = null
          toast.error(message)
        },
      })
      abortRef.current = handle.abort
    },
    [page.id],
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
      abortRef.current?.()
      abortRef.current = null
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
          setAiBusy(false)
          abortRef.current = null
          const e2 = editorRef.current
          if (!e2 || !buffer) return
          // 캡처한 범위를 결과로 1회 교체(삭제+삽입 단일 트랜잭션 → 단일 undo).
          insertAiMarkdown(e2, from, to, buffer)
        },
        onError: (message) => {
          setAiBusy(false)
          abortRef.current = null
          toast.error(message)
        },
      })
      abortRef.current = handle.abort
    },
    [page.id],
  )

  // "이슈로 만들기" — 선택 텍스트를 제목(첫 줄)/본문으로, 삽입 위치(선택 끝)를 캡처해 다이얼로그를 연다.
  const onCreateIssue = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { from, to } = ed.state.selection
    if (from === to) return
    const selected = ed.state.doc.textBetween(from, to, '\n')
    const firstLine = selected.split('\n').find((l) => l.trim()) ?? selected
    setIssueDialog({ open: true, title: firstLine.trim().slice(0, 200), body: selected, insertAt: to })
  }, [])

  // 이슈 생성 성공 → 삽입 위치에 ISSUE 멘션 칩 + 공백 삽입.
  // 저장 시 <#issue:id> 토큰으로 직렬화돼 WikiReferenceParser 가 wiki_reference 에 링크를 기록한다.
  const onIssueCreated = useCallback(
    (issue: CreatedIssue) => {
      const ed = editorRef.current
      if (!ed) return
      const label = `${issue.projectKey}-${issue.number} ${issue.title}`
      ed
        .chain()
        .focus()
        .insertContentAt(issueDialog.insertAt, [
          { type: 'wikiMention', attrs: { mtype: 'ISSUE', id: issue.id, label } },
          { type: 'text', text: ' ' },
        ])
        .run()
      toast.success(`${issue.projectKey}-${issue.number} 이슈를 만들었어요.`)
    },
    [issueDialog.insertAt],
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
  // 매 타이핑마다 전체 문서를 직렬화하는 비용을 피하고, 읽기 전용이라 자동저장·낙관적 버전
  // (version 충돌) 경로와 완전히 무관해진다. 저장된 page.body 가 아니라 미저장분까지 포함된
  // 현재 에디터 상태가 보인다.
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
        // text 노드만 교체 — 표 셀 안의 | 를 이스케이프한다(#755). wikiMarkdownText.ts 참조.
        StarterKit.configure({ text: false }),
        WikiMarkdownText,
        // 붙여넣기 자동 변환(#753) — 기본값 false 라 터미널·.md 파일에서 복사한 '## 제목' 이
        // 평문으로 들어갔다. transformCopiedText 는 켜지 않는다: 켜면 에디터 내부 복사→붙여넣기가
        // 마크다운 텍스트로 왕복하면서 멘션 칩이 <#page:12> 토큰 평문으로 퇴화한다.
        // html 옵션은 기본값 true 를 유지해야 한다 — 기존 페이지에 raw HTML 로 직렬화돼 저장된
        // 표(#742 폴백 경로)를 파싱하는 것이 이 옵션이라, 끄면 로드가 깨진다.
        Markdown.configure({ transformPastedText: true }),
        WikiMention,
        mentionExtension,
        slashExtension,
        Placeholder.configure({
          placeholder: "내용을 입력하거나 '/' 를 눌러 AI 사용",
          showOnlyCurrent: false,
        }),
        // 이미지(#750) — 미등록 시 markdown-it 이 파싱한 이미지를 ProseMirror 가 버려서
        // 이미지가 든 페이지를 열었다 저장하면 영구 삭제됐다(AI/MCP 위키 도구가 본문을 직접 쓴다).
        // 노드 이름 'image' 유지 + inline:true 는 라운드트립 무손실의 필수 조건 — wikiImageNode.ts 참조.
        WikiImage,
        // 표(#742) — StarterKit 에 없어서 마크다운 표가 문단으로 합쳐져 깨졌다. AI 생성물(/ai 요약·초안)이
        // 표를 자주 만들기 때문에 체감 결함이 컸다. tiptap-markdown 이 table 직렬화기를 내장하고 있어
        // 저장 → 재로드 라운드트립이 성립한다(GFM 으로 표현 못 하는 병합셀 등은 자체 폴백).
        // resizable 은 끈다 — 열 너비를 픽셀로 문서에 심으면 마크다운 직렬화에서 버려져 무의미하다.
        // renderWrapper 기본값이 false 라 div.tableWrapper 가 아예 렌더되지 않았고, 그 래퍼에
        // 걸어둔 가로 스크롤 CSS 가 죽은 코드였다(#754). 켜야 넓은 표가 스크롤된다.
        Table.configure({ resizable: false, renderWrapper: true }),
        TableRow,
        TableHeader,
        TableCell,
        // 행·열 삽입 단축키(Ctrl-Alt-화살표). 표 밖이거나 뷰어 권한이면 false 를 반환해 기본 동작을 유지한다.
        tableShortcutsExtension,
      ],
      // 이미지 붙여넣기·드래그드롭 업로드. 업로드 완료 시 image 노드로 교체된다.
      editorProps: { handlePaste, handleDrop },
      content: page.body,
      // 권한 게이트 — VIEWER 는 본문을 입력할 수 없다(#756). 미설정 시 tiptap 기본값이 true 라
      // 뷰어도 자유롭게 타이핑할 수 있었고, 저장은 백엔드가 막으므로 입력이 조용히 사라졌다.
      // 스페이스 목록 로딩 중(role undefined)에는 fail-closed 로 false 였다가 아래 effect 가 뒤집는다.
      editable: canEdit,
    },
    [page.id],
  )

  // 권한이 나중에 확정되거나 바뀌어도 반영 — useEditor 는 [page.id] 로만 재생성되므로
  // 위 options 의 editable 은 최초 1회 값이다. 이 effect 가 없으면 OWNER 도 읽기 전용에 갇힌다.
  useEffect(() => {
    editor?.setEditable(canEdit)
  }, [editor, canEdit])

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

  // 로드 라운드트립 — 본문에 텍스트로 살아남은 멘션 토큰을 칩(wikiMention 노드)으로 치환.
  // useWikiMentions 결과(라벨 해소)를 기다렸다가 라벨까지 채워 1회 치환한다(placeholder 재치환 회피).
  // 토큰을 노드로 바꾸면 더는 텍스트가 아니므로 재스캔 대상이 사라져 한 번이면 충분하다.
  // refetchMentions 는 원격 수정본으로 본문을 교체한 뒤(WP-170) 새 본문의 멘션을 다시 해소할 때 쓴다.
  const {
    data: pageMentions,
    isError: mentionsError,
    refetch: refetchMentions,
  } = useWikiMentions(page.id)
  // 페이지(=마운트)당 1회만 치환하도록 가드.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!editor) return
    if (hydratedRef.current) return
    // mentions 쿼리가 settle(성공·data 도착)될 때까지 대기 — 라벨을 한 번에 채우기 위함.
    // 단, 쿼리가 실패해 data 가 영구 undefined 가 되는 경우엔 토큰이 raw 텍스트로 남지 않도록
    // isError 면 라벨 없이(빈배열) 진행한다(placeholder=토큰 라벨 폴백). 토큰 없는 본문도 1회 no-op.
    if (pageMentions === undefined && !mentionsError) return
    hydratedRef.current = true
    // 토큰을 노드로 치환(뒤→앞, addToHistory=false, 자동저장 가드 메타 포함).
    hydrateWikiMentions(editor, pageMentions ?? [])
  }, [editor, pageMentions, mentionsError])

  // 멘션 칩 클릭 내비게이션 — 칩 노드 attrs 는 {mtype,id,label} 뿐이라(spaceId/projectKey 없음)
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

  // 페이지 전환 시 WikiPageView 가 key={page.id} 로 이 컴포넌트를 리마운트하므로
  // 초기 상태(title/version/firstSave)는 마운트 시 한 번만 설정되면 충분하다.
  // 저장 성공 후 page prop 의 version 이 갱신돼도 상태를 리셋하지 않는다
  // (리셋하면 '저장됨' 이 즉시 사라지고, 매 자동저장마다 snapshot=true 가 되어 리비전 캐던스가 깨진다).
  // 단, 다른 곳(AI 비서·다른 탭)의 저장으로 page.version 이 로컬보다 앞서면 아래 원격 반영 effect 가 교체한다(WP-170).

  // flush=true(언마운트 flush)면 mutateAsync 의 promise 를 돌려준다 — 컴포넌트가 사라지는 중이라 저장 상태 UI 갱신은
  // 의미가 없고, 대신 WikiPageView 가 이 promise 로 재마운트 시점을 잡는다(wikiFlushRegistry).
  const doSave = useCallback(
    (nextTitle: string, flush = false): Promise<unknown> | undefined => {
      if (!editor) return
      if (saveState === 'conflict') return
      const body = editor.storage.markdown.getMarkdown()
      const snapshot = firstSaveRef.current
      const vars = { pageId: page.id, req: { title: nextTitle, body, version: versionRef.current, snapshot } }
      if (flush) return save.mutateAsync(vars)
      setSaveState('saving')
      save.mutate(
        vars,
        {
          onSuccess: (data) => {
            versionRef.current = data.version
            setLiveVersion(data.version)
            firstSaveRef.current = false
            setSaveState('saved')
          },
          onError: (err) => {
            // '최신 내용 불러오기'로 version 이 바뀐 뒤 도착한 옛 저장의 실패는 무시한다 — 반영하면 최신본을 들고도
            // 충돌 상태에 갇혀 자동저장이 멈춘다(WP-170).
            if (vars.req.version !== versionRef.current) return
            if (isAxiosError(err) && err.response?.status === 409) {
              setSaveState('conflict')
            } else {
              setSaveState('idle')
            }
          },
        },
      )
    },
    [editor, page.id, save, saveState],
  )

  // 디바운스 대기 중인 저장의 제목 — 언마운트 flush 가 클로저가 아닌 최신 값을 쓰도록 ref 로 보관.
  const pendingTitleRef = useRef<string | null>(null)
  // 언마운트 cleanup(빈 deps)은 첫 렌더의 doSave(editor=null)를 캡처하므로, 최신 doSave 를 ref 로 추적한다.
  const doSaveRef = useRef(doSave)
  useEffect(() => {
    doSaveRef.current = doSave
  })

  const scheduleSave = useCallback(
    (nextTitle: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      pendingTitleRef.current = nextTitle
      timerRef.current = setTimeout(() => {
        // 발화 = 대기 해제. 언마운트 flush 가 이미 끝난 저장을 다시 보내지 않게 비운다.
        timerRef.current = null
        pendingTitleRef.current = null
        doSave(nextTitle)
      }, 800)
    },
    [doSave],
  )

  // 대기 중 자동저장을 취소하고 그 제목을 돌려준다(대기 없으면 null) — 언마운트 flush·원격 반영이 공유한다.
  const cancelPendingSave = useCallback((): string | null => {
    if (!timerRef.current) return null
    clearTimeout(timerRef.current)
    timerRef.current = null
    const pending = pendingTitleRef.current
    pendingTitleRef.current = null
    return pending
  }, [])

  // 생성 취소 — ESC 또는 버튼. abort 후 상태 복귀. 결과는 완료 시에만 삽입하므로 받은 부분 결과는 버려진다(WP-255).
  const cancelAi = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setAiBusy(false)
  }, [])


  // 원격 수정 반영(WP-170) — AI 비서·다른 탭·다른 사용자가 저장하면 wiki.page.updated SSE → useWikiStream 이 페이지
  // 캐시를 무효화해 page prop 이 더 새 version 으로 바뀐다. 에디터는 마운트 시 본문으로만 초기화되므로 여기서 교체한다.
  // 저장하지 않은 내 편집이 있으면 덮어쓰지 않고 remoteStale 배너로 '최신 내용 불러오기'를 제안한다.
  const [remoteStale, setRemoteStale] = useState(false)
  // 마운트 재생성(key 변경) 대신 제자리 교체하는 이유: 스크롤 컨테이너가 이 컴포넌트 안에 있어 리마운트하면
  // 읽던 위치가 맨 위로 튄다.
  const applyRemote = useCallback(
    () => {
      if (!editor) return
      const next = page
      // 진행 중인 /ai 스트림은 옛 문서 좌표로 토큰을 끼워 넣으므로 먼저 끊는다 — 남겨 두면 교체한 최신본에
      // 반쯤 쓴 AI 출력이 섞여 자동저장된다.
      cancelAi()
      // 대기 중 자동저장은 옛 version 이라 409 만 낸다 — 버리고 최신본 기준으로 다시 시작한다.
      cancelPendingSave()
      const { from } = editor.state.selection
      // emitUpdate=false → 'update' 미발화라 자동저장이 다시 돌지 않는다. 히스토리에서도 빼서 undo 로 옛 본문이
      // 되살아나 저장되는 일을 막는다.
      editor.chain().setMeta('addToHistory', false).setContent(next.body, false).run()
      // 커서는 같은 오프셋 근처로 되돌린다(문서가 짧아졌으면 끝으로).
      editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size))
      setTitle(next.title)
      versionRef.current = next.version
      setLiveVersion(next.version)
      // 다음 내 저장이 원격 수정본을 리비전으로 남기도록 snapshot 을 다시 켠다(작성자가 바뀐 경계).
      firstSaveRef.current = true
      setSaveState('idle')
      setRemoteStale(false)
      // 새 본문의 멘션 토큰을 칩으로 — 캐시된 멘션은 옛 본문 기준이라 다시 조회한 결과로 치환한다.
      // 실패하면 라벨 없이(토큰 라벨 폴백) 치환해 raw 토큰이 남지 않게 한다(마운트 시 하이드레이션과 동일).
      void refetchMentions().then((r) => {
        if (!editor.isDestroyed) hydrateWikiMentions(editor, r.data ?? [])
      })
    },
    [editor, page, cancelAi, cancelPendingSave, refetchMentions],
  )
  useEffect(() => {
    if (!editor) return
    // 내 저장의 self-echo(같은 version)·옛 캐시는 무시.
    if (page.version <= versionRef.current) return
    // 내 저장이 진행 중이면 결과를 기다린다 — 성공하면 versionRef 가 따라잡아 위 가드에서 걸러진다.
    if (saveState === 'saving') return
    // 저장 대기·충돌·AI 생성 중인 내 편집이 있으면 덮어쓰지 않는다.
    if (timerRef.current != null || saveState === 'conflict' || aiBusy) {
      setRemoteStale(true)
      return
    }
    applyRemote()
  }, [editor, page, saveState, aiBusy, applyRemote])

  // 언마운트 시 대기 중 자동저장을 즉시 flush — 페이지 전환(key 리마운트)·뷰포트 lg 경계 전환(데스크톱↔모바일 셸
  // 트리 교체)으로 에디터가 사라질 때 마지막 편집을 잃지 않게 한다. 타이머는 반드시 해제해 늦게 한 번 더
  // (옛 version 으로) PUT 해 409 가 나는 일을 막는다. useEditor 의 destroy 는 다음 틱으로 예약되므로
  // 이 시점엔 에디터 문서를 아직 직렬화할 수 있다.
  // flush promise 는 wikiFlushRegistry 에 등록 — 리마운트된 에디터가 flush 전 캐시(옛 본문·version)로 뜨지 않게
  // WikiPageView 가 끝날 때까지 skeleton 을 보인다(key=page.id 라 page.id 는 이 인스턴스 동안 불변).
  const pageId = page.id
  useEffect(() => {
    return () => {
      const pending = cancelPendingSave()
      if (pending == null) return
      const p = doSaveRef.current(pending, true)
      if (p) trackWikiFlush(pageId, p)
    }
  }, [pageId, cancelPendingSave])

  useEffect(() => {
    if (!editor) return
    // 멘션 하이드레이션 트랜잭션(읽기 시 토큰→칩 치환)은 사용자 편집이 아니므로 자동저장을 건너뛴다.
    // 가드하지 않으면 토큰 포함 페이지를 열기만 해도 snapshot=true PUT 이 발생해 리비전 캐던스가 깨진다.
    // wikiImageUploadPlaceholder(#751) 도 같은 이유로 건너뛴다 — 자리표시자 텍스트(⏳ 이미지
    // 업로드 중…)는 사용자 콘텐츠가 아니라서 저장 대상이 아니다. 실제 이미지로 교체되거나
    // 실패로 제거되는 트랜잭션은 메타가 없어 정상적으로 자동저장을 트리거한다.
    const handler = ({ transaction }: { transaction: { getMeta: (k: string) => unknown } }) => {
      if (transaction.getMeta('wikiMentionHydrate')) return
      if (transaction.getMeta('wikiImageUploadPlaceholder')) return
      scheduleSave(title)
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, title, scheduleSave])

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WikiPageHeader
        crumbs={crumbs}
        saveState={saveState}
        aiState={aiState}
        aiBusy={aiBusy}
        aiAttributed={page.aiLastUsedAt != null}
        onNavigate={(id) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)}
        onAiAction={onHeaderAiAction}
        onDelete={() => setConfirmDelete(true)}
        onViewSource={onViewSource}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col px-8 py-6">
          {/* 선택 텍스트 변형 툴바(톤/번역/확장/축약/다듬기) — 뷰어·생성 중엔 비노출.
              canUseAi(EDITOR/OWNER)일 때만 onCreateIssue 를 전달해 "이슈로 만들기" 버튼을 노출한다.

              형제 목록의 **맨 앞**에 둔다(시각 위치와 무관): BubbleMenu 는 마운트 시 자기 DOM 노드를
              트리에서 떼어내(element.remove()) tippy 에 넘기므로, 그 앞에 조건부 형제가 있으면 해당
              형제가 언마운트될 때 React 가 사라진 앵커에 insertBefore 를 시도해 NotFoundError 로
              페이지 전체가 죽는다. 맨 앞에 두면 뒤따르는 조건부 노드(충돌 배너·빈 CTA 등)가 안전하다. */}
          <WikiAiBubbleToolbar
            editor={editor}
            disabled={!canUseAi || aiBusy}
            onAction={runTransform}
            onCreateIssue={canUseAi ? onCreateIssue : undefined}
          />
          <WikiTableToolbar editor={editor} disabled={!canEdit} />
          <WikiTableContextMenu editor={editor} disabled={!canEdit} />
          {remoteStale ? (
            <div
              data-testid="wiki-remote-stale"
              className="mb-3 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
            >
              다른 곳에서 이 노트가 수정되었습니다. 최신 내용을 불러오면 저장하지 않은 내 수정은 사라집니다.{' '}
              <button type="button" className="underline" onClick={applyRemote}>
                최신 내용 불러오기
              </button>
            </div>
          ) : saveState === 'conflict' && (
            <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.{' '}
              <button type="button" className="underline" onClick={() => window.location.reload()}>
                새로고침
              </button>
            </div>
          )}
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              scheduleSave(e.target.value)
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
          <WikiSummaryCard pageId={page.id} liveVersion={liveVersion} />
          {/* 빈 페이지 AI CTA — 초안 작성이 가장 유효한 순간(#733). 본문이 채워지면 사라진다.
              에디터 아래가 아니라 제목 바로 밑에 둔다: 본문 클릭영역(min-h 300px) 뒤에 두면
              placeholder 와 300px 떨어져 시각적 연결이 끊긴다.
              점선 테두리는 디자인시스템에 규정이 없어 일반 border + bg-muted 표면을 쓴다. */}
          {bodyEmpty && aiState === 'ready' && !aiBusy && (
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
              wiki-editor 클래스는 placeholder CSS 의 스코프(wiki-editor.css). */}
          <EditorContent
            editor={editor}
            onClick={onChipClick}
            className="wiki-editor [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none"
          />
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
          {/* 노트→이슈 생성 다이얼로그 — canUseAi 게이트는 onCreateIssue 전달 여부로 이미 처리됨. */}
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
    </div>
  )
}
