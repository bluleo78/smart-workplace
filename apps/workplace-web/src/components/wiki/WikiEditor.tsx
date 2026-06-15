import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Markdown } from 'tiptap-markdown'

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
import { WikiBacklinksPanel } from './WikiBacklinksPanel'
import { buildBreadcrumb } from './wikiBreadcrumb'
import { WikiDeletePageDialog } from './WikiDeletePageDialog'
import { hydrateWikiMentions } from './wikiMentionHydrate'
import { WikiMention } from './wikiMentionNode'
import { createWikiMentionExtension } from './wikiMentionSuggestion'
import { WikiPageHeader, type SaveState } from './WikiPageHeader'
import type { WikiAiAction } from './WikiSlashMenu'
import { createWikiSlashExtension } from './wikiSlashSuggestion'

/** 위키 에디터 — 마크다운 직렬화 + debounce 자동저장(낙관적 동시성) + 인에디터 /ai 스트리밍. */
export function WikiEditor({ page, spaceId }: { page: WikiPageDetail; spaceId: number }) {
  const navigate = useNavigate()
  const save = useSavePage(spaceId)
  const del = useDeletePage(spaceId)
  const { data: tree } = useWikiTree(spaceId)
  // 브레드크럼 — 이미 로드된 전체 트리에서 파생(추가 API 없음).
  const crumbs = useMemo(() => buildBreadcrumb(tree ?? [], page.id), [tree, page.id])
  // 현재 페이지 삭제 확인 다이얼로그 상태.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [title, setTitle] = useState(page.title)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const versionRef = useRef(page.version)
  const firstSaveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 역할 게이트 — OWNER|EDITOR 만 /ai 슬래시 사용. VIEWER 면 메뉴 미노출.
  const { data: spaces } = useWikiSpaces()
  const role = spaces?.find((s) => s.id === spaceId)?.role
  const canUseAi = role === 'OWNER' || role === 'EDITOR'
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
  // draft 토픽 입력 다이얼로그 상태.
  const [draftOpen, setDraftOpen] = useState(false)

  // 슬래시 확장이 스테일 없이 참조할 ref 들(canUseAi·액션 콜백). 확장은 1회 생성되므로
  // 최신값은 effect 에서 ref 에 동기화한다(RichInput 의 membersRef/onSubmitRef 패턴).
  const canUseAiRef = useRef(canUseAi)
  useEffect(() => {
    canUseAiRef.current = canUseAi
  })

  // action → startWikiAiStream 트리거. summarize/continue 는 즉시, draft 는 토픽 입력 후.
  const runAction = useCallback(
    (action: WikiAiAction, prompt?: string) => {
      if (!editorRef.current) return
      // 진행 중 스트림이 있으면 먼저 중단(latest action wins). 이렇게 하지 않으면 두 스트림의
      // onDelta 가 토큰을 교차 삽입하고, abortRef 가 덮어써져 이전 스트림이 취소 불가가 되며,
      // 먼저 끝난 스트림의 onDone 이 아직 진행 중인 스트림의 aiBusy/abortRef 를 지워버린다.
      abortRef.current?.()
      abortRef.current = null
      setAiBusy(true)
      const handle = startWikiAiStream({
        pageId: page.id,
        action,
        prompt,
        onDelta: (text) => {
          // 커서 위치에 토큰 삽입 — 'update' 이벤트가 발화돼 자동저장이 자연히 트리거된다.
          editorRef.current?.commands.insertContent(text)
        },
        onDone: () => {
          setAiBusy(false)
          abortRef.current = null
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

  // 슬래시 메뉴 선택 콜백 — draft 면 토픽 입력 다이얼로그를 먼저 연다.
  const onSlashAction = useCallback((action: WikiAiAction) => {
    if (action === 'draft') {
      setDraftOpen(true)
      return
    }
    runActionRef.current(action)
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

  // 슬래시 확장 — 마운트 시 1회 생성. ctx ref 는 suggestion 콜백(allow/command)에서만 역참조되며
  // 사용자가 '/' 를 입력할 때 ProseMirror 가 호출하므로 렌더 시점에 동기 실행되지 않아 안전하다
  // (RichInput 의 membersRef 패턴 동일 — react-hooks/refs 의 보수적 false positive).
  // eslint-disable-next-line react-hooks/refs
  const slashExtension = useMemo(() => createWikiSlashExtension({ canUseAiRef, onActionRef }), [])

  const editor = useEditor(
    {
      // '@'(멘션) 과 '/'(AI) 는 char 가 달라 충돌하지 않는다. WikiMention 노드 + 두 suggestion 확장.
      extensions: [StarterKit, Markdown, WikiMention, mentionExtension, slashExtension],
      content: page.body,
    },
    [page.id],
  )

  // insertContent·취소 시 editor 참조를 ref 로도 보관(콜백 스테일 회피).
  const editorRef = useRef(editor)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    editorRef.current = editor
  })

  // 로드 라운드트립 — 본문에 텍스트로 살아남은 멘션 토큰을 칩(wikiMention 노드)으로 치환.
  // useWikiMentions 결과(라벨 해소)를 기다렸다가 라벨까지 채워 1회 치환한다(placeholder 재치환 회피).
  // 토큰을 노드로 바꾸면 더는 텍스트가 아니므로 재스캔 대상이 사라져 한 번이면 충분하다.
  const { data: pageMentions, isError: mentionsError } = useWikiMentions(page.id)
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

  const doSave = useCallback(
    (nextTitle: string) => {
      if (!editor) return
      if (saveState === 'conflict') return
      const body = editor.storage.markdown.getMarkdown()
      const snapshot = firstSaveRef.current
      setSaveState('saving')
      save.mutate(
        { pageId: page.id, req: { title: nextTitle, body, version: versionRef.current, snapshot } },
        {
          onSuccess: (data) => {
            versionRef.current = data.version
            firstSaveRef.current = false
            setSaveState('saved')
          },
          onError: (err) => {
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

  const scheduleSave = useCallback(
    (nextTitle: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => doSave(nextTitle), 800)
    },
    [doSave],
  )

  useEffect(() => {
    if (!editor) return
    // 멘션 하이드레이션 트랜잭션(읽기 시 토큰→칩 치환)은 사용자 편집이 아니므로 자동저장을 건너뛴다.
    // 가드하지 않으면 토큰 포함 페이지를 열기만 해도 snapshot=true PUT 이 발생해 리비전 캐던스가 깨진다.
    const handler = ({ transaction }: { transaction: { getMeta: (k: string) => unknown } }) => {
      if (transaction.getMeta('wikiMentionHydrate')) return
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

  // 생성 취소 — ESC 또는 버튼. abort 후 상태 복귀(부분 삽입은 자동저장이 보존).
  const cancelAi = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setAiBusy(false)
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
        canUseAi={canUseAi}
        onNavigate={(id) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)}
        onDraft={() => setDraftOpen(true)}
        onDelete={() => setConfirmDelete(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col px-8 py-6">
          {saveState === 'conflict' && (
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
            placeholder="제목 없음"
            className={`mb-4 w-full border-0 bg-transparent outline-none placeholder:text-muted-foreground/40 ${pageTitleClass}`}
          />
          {/* 멘션 칩 클릭 내비게이션은 래퍼 onClick 에서 위임 처리(closest[data-mtype]). */}
          <EditorContent
            editor={editor}
            onClick={onChipClick}
            className="[&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none"
          />
          {/* 백링크 패널 — 이 페이지를 참조하는 다른 위키 페이지(빈 배열이면 자체적으로 숨김). */}
          <WikiBacklinksPanel pageId={page.id} />
          {/* AI 생성 중 표시 + 취소 — 부분 텍스트는 이미 삽입되어 자동저장된다. */}
          {aiBusy && (
            <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2" data-testid="wiki-ai-busy">
                생성 중…
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
        onConfirm={handleDeleteCurrent}
      />
    </div>
  )
}
