import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Markdown } from 'tiptap-markdown'

import { useSavePage } from '../../hooks/queries/useWikiMutations'
import type { WikiPageDetail } from '../../types/wiki'

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict'

/** 위키 에디터 — 마크다운 직렬화 + debounce 자동저장(낙관적 동시성). */
export function WikiEditor({ page, spaceId }: { page: WikiPageDetail; spaceId: number }) {
  const save = useSavePage(spaceId)
  const [title, setTitle] = useState(page.title)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const versionRef = useRef(page.version)
  const firstSaveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor(
    {
      extensions: [StarterKit, Markdown],
      content: page.body,
    },
    [page.id],
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
    const handler = () => scheduleSave(title)
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, title, scheduleSave])

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
      <div className="pt-2 text-xs text-muted-foreground">
        {saveState === 'saving' && '저장 중…'}
        {saveState === 'saved' && '저장됨'}
      </div>
    </div>
  )
}
