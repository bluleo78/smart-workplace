import { Download, History, Link2, Save, Share2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/button'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { isConflictError } from '@/lib/api-error'
import { cn } from '@/lib/utils'

import { useSaveHtml, useSaveTitle } from '../../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../../hooks/queries/useWikiSpaces'
import { useWikiTree } from '../../../hooks/queries/useWikiTree'
import { isEditRole } from '../../../lib/collab/collabStatus'
import type { WikiPageDetail, WikiPageSummary } from '../../../types/wiki'
import { SandboxedHtmlFrame } from '../../SandboxedHtmlFrame'
import { breadcrumbOrSelf, buildBreadcrumb } from '../wikiBreadcrumb'
import { WikiHtmlFileInput } from '../WikiHtmlFileInput'
import { readHtmlFile } from '../wikiHtmlImportInsert'
import { canManageShare, countDescendants } from '../wikiShare'
import { WikiShareDialog } from '../WikiShareDialog'
import { downloadHtmlSource, rejectOversizedHtmlSource } from './wikiHtmlDocument'
import { WikiHtmlRevisionDialog } from './WikiHtmlRevisionDialog'

/** 소스 칸을 고치는 동안 미리보기를 다시 그리기까지 기다리는 시간(ms) — 글자마다 스크립트를 다시 돌리지 않게(HTML 블록과 같은 값). */
export const HTML_DOCUMENT_PREVIEW_DEBOUNCE_MS = 500

/** 공유 링크로 연 화면(WP-579) — 보기만 한다(원본 내려받기는 된다). 트리·경로는 링크로 볼 수 있는 페이지로 그린다. */
export interface WikiHtmlDocumentShare {
  token: string
  pages: WikiPageSummary[]
  sharedByName: string
}

/** 소스 편집 상태 — 고치기 시작할 때의 version 을 기준으로 잡아 둔다(그사이 캐시가 새 version 을 받아도 남의 저장을 덮지 않고 409 를 받게). */
type SourceDraft = { html: string; baseVersion: number }

/**
 * 「HTML 문서」 페이지 화면(WP-1307) — 원본 HTML 을 그대로 보관·표시하는 페이지. 블록 편집기(동기화 서버)를 쓰지 않는다
 * (서버가 HTML 페이지의 동기화 접근을 409 로 막는다).
 *
 * - 보기: 격리 iframe(SandboxedHtmlFrame allowScripts) — allow-same-origin 이 없어 스크립트·차트는 돌지만 앱 로그인 정보·화면에는 닿지 못한다.
 * - 소스(편집자만): 왼쪽 소스 칸 + 오른쪽 늦춘 미리보기, 「저장」은 고치기 시작한 version 으로 PUT(409 면 알리고 다시 받은 version 으로 기준을 옮긴다 — 소스는 남기고, 다시 저장하면 바꾼다).
 * - 다시 올리기: 고른 파일 원본으로 바꾼다(지금 version 기준). 원본 내려받기: octet-stream Blob 저장(앱 창은 이동하지 않는다).
 * - 공유: 노트와 같은 공유 창(스페이스 편집자만). 버전 기록: 판 목록 + 원본 미리보기 + 되돌리기(편집자만).
 * - 제목: 편집자는 제목 칸에서 고친다(제목만 저장 — 노트와 같은 REST).
 */
export function WikiHtmlDocumentView({ page, spaceId, share }: { page: WikiPageDetail; spaceId: number; share?: WikiHtmlDocumentShare }) {
  const navigate = useNavigate()
  const { data: spaces } = useWikiSpaces()
  const role = share ? undefined : spaces?.find((s) => s.id === spaceId)?.role
  // 공유 링크 화면은 보기만 — 편집 공유여도 원본 저장은 스페이스 멤버 화면에서 한다(WP-1307 결정).
  const canEdit = !share && role != null && isEditRole(role)
  const canShare = canManageShare(role, share != null)
  const { data: spaceTree } = useWikiTree(share ? null : spaceId)
  const tree = share ? share.pages : spaceTree
  const html = page.html ?? ''

  const [draft, setDraft] = useState<SourceDraft | null>(null)
  // 저장이 409 로 막혔는지 — 다시 받은 페이지의 version 으로 기준을 옮겨, 다음 「저장」이 같은 409 에 갇히지 않게 한다.
  // 먼저 저장된 남의 내용은 서버가 버전 기록에 남기므로, 알림을 본 뒤 다시 저장하면 지금 소스로 바꾸고 되돌릴 수도 있다.
  const [conflicted, setConflicted] = useState(false)
  if (conflicted && draft && page.version !== draft.baseVersion) {
    setDraft({ ...draft, baseVersion: page.version })
    setConflicted(false)
  }
  const [shareOpen, setShareOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const saveHtml = useSaveHtml(spaceId)
  const uploadRef = useRef<HTMLInputElement>(null)
  const previewSource = useDebounceValue(draft?.html ?? '', HTML_DOCUMENT_PREVIEW_DEBOUNCE_MS)

  // 제목 — 고치는 중엔 내 입력, 아니면 서버 제목.
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const title = titleDraft ?? page.title
  const saveTitle = useSaveTitle(spaceId, share?.token)
  const titleEnter = useSingleLineEnter()
  const commitTitle = () => {
    if (titleDraft == null) return
    const next = titleDraft.trim()
    setTitleDraft(null)
    if (next !== page.title) saveTitle.mutate({ pageId: page.id, title: next })
  }

  const pagePath = (id: number) => (share ? `/wiki/share/${share.token}/pages/${id}` : `/wiki/spaces/${spaceId}/pages/${id}`)
  const crumbs = useMemo(
    () => breadcrumbOrSelf(buildBreadcrumb(tree ?? [], page.id), { id: page.id, title: page.title }, tree != null),
    [tree, page.id, page.title],
  )
  const spaceName = share ? undefined : spaces?.find((s) => s.id === spaceId)?.name
  const breadcrumbItems: BreadcrumbItem[] = [
    ...(spaceName != null ? [{ key: 'space', label: spaceName, title: spaceName, to: `/wiki/spaces/${spaceId}`, testId: 'wiki-breadcrumb-space' }] : []),
    ...crumbs.map((c, i) =>
      i === crumbs.length - 1
        ? { key: c.id, label: c.title || '제목 없음', title: c.title, testId: 'wiki-breadcrumb-current' }
        : { key: c.id, label: c.title || '제목 없음', title: c.title, to: pagePath(c.id), testId: 'wiki-breadcrumb-ancestor' },
    ),
  ]

  const startSource = () => setDraft({ html, baseVersion: page.version })
  const saveSource = () => {
    if (!draft || rejectOversizedHtmlSource(draft.html)) return
    // 실패(409·413)는 useSaveHtml 이 알린다 — 고치던 소스는 그대로 둔다.
    saveHtml.mutate(
      { pageId: page.id, html: draft.html, version: draft.baseVersion },
      { onSuccess: () => setDraft(null), onError: (e) => setConflicted(isConflictError(e)) },
    )
  }
  const onUpload = async (file: File) => {
    const next = await readHtmlFile(file)
    if (next == null || rejectOversizedHtmlSource(next)) return
    saveHtml.mutate({ pageId: page.id, html: next, version: page.version })
  }
  const shareLabel = page.shared ? '공유 중' : page.shareExpired ? '공유 만료' : '공유'

  const actions = (
    <>
      {share && (
        <span
          data-testid="wiki-page-shared-by"
          className="inline-flex min-w-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
        >
          <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{share.sharedByName}님이 공유</span>
        </span>
      )}
      {/* 보기/소스 — 편집자만. 보는 사람에겐 소스 칸이 쓸모없다(저장할 수 없다). */}
      {canEdit && (
        <div role="group" aria-label="보기 방식" className="inline-flex rounded-md border p-0.5" data-testid="wiki-html-mode">
          <Button
            type="button"
            size="sm"
            variant={draft ? 'ghost' : 'secondary'}
            aria-pressed={!draft}
            className="h-7"
            onClick={() => setDraft(null)}
            data-testid="wiki-html-mode-view"
          >
            보기
          </Button>
          <Button
            type="button"
            size="sm"
            variant={draft ? 'secondary' : 'ghost'}
            aria-pressed={draft != null}
            className="h-7"
            onClick={() => (draft ? undefined : startSource())}
            data-testid="wiki-html-mode-source"
          >
            소스
          </Button>
        </div>
      )}
      {canEdit && !draft && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={saveHtml.isPending}
          data-testid="wiki-html-reupload"
        >
          <Upload aria-hidden="true" />
          다시 올리기
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => downloadHtmlSource(page.title, html)} data-testid="wiki-html-download">
        <Download aria-hidden="true" />
        원본 내려받기
      </Button>
      {canShare && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShareOpen(true)}
          data-testid="wiki-share-button"
          className={cn(page.shared && 'border-primary/40 text-primary hover:text-primary')}
        >
          <Share2 aria-hidden="true" />
          {shareLabel}
        </Button>
      )}
      {!share && (
        <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen(true)} data-testid="wiki-html-history">
          <History aria-hidden="true" />
          버전 기록
        </Button>
      )}
    </>
  )

  return (
    <Page data-testid="wiki-html-document">
      <Page.Header
        data-testid="wiki-page-header"
        leadingGrow
        srTitle={page.title || '제목 없음'}
        leading={<Breadcrumb items={breadcrumbItems} aria-label="페이지 경로" data-testid="wiki-breadcrumb" />}
        actions={actions}
      />
      <Page.Body padded={false} className="flex-col">
        {/* 제목 줄 — 편집자는 바로 고친다(Enter·포커스 아웃에 저장). */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          {canEdit ? (
            <input
              value={title}
              onChange={(e) => setTitleDraft(e.target.value.replace(/[\r\n]+/g, ' '))}
              onBlur={commitTitle}
              onCompositionEnd={titleEnter.onCompositionEnd}
              onKeyDown={(e) => titleEnter.handleEnter(e, () => e.currentTarget.blur())}
              placeholder="제목 없음"
              aria-label="제목"
              maxLength={255}
              data-testid="wiki-html-title"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-lg font-semibold outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <p className="min-w-0 flex-1 truncate text-lg font-semibold" data-testid="wiki-html-title">
              {page.title || '제목 없음'}
            </p>
          )}
          {draft && (
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)} data-testid="wiki-html-source-cancel">
                취소
              </Button>
              <Button type="button" size="sm" onClick={saveSource} disabled={saveHtml.isPending} data-testid="wiki-html-source-save">
                <Save aria-hidden="true" />
                저장
              </Button>
            </div>
          )}
        </div>
        {draft ? (
          // 소스 — 넓으면 [소스 | 미리보기] 나란히, 좁으면 위아래로 쌓는다.
          <div className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
            <textarea
              value={draft.html}
              onChange={(e) => setDraft({ ...draft, html: e.target.value })}
              spellCheck={false}
              aria-label="HTML 소스"
              data-testid="wiki-html-source"
              className="min-h-0 resize-none border-b bg-muted/30 p-3 font-mono text-xs leading-5 outline-none md:border-b-0 md:border-r"
            />
            <SandboxedHtmlFrame
              allowScripts
              html={previewSource}
              title={`${page.title || '제목 없음'} 미리보기`}
              data-testid="wiki-html-preview"
              className="h-full min-h-0 w-full border-0 bg-background"
            />
          </div>
        ) : (
          <SandboxedHtmlFrame
            allowScripts
            html={html}
            title={page.title || '제목 없음'}
            data-testid="wiki-html-frame"
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        )}
      </Page.Body>
      {canEdit && <WikiHtmlFileInput inputRef={uploadRef} testId="wiki-html-reupload-input" onFile={(f) => void onUpload(f)} />}
      {canShare && (
        <WikiShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          pageId={page.id}
          spaceId={spaceId}
          pageTitle={page.title}
          childCount={countDescendants(tree ?? [], page.id)}
          onOpenPage={(id) => navigate(pagePath(id))}
        />
      )}
      {!share && (
        <WikiHtmlRevisionDialog open={historyOpen} onOpenChange={setHistoryOpen} page={page} canRestore={canEdit} spaceId={spaceId} />
      )}
    </Page>
  )
}
