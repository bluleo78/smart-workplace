import '../../components/wiki/wiki-editor.css'

import { markdownToDoc, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor } from '@tiptap/react'
import { Link2 } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { BrandMark } from '@/components/layout/BrandMark'
import { ResourceErrorState } from '@/components/layout/ResourceErrorState'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { parseId } from '@/lib/historyParam'
import { savePendingPushTarget } from '@/lib/push/openTarget'
import { cn } from '@/lib/utils'

import { fetchPublicWikiShare, WikiPublicShareError } from '../../api/wikiPublic'
import { WikiPageSkeleton } from '../../components/wiki/WikiPageSkeleton'
import { WikiSharePageSelect } from '../../components/wiki/WikiSharePageSelect'
import { WikiShareLoadError, WikiShareTreeNav } from '../../components/wiki/WikiShareViewParts'
import { wikiKeys } from '../../hooks/queries/wikiKeys'
import type { WikiPublicShare } from '../../types/wiki'

/** 검색엔진 색인 막기 — 이 화면이 떠 있는 동안 robots meta 를 둔다(서버도 X-Robots-Tag 를 보낸다). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

/** 탭 제목을 문서 제목으로 — 떠날 때 원래 제목으로 되돌린다. */
function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return
    const prev = document.title
    document.title = `${title} · Gen:iA Works`
    return () => {
      document.title = prev
    }
  }, [title])
}

/** 외부 보기 요청 실패의 HTTP 상태 — 서버 응답이 아니면(네트워크 등) null. */
function statusOf(error: unknown): number | null {
  return error instanceof WikiPublicShareError ? error.status : null
}

/**
 * 노트 외부 보기(WP-579) — 로그인하지 않은 사람이 외부(PUBLIC) 링크를 연 화면. 앱 셸 없이 문서만 읽기 전용으로 그린다.
 * 작성자·사람 정보는 없고, 본문 속 내부 링크·멘션은 서버가 이미 가렸다. 로그인하면 열리는 내부 링크(401)면 로그인으로 보낸다.
 */
export function WikiPublicSharePage() {
  useNoIndex()
  const navigate = useNavigate()
  const location = useLocation()
  // 입구(WikiShareGate)가 부모 라우트라 하위 경로의 :pageId 는 useParams 로 보이지 않는다 — 주소에서 직접 읽는다.
  const { token = '' } = useParams()
  const pageId = parseId(location.pathname.match(/\/pages\/([^/]+)$/)?.[1] ?? null) ?? undefined
  const q = useQuery({
    queryKey: wikiKeys.publicShare(token, pageId ?? null),
    queryFn: () => fetchPublicWikiShare(token, pageId),
    retry: false,
    // 열 때마다 최신 — 앱 기본 staleTime 이면 옛 응답(해제 전 본문)을 그대로 보여 주고 다시 묻지 않는다.
    staleTime: 0,
    refetchOnMount: 'always',
    // 하위 페이지로 옮기는 동안 이전 화면(트리·본문)을 그대로 두어 깜빡이지 않게 한다 — 다른 링크(token)로 바뀔 땐 쓰지 않는다.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === token ? prev : undefined),
  })
  const qc = useQueryClient()
  const status = statusOf(q.error)
  // 404 는 TanStack 이 이전 data 를 남겨 둔 채 오류가 되므로(refetch 실패) data 유무가 아니라 오류 상태로 판정한다 —
  // 해제된 링크의 옛 본문·제목이 남아 보이면 안 된다.
  const is404 = status === 404
  const childMissing = is404 && pageId != null
  // 하위 페이지만 404 면 링크 전체가 아직 열리는지 루트를 다시 묻는다(캐시된 옛 응답을 믿지 않는다). 루트 요청 키는 pageId=null 과 같다.
  const rootQ = useQuery({
    queryKey: wikiKeys.publicShare(token, null),
    queryFn: () => fetchPublicWikiShare(token),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: childMissing,
  })
  const rootStatus = statusOf(rootQ.error)
  const revalidating = childMissing && rootQ.isFetching
  // 링크 전체가 닫힘 — 루트 주소가 404 이거나, 하위 404 뒤 확인한 루트도 404.
  const linkGone = (pageId == null && is404) || (childMissing && !revalidating && rootStatus === 404)
  // 링크는 열리는데 이 페이지만 닫힘 — 확인된 루트 응답으로만 트리를 그린다.
  const pageGone = childMissing && !revalidating && !linkGone && rootQ.data != null && !rootQ.isError
  // 훅 순서를 지키려고 401 early return 보다 앞에 둔다.
  useDocumentTitle(is404 ? undefined : q.data?.page.title)
  const loginRequired = status === 401
  const returnTo = location.pathname
  useEffect(() => {
    // 로그인해야 열리는 내부 링크 — 로그인 뒤 이 주소로 돌아오게 남긴다(ProtectedRoute 와 같은 대기 목적지, AppLayout 이 1회 소비).
    if (loginRequired) savePendingPushTarget({ tenantId: null, url: returnTo })
  }, [loginRequired, returnTo])
  useEffect(() => {
    // 닫힌 링크의 다른 캐시(보고 있지 않은 페이지)는 버린다 — 지금 화면의 두 질의는 아래에서 그리지 않는 것으로 가린다.
    if (linkGone) qc.removeQueries({ queryKey: wikiKeys.publicShareLink(token), predicate: (x) => x.getObserversCount() === 0 })
  }, [linkGone, qc, token])
  if (loginRequired) return <Navigate to="/login" replace />
  const data = is404 ? undefined : q.data
  // 트리·머리에 쓰는 묶음 — 정상이면 이번 응답, 하위만 닫혔으면 다시 확인한 루트 응답. 닫힘·확인 중엔 옛 제목이 보이지 않게 비운다.
  const shell: WikiPublicShare | undefined = linkGone || revalidating ? undefined : pageGone ? rootQ.data : data
  const activeId = pageGone ? pageId : (data?.page.id ?? pageId ?? shell?.rootPageId)
  const showTree = shell != null && shell.pages.length > 1
  return (
    <div className="flex h-dvh flex-col bg-background" data-testid="wiki-public-share-page">
      {/* 앱 셸 밖 공개 화면이라 Page.Header(AI 칩·알림 종 등 셸 의존) 대신 얇은 머리띠 — 드라이브 공개 링크 화면처럼. */}
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <BrandMark />
        <span className="text-sm font-semibold">Gen:iA Works</span>
        {shell && <span className="truncate text-sm text-muted-foreground">· {shell.workspaceName}</span>}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5" aria-hidden="true" />
          링크로 공유된 문서 · 읽기 전용
        </span>
      </header>
      {showTree && (
        // 휴대폰엔 왼쪽 트리 자리가 없어 선택 상자로 페이지를 옮긴다(md 이상은 트리).
        <WikiSharePageSelect
          className="md:hidden"
          pages={shell.pages}
          activeId={activeId}
          onSelect={(id) => navigate(`/wiki/share/${token}/pages/${id}`)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {showTree && (
          <WikiShareTreeNav
            className="hidden w-56 shrink-0 border-r bg-sidebar/40 md:block"
            testId="wiki-public-share-tree"
            pages={shell.pages}
            activeId={activeId}
            onOpen={(id) => navigate(`/wiki/share/${token}/pages/${id}`)}
          />
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* 404(없음·만료·해제·외부 공유 꺼짐)와 일시적 오류(5xx·네트워크)를 나눈다 — 뒤쪽은 링크 문제가 아니라 다시 시도하면 열린다. */}
          {linkGone ? (
            <ResourceErrorState
              icon={Link2}
              title="링크가 열리지 않습니다"
              description="공유가 해제됐거나 만료됐을 수 있습니다. 공유한 사람에게 새 링크를 요청하세요."
              actionLabel="Gen:iA Works 로"
              onAction={() => navigate('/login')}
            />
          ) : revalidating ? (
            <WikiPageSkeleton testId="wiki-public-share-skeleton" />
          ) : pageGone ? (
            // 링크는 열리는데 이 페이지만 더는 공유되지 않음(하위 밖으로 옮겨짐·삭제) — 트리는 그대로 쓰게 본문 자리에만 안내한다.
            <ResourceErrorState
              icon={Link2}
              title="이 페이지는 더 이상 공유되지 않습니다"
              description="공유 범위가 바뀌었을 수 있습니다. 목록에서 다른 페이지를 열어 보세요."
              actionLabel="처음 페이지로"
              onAction={() => navigate(`/wiki/share/${token}`)}
            />
          ) : (childMissing && rootQ.isError) || (q.isError && !is404 && !q.data) ? (
            <WikiShareLoadError
              testId="wiki-public-share-load-error"
              onRetry={() => void (childMissing ? rootQ.refetch() : q.refetch())}
            />
          ) : !data ? (
            <WikiPageSkeleton testId="wiki-public-share-skeleton" />
          ) : (
            <article className="mx-auto max-w-3xl px-4 py-8 md:px-8">
              <h1 className={cn('mb-4 break-keep', pageTitleClass)}>{data.page.title || '제목 없음'}</h1>
              <PublicBody markdown={data.page.markdown} />
            </article>
          )}
        </main>
      </div>
    </div>
  )
}

/** 읽기 전용 본문 — 문서 스키마만(동기화·슬래시·AI 없음). 이미지·멘션 NodeView 는 로그인 API 를 부르므로 기본 노드로 둔다. */
function PublicBody({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions: wikiSchemaExtensions(), editable: false }, [])
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(markdownToDoc(markdown).toJSON(), false)
  }, [editor, markdown])
  return <EditorContent editor={editor} className="wiki-editor" />
}
