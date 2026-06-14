import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Markdown } from 'tiptap-markdown'

import { Button } from '@/components/ui/button'
import { RenameDialog } from '@/components/ui/rename-dialog'

import { useSavePage } from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { startWikiAiStream } from '../../hooks/useWikiAiStream'
import type { WikiPageDetail } from '../../types/wiki'
import type { WikiAiAction } from './WikiSlashMenu'
import { createWikiSlashExtension } from './wikiSlashSuggestion'

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict'

/** 위키 에디터 — 마크다운 직렬화 + debounce 자동저장(낙관적 동시성) + 인에디터 /ai 스트리밍. */
export function WikiEditor({ page, spaceId }: { page: WikiPageDetail; spaceId: number }) {
  const save = useSavePage(spaceId)
  const [title, setTitle] = useState(page.title)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const versionRef = useRef(page.version)
  const firstSaveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 역할 게이트 — OWNER|EDITOR 만 /ai 슬래시 사용. VIEWER 면 메뉴 미노출.
  const { data: spaces } = useWikiSpaces()
  const role = spaces?.find((s) => s.id === spaceId)?.role
  const canUseAi = role === 'OWNER' || role === 'EDITOR'

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
      extensions: [StarterKit, Markdown, slashExtension],
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
    const handler = () => scheduleSave(title)
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
    <div className="mx-auto flex h-full max-w-3xl flex-col px-8 py-6">
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
        className="mb-4 w-full border-0 bg-transparent text-3xl font-bold outline-none placeholder:text-muted-foreground/40"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent
          editor={editor}
          className="[&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none"
        />
      </div>
      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
        {saveState === 'saving' && '저장 중…'}
        {saveState === 'saved' && '저장됨'}
        {/* AI 생성 중 표시 + 취소 — 부분 텍스트는 이미 삽입되어 자동저장된다. */}
        {aiBusy && (
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
        )}
      </div>
      {/* draft 토픽 입력 — 확인 시 prompt 로 draft 액션 실행. */}
      <RenameDialog
        open={draftOpen}
        title="AI 초안 작성"
        initialValue=""
        onConfirm={(topic) => runAction('draft', topic)}
        onClose={() => setDraftOpen(false)}
      />
    </div>
  )
}
