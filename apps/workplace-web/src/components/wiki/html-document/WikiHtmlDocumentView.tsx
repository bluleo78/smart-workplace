import { Download, History, Link2, Pencil, Save, Share2, Unlock, Upload } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
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
import { useHtmlEditSession, useWikiHtmlLock } from './useHtmlEditSession'
import { downloadHtmlSource, holderLabel, htmlLockBannerText, rejectOversizedHtmlSource } from './wikiHtmlDocument'
import { WikiHtmlRevisionDialog } from './WikiHtmlRevisionDialog'

/** 소스 칸을 고치는 동안 미리보기를 다시 그리기까지 기다리는 시간(ms) — 글자마다 스크립트를 다시 돌리지 않게(HTML 블록과 같은 값). */
export const HTML_DOCUMENT_PREVIEW_DEBOUNCE_MS = 500

/**
 * 머리줄 보조 단추(다시 올리기·원본 내려받기·버전 기록)의 글자 — 아주 넓은 화면(2xl)에서만 보이고 그보다 좁으면 아이콘만 둔다(글자는 화면 낭독기·title 로 남는다).
 * 「보기 | 편집 | 소스」·저장·취소까지 한 줄에 서면 1280px 화면에서 머리줄 가운데의 AI 칩 아래로 단추가 들어가 눌리지 않았다(WP-1308).
 */
const COMPACT_LABEL = 'max-2xl:sr-only'

/** 보는 방식 — 보기(격리 iframe)·소스(읽기 전용)·편집(잠금을 쥐고 소스 + 미리보기). */
type HtmlViewMode = 'view' | 'source' | 'edit'

/** 다른 창에서 내가 편집 중일 때 다시 올리기·되돌리기를 막는 이유 — 서버가 편집 세션 없는 쓰기를 막는다. */
const LOCKED_ELSEWHERE_BY_ME = '다른 창에서 편집 중입니다 — 그 창에서 저장하거나 취소한 뒤 할 수 있어요'
/** 이 창에서 편집하는 동안 되돌리기를 막는 이유. */
const RESTORE_WHILE_EDITING = '편집 중에는 되돌릴 수 없어요 — 저장하거나 취소한 뒤 되돌리세요'

/** 공유 링크로 연 화면(WP-579) — 보기만 한다(원본 내려받기는 된다). 트리·경로는 링크로 볼 수 있는 페이지로 그린다. */
export interface WikiHtmlDocumentShare {
  token: string
  pages: WikiPageSummary[]
  sharedByName: string
}

/**
 * 「HTML 문서」 페이지 화면(WP-1307) — 원본 HTML 을 그대로 보관·표시하는 페이지. 블록 편집기(동기화 서버)를 쓰지 않는다
 * (서버가 HTML 페이지의 동기화 접근을 409 로 막는다).
 *
 * - 보기: 격리 iframe(SandboxedHtmlFrame allowScripts) — allow-same-origin 이 없어 스크립트·차트는 돌지만 앱 로그인 정보·화면에는 닿지 못한다.
 * - 소스: 원본 HTML 을 읽기 전용으로 본다.
 * - 편집(편집자만, WP-1308): 잠금을 얻고 왼쪽 소스 칸 + 오른쪽 늦춘 미리보기로 고친다(보이는 화면 편집은 WP-1309). 「저장」은 고치기 시작한 version 으로
 *   PUT(409 면 알리고 다시 받은 version 으로 기준을 옮긴다 — 소스는 남기고, 다시 저장하면 바꾼다), 「취소」는 잠금을 풀고 고친 내용을 버린다.
 *   다른 사람에겐 위 띠 「○○ 님이 편집 중입니다」를 띄우고 편집·다시 올리기를 막는다(서버도 막는다). 스페이스 소유자는 「잠금 풀기」로 강제로 푼다.
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

  // 편집 잠금(WP-1308) — 공유 링크 화면은 보기만 해서 잠금을 보지 않는다. mine·강제 풀기는 내 id·스페이스 역할로 가린다.
  const { user } = useAuth()
  const { data: lock } = useWikiHtmlLock(page.id, !share, { userId: user?.id, role })
  const saveHtml = useSaveHtml(spaceId)
  const session = useHtmlEditSession(page.id, { lock, saving: saveHtml.isPending, userId: user?.id })
  const draft = session.editing
  const lockedByOther = lock?.locked === true && !lock.mine
  // 띠·막힌 단추가 함께 쓰는 이유 문구 — 한 번만 만든다.
  const lockText = lockedByOther ? htmlLockBannerText(lock) : undefined
  // 이 창 밖에서 누가(남·내 다른 창) 편집 중 — 편집 세션 없는 쓰기(다시 올리기·되돌리기)를 서버가 막으므로 화면도 막는다.
  const lockedElsewhere = lock?.locked === true && !draft
  // 소스(읽기 전용) 보기 — 편집 중이 아닐 때만 의미가 있다.
  const [showSource, setShowSource] = useState(false)
  const mode: HtmlViewMode = draft ? 'edit' : showSource && !share ? 'source' : 'view'
  // 저장이 409 로 막혔는지 — 다시 받은 페이지의 version 으로 기준을 옮겨, 다음 「저장」이 같은 409 에 갇히지 않게 한다.
  // 먼저 저장된 남의 내용은 서버가 버전 기록에 남기므로, 알림을 본 뒤 다시 저장하면 지금 소스로 바꾸고 되돌릴 수도 있다.
  // 잠금을 쥔 동안엔 서버가 다른 쓰기를 막으니 이 409 는 「편집」으로 잠금을 얻기 직전에 끼어든 저장에서만 생긴다(useHtmlEditSession.rebase).
  const [conflicted, setConflicted] = useState(false)
  if (conflicted && draft && page.version !== draft.baseVersion) {
    session.rebase(page.version)
    setConflicted(false)
  }
  // 「잠금 풀기」(스페이스 소유자) 확인 창 — 편집하던 사람의 내용은 그 사람의 임시 저장본으로 남는다.
  const [forceOpen, setForceOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
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

  const saveSource = () => {
    if (!draft || rejectOversizedHtmlSource(draft.html)) return
    // 실패(409·413)는 useSaveHtml 이 알린다 — 고치던 소스는 그대로 둔다. 성공하면 서버가 잠금을 풀었다.
    saveHtml.mutate(
      { pageId: page.id, html: draft.html, version: draft.baseVersion, lockToken: session.lockToken() },
      { onSuccess: () => session.finishSaved(), onError: (e) => setConflicted(isConflictError(e)) },
    )
  }
  const onUpload = async (file: File) => {
    const next = await readHtmlFile(file)
    if (next == null || rejectOversizedHtmlSource(next)) return
    saveHtml.mutate({ pageId: page.id, html: next, version: page.version })
  }
  const shareLabel = page.shared ? '공유 중' : page.shareExpired ? '공유 만료' : '공유'

  // 보기 방식 단추 — 지금 mode 하나에서 눌림·막힘을 가린다. 편집 중엔 보기·소스가 막히고, 편집은 남이 편집 중이거나 시작하는 중이면 막힌다.
  const modeButtons: { mode: HtmlViewMode; label: string; icon?: ReactNode; disabled: boolean; title?: string; onClick: () => void }[] = [
    { mode: 'view', label: '보기', disabled: mode === 'edit', onClick: () => setShowSource(false) },
    ...(canEdit
      ? [
          {
            mode: 'edit' as const,
            label: '편집',
            icon: <Pencil aria-hidden="true" />,
            disabled: mode !== 'edit' && (lockedByOther || session.start.isPending),
            title: lockText,
            onClick: () => {
              if (mode !== 'edit') session.start.mutate()
            },
          },
        ]
      : []),
    { mode: 'source', label: '소스', disabled: mode === 'edit', onClick: () => setShowSource(true) },
  ]
  // 다시 올리기·되돌리기를 막는 이유(편집 세션이 없는 쓰기) — 남이면 띠 문구, 내 다른 창이면 그 안내.
  const blockedWriteReason = lockedElsewhere ? (lockText ?? LOCKED_ELSEWHERE_BY_ME) : undefined

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
      {/* 보기 | 편집 | 소스 — 공유 링크 화면엔 없다. 편집은 편집자만, 편집하는 동안 보기·소스는 잠긴다(저장·취소로 끝낸다). */}
      {!share && (
        <div role="group" aria-label="보기 방식" className="inline-flex rounded-md border p-0.5" data-testid="wiki-html-mode">
          {modeButtons.map((b) => (
            <Button
              key={b.mode}
              type="button"
              size="sm"
              variant={mode === b.mode ? 'secondary' : 'ghost'}
              aria-pressed={mode === b.mode}
              className="h-7"
              disabled={b.disabled}
              title={b.title}
              onClick={b.onClick}
              data-testid={`wiki-html-mode-${b.mode}`}
            >
              {b.icon}
              {b.label}
            </Button>
          ))}
        </div>
      )}
      {draft && (
        <>
          <Button type="button" size="sm" variant="outline" onClick={session.cancel} data-testid="wiki-html-source-cancel">
            취소
          </Button>
          <Button type="button" size="sm" onClick={saveSource} disabled={saveHtml.isPending} data-testid="wiki-html-source-save">
            <Save aria-hidden="true" />
            저장
          </Button>
        </>
      )}
      {canEdit && !draft && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={saveHtml.isPending || lockedElsewhere}
          title={blockedWriteReason ?? '다시 올리기'}
          data-testid="wiki-html-reupload"
        >
          <Upload aria-hidden="true" />
          <span className={COMPACT_LABEL}>다시 올리기</span>
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => downloadHtmlSource(page.title, html)}
        title="원본 내려받기"
        data-testid="wiki-html-download"
      >
        <Download aria-hidden="true" />
        <span className={COMPACT_LABEL}>원본 내려받기</span>
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
        <Button type="button" size="sm" variant="outline" onClick={() => setHistoryOpen(true)} title="버전 기록" data-testid="wiki-html-history">
          <History aria-hidden="true" />
          <span className={COMPACT_LABEL}>버전 기록</span>
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
        {/* 남이 편집 중(WP-1308) — 저장될 때까지 보기만 한다. 스페이스 소유자에겐 「잠금 풀기」가 붙는다. */}
        {lockedByOther && (
          <div
            role="status"
            data-testid="wiki-html-lock-banner"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-text"
          >
            <Pencil className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{lockText}</span>
            {lock?.canForceRelease && (
              <Button type="button" size="sm" variant="outline" onClick={() => setForceOpen(true)} data-testid="wiki-html-force-unlock">
                <Unlock aria-hidden="true" />
                잠금 풀기
              </Button>
            )}
          </div>
        )}
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
        </div>
        {mode === 'edit' && draft ? (
          // 소스 — 넓으면 [소스 | 미리보기] 나란히, 좁으면 위아래로 쌓는다.
          <div className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
            <textarea
              value={draft.html}
              onChange={(e) => session.change(e.target.value)}
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
        ) : mode === 'source' ? (
          // 소스(읽기 전용) — 고치려면 「편집」을 누른다.
          <textarea
            value={html}
            readOnly
            spellCheck={false}
            aria-label="HTML 소스(읽기 전용)"
            data-testid="wiki-html-source-readonly"
            className="min-h-0 flex-1 resize-none bg-muted/30 p-3 font-mono text-xs leading-5 outline-none"
          />
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
        <WikiHtmlRevisionDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          page={page}
          canRestore={canEdit}
          restoreBlockedReason={draft ? RESTORE_WHILE_EDITING : blockedWriteReason}
          spaceId={spaceId}
        />
      )}
      {/* 이어 고칠지 묻기(WP-1308) — 저장·취소 없이 끝난 편집의 임시 저장본이 남아 있다. 답 없이 닫으면 편집을 시작하지 않는다. */}
      {/* 단추로 닫히는 것은 각 단추가 답한다 — onOpenChange 로 「답 없이 닫힘」을 판정하면 단추 클릭 뒤에도 불려 잠금을 풀어 버린다. Esc 만 따로 본다. */}
      <AlertDialog open={session.resume != null}>
        <AlertDialogContent data-testid="wiki-html-resume-dialog" onEscapeKeyDown={() => session.dismissResume()}>
          <AlertDialogHeader>
            <AlertDialogTitle>고치던 내용이 남아 있어요</AlertDialogTitle>
            <AlertDialogDescription>
              지난번에 저장하지 않고 끝난 편집 내용이 임시 저장본으로 남아 있습니다. 이어서 고칠까요?
              {session.resume?.draft.pageChangedSince && (
                <span className="mt-2 block text-warning-text" data-testid="wiki-html-resume-changed">
                  그사이 다른 사람이 이 문서를 저장했습니다 — 이어서 고쳐 저장하면 그 내용을 덮어씁니다(덮어쓴 내용은 버전 기록에 남습니다).
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => session.answerResume(false)} data-testid="wiki-html-resume-fresh">
              새로 시작
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => session.answerResume(true)} data-testid="wiki-html-resume-continue">
              이어 고치기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 「잠금 풀기」 확인(스페이스 소유자) */}
      <AlertDialog open={forceOpen} onOpenChange={setForceOpen}>
        <AlertDialogContent data-testid="wiki-html-force-unlock-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>잠금을 풀까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${holderLabel(lock)} 님의 편집이 끝나고 다른 사람이 편집할 수 있게 됩니다. 고치던 내용은 그 사람의 임시 저장본으로 남습니다.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              disabled={session.forceRelease.isPending}
              onClick={(e) => {
                e.preventDefault()
                session.forceRelease.mutate(undefined, { onSuccess: () => setForceOpen(false) })
              }}
              data-testid="wiki-html-force-unlock-confirm"
            >
              잠금 풀기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}
