// WP-1540: 드라이브 안 보기 전용 공유 폴더 화면(/drive/shared/:shareLinkId).
// 「공유받은 항목」의 폴더 행을 열면 이 화면이 뜬다 — 목록 캐시에서 행(과 링크 토큰)을 찾고, 공유 정보를 한 번 물어
// (그 요청이 서버에 방문을 기록한다) 공개 폴더 API(WP-1538)로 하위 폴더·파일을 읽기 전용으로 오간다.
// 목록 행은 권한을 주지 않는다 — 열람은 늘 링크 토큰으로 공개 경로를 거쳐 링크 규칙(폐기·만료·비밀번호)을 서버가 다시 판정한다.
// 올리기·새 폴더·이름 변경·삭제·이동은 이 화면에 없다(DrivePage 를 쓰지 않는다).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderSearch } from 'lucide-react'
import { type ReactNode, useCallback } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { fetchShareInfo, isShareFolderInfo, type ShareFolderInfo } from '@/api/drivePublicShare'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { Page } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { driveKeys } from '@/hooks/queries/driveKeys'
import { useSharedWithMe } from '@/hooks/queries/useSharedWithMe'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useIsMobile } from '@/hooks/useIsMobile'
import { resolveSharedTarget, SHARED_CLOSED_MESSAGE } from '@/lib/driveSharedWithMe'
import { failedWithoutData } from '@/lib/queryFailure'
import type { SharedWithMeItem } from '@/types/drive'

import { SharedLoading } from './DriveSharedWithMeView'
import { ShareFolderListArea } from './share/ShareFolderListArea'
import { infoErrorMessage, statusOf } from './share/shareSupport'
import { useShareFolderBrowser } from './share/useShareFolderBrowser'

/** 「공유받은 항목으로」 링크 — 막다른 화면이 되지 않게 모든 안내 상태에 둔다. */
function BackToSharedLink() {
  return (
    <Link to="/drive/shared" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      공유받은 항목으로
    </Link>
  )
}

/** 안내 상태 한 칸 — 제목·설명(선택)·행동. 화면 본문 자리 전체를 차지하는 단순 안내. */
function NoticeState({ testId, title, description, action }: { testId: string; title: string; description?: string; action: ReactNode }) {
  return (
    <Page data-testid={testId}>
      <Page.Header title="공유받은 항목" />
      <Page.Body>
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <FolderSearch className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
          <div className="mt-2">{action}</div>
        </div>
      </Page.Body>
    </Page>
  )
}

/**
 * 드라이브 안 공유 폴더 화면. 진입 판정(1~6)은 여기서 하고, 정보를 묻는 7번부터는 SharedFolderGate 로 넘긴다
 * (조건부 훅을 피하려고 판정 뒤에 쿼리를 두는 구조).
 */
export function DriveSharedFolderView() {
  const { shareLinkId } = useParams()
  const list = useSharedWithMe()

  // 1·2. 목록 불러오는 중 / 실패(캐시된 목록이 없을 때만).
  if (list.isPending) return <SharedLoading />
  if (failedWithoutData(list)) {
    return <LoadErrorState title="공유받은 항목을 불러오지 못했습니다" queries={[list]} testId="drive-shared-error" />
  }

  // 3. 목록에 없는 id — 뺐거나 이제 그 공간 구성원이라 드라이브에서 바로 보인다.
  const item = (list.data ?? []).find((i) => String(i.shareLinkId) === shareLinkId)
  if (!item) {
    return (
      <NoticeState
        testId="drive-shared-folder-missing"
        title="이 항목을 찾을 수 없습니다"
        description="목록에서 뺐거나, 지금은 그 공간 구성원이라 드라이브에서 바로 볼 수 있습니다."
        action={<BackToSharedLink />}
      />
    )
  }
  // 4. 파일 행 — 이 화면은 폴더 전용, 목록으로 돌려보낸다(열 수 없는 파일 행도).
  if (item.kind !== 'FOLDER') return <Navigate to="/drive/shared" replace />
  // 5·6. 목록의 「열기」와 같은 판정 — 열 수 없으면 정보를 묻지 않고, 비밀번호 링크는 공유 화면으로 넘긴다.
  const target = resolveSharedTarget(item)
  if (target.kind === 'closed') {
    return <NoticeState testId="drive-shared-folder-closed" title={target.reason} action={<BackToSharedLink />} />
  }
  if (target.kind === 'password') return <Navigate to={`/s/${target.token}`} replace />

  return <SharedFolderGate item={item} token={target.token} />
}

/**
 * 7. 공유 정보를 한 번 묻고(서버가 방문을 기록) 결과에 따라 잠금·종류·막힘·오류·본문으로 가른다.
 * 만료된 액세스 토큰의 갱신·재시도(401·loginRequired)는 공개 fetch(fetchShareInfo)가 맡는다.
 * 정보를 받으면 목록을 한 번 무효화해 마지막으로 연 날을 갱신한다 — 방문은 성공한 정보 조회만 기록하므로 실패에는 하지 않는다.
 * queryFn 안에서 하므로 목록 재요청으로 다시 그려져도 정보를 다시 묻거나 다시 무효화하지 않는다.
 */
function SharedFolderGate({ item, token }: { item: SharedWithMeItem; token: string }) {
  const queryClient = useQueryClient()
  const info = useQuery({
    queryKey: ['drive-shared-folder-info', String(item.shareLinkId), token],
    queryFn: async () => {
      const result = await fetchShareInfo(token, null)
      void queryClient.invalidateQueries({ queryKey: driveKeys.sharedWithMe() })
      return result
    },
    staleTime: Infinity,
    retry: false,
    gcTime: 0,
  })

  if (info.isPending) return <SharedLoading />
  if (info.isError) {
    const status = statusOf(info.error)
    // 막힘(폐기·만료·없음)과 다른 워크스페이스(403)는 안내 + 「공유받은 항목으로」, 그 밖은 다시 시도.
    const closed = status === 410 || status === 404
    if (closed || status === 403) {
      return (
        <NoticeState
          testId={closed ? 'drive-shared-folder-closed' : 'drive-shared-folder-error'}
          title={closed ? SHARED_CLOSED_MESSAGE : infoErrorMessage(403)}
          action={<BackToSharedLink />}
        />
      )
    }
    return (
      <NoticeState
        testId="drive-shared-folder-error"
        title="열지 못했습니다. 잠시 후 다시 시도하세요."
        action={
          <button type="button" onClick={() => void info.refetch()} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            다시 시도
          </button>
        }
      />
    )
  }
  const data = info.data
  // 응답이 잠금(비밀번호·로그인 확인 필요)이면 공유 화면으로, 폴더가 아니면 목록으로.
  if (data.passwordRequired || data.loginRequired) return <Navigate to={`/s/${token}`} replace />
  if (!isShareFolderInfo(data)) return <Navigate to="/drive/shared" replace />

  return <SharedFolderBody token={token} info={data} />
}

/** 보기 전용 배지 — 헤더 경로 뒤(데스크톱)와 본문 첫 줄(모바일)이 같은 모양을 쓴다. */
function ReadonlyBadge() {
  return (
    <span data-testid="drive-shared-readonly-badge" className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
      보기 전용
    </span>
  )
}

/** 본문 — 경로·보기 전용 배지·목록·뷰어. 열람 상태는 공유 화면(/s/:token)과 같은 훅을 쓴다. */
function SharedFolderBody({ token, info }: { token: string; info: ShareFolderInfo }) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()

  // 401(만료 토큰 갱신 뒤에도, 또는 뷰어 출처) — 안내 토스트 후 공유 화면에서 확인하게 한다. 훅의 items 메모가 이 참조에 기대므로 고정한다.
  const onUnauthorized = useCallback(() => {
    toast.error('다시 열어 주세요 — 공유 화면에서 확인이 필요합니다.')
    // replace — 뒤로 가기가 이 화면을 다시 열어 곧바로 또 공유 화면으로 튕기는 고리를 만들지 않게 한다.
    navigate(`/s/${token}`, { replace: true })
  }, [navigate, token])

  const { folder, goTo, listing, items, viewerIndex, setViewerIndex, downloadingId, downloadError, download } = useShareFolderBrowser({
    token,
    viewToken: null,
    onUnauthorized,
  })
  const currentName = listing.data?.path.at(-1)?.name ?? info.name
  useDocumentTitle([currentName, '공유받은 항목', '드라이브'])

  // 경로 — 공유 폴더에서 시작한다(그 위로는 갈 수 없다). 목록을 받기 전에는 공유 폴더 이름 하나.
  const path = listing.data?.path ?? [{ id: -1, name: info.name }]
  const crumbs: BreadcrumbItem[] = [
    { key: 'shared', label: '공유받은 항목', to: '/drive/shared', testId: 'drive-shared-crumb-root' },
    ...path.map((p, i) => ({
      key: `f-${p.id}`,
      label: p.name,
      title: p.name,
      onSelect: () => goTo(i === 0 ? null : p.id),
      testId: `drive-shared-crumb-${p.id}`,
    })),
  ]
  const crumbProps = { items: crumbs, 'aria-label': '폴더 경로', 'data-testid': 'drive-shared-breadcrumb' } as const

  // 공유 폴더 자체가 없어졌을 때(휴지통 등) 목록으로 돌아가는 단추 — 목록이 그 행을 아직 「열 수 있음」으로 들고 있으므로
  // 무효화해 다시 받게 한 뒤 이동한다(이 화면이 목록 쿼리를 구독 중이라 곧바로 다시 받는다).
  const backToSharedList = () => {
    void queryClient.invalidateQueries({ queryKey: driveKeys.sharedWithMe() })
    navigate('/drive/shared')
  }

  return (
    <Page data-testid="drive-shared-folder-view">
      {/* 데스크톱 헤더 — 경로가 좌측 그룹을 먼저 받는다. 「보기 전용」 배지는 경로 뒤 표식(trailing)이라 접기 판정이 그 폭까지 센다(노트의 AI 배지와 같은 자리).
          「공유한 사람」은 헤더 meta 에 두면 경로(flex-1, 남는 폭만 받음)보다 먼저 폭을 가져가 짧은 경로도 「… › 현재」로 접히므로 본문 첫 줄로 내린다. */}
      <Page.Header
        srTitle={`공유받은 항목 — ${currentName}`}
        title={isMobile ? currentName : undefined}
        leadingGrow
        leading={<Breadcrumb {...crumbProps} trailing={<ReadonlyBadge />} />}
      />
      <Page.Body>
        <div className="space-y-4">
          {/* 모바일 — 헤더의 leading 은 그리지 않으므로 본문 첫 줄에 경로와 배지를 둔다(배지는 줄 오른쪽 끝). */}
          {isMobile ? (
            <div className="flex min-w-0 items-center gap-2">
              <Breadcrumb {...crumbProps} />
              <ReadonlyBadge />
            </div>
          ) : (
            info.sharedBy && (
              <p data-testid="drive-shared-shared-by" className="truncate text-xs text-muted-foreground">
                공유한 사람 {info.sharedBy}
              </p>
            )
          )}
          <ShareFolderListArea
            listing={listing}
            downloadingId={downloadingId}
            onOpenFolder={goTo}
            // 공유 폴더 자체가 없어졌으면(예: 둘러보는 사이 휴지통으로) 「공유 폴더로」는 같은 실패를 다시 부를 뿐이라 목록으로 돌려보낸다.
            notFoundAction={folder == null ? { label: '공유받은 항목으로', onSelect: backToSharedList } : undefined}
            onPreview={(i) => setViewerIndex(i)}
            onDownload={(f) => void download(f)}
          />
          {downloadError && (
            <p className="text-sm text-destructive" role="alert" data-testid="share-download-error">
              {downloadError}
            </p>
          )}
        </div>
      </Page.Body>
      {viewerIndex != null && items.length > 0 && (
        <AttachmentViewer
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          shareable={false}
        />
      )}
    </Page>
  )
}
