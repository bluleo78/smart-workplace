import './wiki-editor.css'

import { markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'

import { pageTitleClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

import { WikiImage } from './wikiImageNode'
import { useMentionChipTextOf, WikiMentionLabelsProvider } from './wikiMentionLabels'
import { WikiMention } from './wikiMentionNode'
import { revisionDiffDecorations } from './wikiRevisionDiff'
import { previewDocOf, revisionDiffOf, WikiRevisionDiffHighlight, wikiRevisionDiffKey } from './wikiRevisionPreviewDoc'

export interface WikiRevisionPreviewProps {
  /** 이 노트 id — 멘션 칩 라벨 조회(WikiMentionLabelsProvider)에 쓴다. */
  pageId: number
  /** 보는 판 본문(마크다운). */
  body: string
  /** 보는 판 제목. */
  title: string
  /**
   * 비교 대상 — 다음 판 본문(마크다운) 또는 라이브 에디터 문서. 없으면(null) 차이를 그리지 않는다.
   * 라이브 문서는 반드시 **스냅샷**(고른 순간의 editor.state.doc — 불변 노드)을 넘긴다. 입력마다 바뀌는 doc 을 매 렌더 넘기면
   * effect 가 원격 입력마다 차이를 다시 계산하고 미리보기가 계속 바뀐다(useWikiRevisionHistory 가 선택 때 한 번 찍는다).
   */
  compareTo: PMNode | string | null
  /** 켜면 다음 판 대비 차이(추가 초록·삭제 빨강 취소선)를 그린다. */
  showDiff: boolean
  className?: string
}

/**
 * 노트 버전 기록의 읽기 전용 미리보기(WP-298) — 리비전 본문을 노트와 같은 타이포로 그리고, showDiff 면 차이를 데코레이션으로 칠한다.
 * 문서 스키마 확장(이미지·멘션 NodeView 포함)만 쓰고 동기화·슬래시·AI·자리표시·표 단축키는 넣지 않는다 — 편집하지 않는 화면이다.
 * 에디터는 한 번 만들고 본문·비교 대상이 바뀔 때 내용과 데코레이션만 갈아 끼운다(판을 넘길 때 에디터 재생성 비용을 피한다).
 */
export function WikiRevisionPreview(props: WikiRevisionPreviewProps) {
  // 라벨 Provider 를 바깥에 둔다 — 칩 NodeView(EditorContent 포털)와 추가 글자 위젯(아래 effect)이 같은 라벨 조회를 쓴다.
  return (
    <WikiMentionLabelsProvider pageId={props.pageId}>
      <RevisionPreviewContent {...props} />
    </WikiMentionLabelsProvider>
  )
}

/** 미리보기 본문 — 라벨 Provider 안에서 그려야 추가된 멘션 위젯도 칩과 같은 라벨(USER 는 @ 접두)을 쓴다(WP-324). */
function RevisionPreviewContent({ body, title, compareTo, showDiff, className }: WikiRevisionPreviewProps) {
  const mentionText = useMentionChipTextOf()
  const editor = useEditor(
    {
      extensions: [...wikiSchemaExtensions({ image: WikiImage, mention: WikiMention }), WikiRevisionDiffHighlight],
      editable: false,
    },
    [],
  )

  // 보는 판 파싱은 본문이 바뀔 때만 — 변경 표시 토글은 다시 파싱하지 않는다. 차이는 표시가 켜졌을 때만 계산한다(끈 채로 큰 노트를 넘길 때 비용을 내지 않게).
  const from = useMemo(() => markdownToDoc(body), [body])
  const diff = useMemo(() => (showDiff ? revisionDiffOf(from, compareTo) : null), [from, compareTo, showDiff])

  // 그릴 문서(보는 판 또는 차이 문서) — 에디터 스키마로 옮긴 결과. 멘션 라벨이 바뀌어도 다시 만들지 않는다.
  const preview = useMemo(() => (editor ? previewDocOf(editor.schema, from, diff) : null), [editor, from, diff])
  // 마지막으로 내용을 갈아 끼운 미리보기 — 같으면 데코레이션만 바꾼다.
  const drawnRef = useRef<typeof preview>(null)

  // 그릴 문서가 바뀌면 내용과 데코레이션을 한 트랜잭션으로 갈아 끼운다 — 두 번 나눠 보내면 새 내용이 옛 데코(매핑된)로
  // 한 번 그려졌다가 바뀐다. 데코는 교체 뒤 문서(tr.doc)에 대고 만든다(좌표는 previewDocOf 결과와 같다).
  // 멘션 라벨 조회만 도착하면(mentionText 만 바뀜) 문서는 두고 데코레이션만 다시 그려 추가 글자 위젯의 대체 라벨을 실제 라벨로 바꾼다.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !preview) return
    const { state } = editor
    const tr = state.tr
    if (drawnRef.current !== preview) tr.replaceWith(0, state.doc.content.size, preview.doc.content)
    drawnRef.current = preview
    tr.setMeta(wikiRevisionDiffKey, revisionDiffDecorations(tr.doc, preview.marks, mentionText)).setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }, [editor, preview, mentionText])

  return (
    <div data-testid="wiki-revision-preview" className={cn('flex flex-col', className)}>
      {/* 빈 제목은 에디터 제목 입력의 자리표시와 같은 문구를 흐리게 보인다. */}
      <h1 className={cn('mb-4 break-words', pageTitleClass, !title && 'text-muted-foreground/40')}>{title || '제목 없음'}</h1>
      {/* 칩 NodeView 는 EditorContent 가 렌더하는 포털이라 라벨 Provider(WikiRevisionPreview) 안에 있어야 라벨이 채워진다. */}
      <EditorContent editor={editor} className="wiki-editor [&_.ProseMirror]:outline-none" />
    </div>
  )
}
