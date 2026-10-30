// 드라이브 공유 링크 화면(/s/:token) — 인증 없이 들어오는 공개 라우트. AppLayout 을 쓰지 않는다(WP-1227).
//
// 흐름:
//   - 먼저 GET 정보로 화면을 고른다 — 바로 파일 카드 / 비밀번호 잠금 / 사내 전용(로그인) 잠금 / 다른 워크스페이스 / 만료·없음.
//   - 비밀번호 잠금은 POST /unlock 으로 열람 토큰을 받아 이 컴포넌트 메모리에만 둔다(비밀번호는 바로 버림).
//     URL·저장소에 남기지 않아 새로고침하면 다시 묻는다. 열람 토큰이 만료돼 401 이 오면 잠금 카드로 돌아간다.
//   - 파일 카드: [미리보기](통합 뷰어 — 공개 경로 + 열람 토큰 출처) [다운로드], 아래에 「드라이브에서 열기」 계열 링크.
//   - 로그인한 사람이 새 탭으로 열면 액세스 토큰이 아직 없다 — AuthProvider 의 세션 복원(refresh 쿠키)이 끝난 뒤 정보를 묻는다.

import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { type ReactNode, type SyntheticEvent, useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import {
  downloadShare,
  fetchShareBlob,
  fetchShareConverted,
  fetchShareInfo,
  type ShareFileInfo,
  sharePublicBase,
  SharePublicError,
  unlockShare,
} from '@/api/drivePublicShare'
import { FileTypeIcon } from '@/components/drive/FileTypeIcon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import { driveFilePath } from '@/components/viewer/driveOpen'
import type { ViewerItem, ViewerItemSource } from '@/components/viewer/types'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatFileSize } from '@/lib/formatters'
import { savePendingPushTarget } from '@/lib/push/openTarget'

/** 잠김(시도 초과·IP 제한) 안내 — 비밀번호 칸 아래와 다운로드 실패에 같이 쓴다. 서버는 429(이전 계약 423 도 같이 본다). */
const LOCKED_MESSAGE = '시도 횟수를 넘었습니다. 잠시 뒤 다시 시도하세요'

/** 응답 상태 — SharePublicError 가 아니면(네트워크 등) 0. */
function statusOf(e: unknown): number {
  return e instanceof SharePublicError ? e.status : 0
}

function isLocked(status: number): boolean {
  return status === 429 || status === 423
}

/** 정보 조회 실패 → 원인 안내(막다른 화면이 되지 않게 다음 행동은 errorAction). */
function infoErrorMessage(status: number): string {
  if (status === 410) return '만료되었거나 폐기된 링크입니다.'
  if (status === 404) return '존재하지 않는 링크입니다.'
  if (status === 403) return '이 워크스페이스 사람만 볼 수 있는 파일입니다. 다른 워크스페이스 계정이 있다면 전환한 뒤 다시 여세요.'
  return '링크를 열지 못했습니다. 잠시 후 다시 시도하세요.'
}

/** 다운로드 실패 안내 — 401 은 잠금 카드로 돌아가므로 여기 오지 않는다. */
function downloadErrorMessage(status: number): string {
  if (isLocked(status)) return LOCKED_MESSAGE
  if (status === 410 || status === 404) return infoErrorMessage(status)
  return '다운로드에 실패했습니다. 잠시 후 다시 시도하세요.'
}

/** 카드 둘째 줄 형식 — 확장자가 있으면 「PDF 파일」, 없으면 mime 그대로. */
function fileTypeLabel(name: string, mimeType: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : ''
  return ext ? `${ext.toUpperCase()} 파일` : mimeType
}

/** 로그인 뒤 이 링크로 돌아오게 대기 목적지를 남긴다 — from=login 표시로 「공간 접근 권한 없음」 안내를 고른다. 드라이브로 자동 이동은 하지 않는다. */
function rememberReturn(token: string) {
  savePendingPushTarget({ tenantId: null, url: `/s/${token}?from=login` })
}

/**
 * 공유 화면 뷰어 출처 — 원본·변환 PDF·다운로드를 공개 경로 + 열람 토큰으로 받는다.
 * 401(열람 토큰 만료·로그인 풀림)이면 onUnauthorized 로 잠금 카드에 돌려보낸 뒤 실패를 그대로 넘긴다(뷰어는 오류 화면).
 */
function shareViewerSource(token: string, viewToken: string | null, onUnauthorized: () => void): ViewerItemSource {
  const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (e) {
      if (statusOf(e) === 401) onUnauthorized()
      throw e
    }
  }
  return {
    fetchBlob: (path, opts) => guard(() => fetchShareBlob(path, viewToken, opts)),
    fetchConverted: (path, signal) => guard(() => fetchShareConverted(path, viewToken, signal)),
    download: (item) => guard(() => downloadShare(token, viewToken, item.name)),
  }
}

export default function ShareLinkPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const fromLogin = searchParams.get('from') === 'login'
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  // 열람 토큰 — 이 탭·이 컴포넌트 메모리에만 둔다(URL·저장소 금지).
  const [viewToken, setViewToken] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // 세션 복원(refresh 쿠키)이 끝난 뒤에 묻는다 — 새 탭의 로그인 사용자도 Bearer 를 실어 사내 판정·드라이브에서 열기가 맞게 나온다.
  // 로그인 상태·열람 토큰이 바뀌면 다시 묻는다. 열람 토큰이 든 응답은 오래 들고 있지 않게 바로 버린다(gcTime 0).
  const info = useQuery({
    queryKey: ['drive-public-share', token, viewToken, isAuthenticated],
    queryFn: () => fetchShareInfo(token, viewToken),
    enabled: !authLoading && token !== '',
    retry: false,
    staleTime: 0,
    gcTime: 0,
    // 탭 포커스마다 다시 묻지 않는다 — 비밀번호 입력 중 카드가 바뀌거나 요청이 쌓이지 않게.
    refetchOnWindowFocus: false,
  })
  const refetchInfo = info.refetch

  // 열람 토큰 만료(401) — 메모리의 열람 토큰을 먼저 버리고 뷰어를 닫는다. 토큰이 있었으면 정보 키가 바뀌어 잠금 카드로 다시 묻고,
  // 없었으면(사내 링크 세션 만료 등) 같은 키로 다시 물어 서버가 고른 잠금 화면을 보인다. 실패한 요청을 다시 보내지는 않는다.
  const onUnauthorized = useCallback(() => {
    setViewerOpen(false)
    setViewToken(null)
    if (!viewToken) void refetchInfo()
  }, [viewToken, refetchInfo])

  // 잠금 풀기가 401 일 때 — 사내 링크에서 세션이 풀려도 401 이라 정보부터 다시 묻는다. 로그인 잠금이면 true(화면은 정보 응답으로 바뀐다).
  const recheckLogin = useCallback(async () => {
    const res = await refetchInfo()
    return res.data?.loginRequired === true
  }, [refetchInfo])

  // 뷰어 출처 — 공개 경로를 열람 토큰 헤더로 받는다. 열람 토큰은 뷰어가 닫힌 동안에만 바뀐다(잠금 풀기·만료) — 다시 열면 새 출처를 쓴다.
  const source = useMemo(() => shareViewerSource(token, viewToken, onUnauthorized), [token, viewToken, onUnauthorized])

  const file: ShareFileInfo | null = info.data && 'name' in info.data ? info.data : null
  useDocumentTitle([file?.name])

  // 뷰어 항목 — 요약·참조된 곳·가져오기·드라이브에서 열기 같은 부가 필드는 두지 않는다(공개 화면).
  const items = useMemo<ViewerItem[]>(() => {
    if (!file) return []
    const base = sharePublicBase(token)
    return [
      {
        key: `share:${token}`,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentPath: `${base}/content`,
        downloadPath: `${base}/download`,
        previewPath: `${base}/preview`,
        source,
      },
    ]
  }, [file, token, source])

  async function handleDownload() {
    if (!file || downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadShare(token, viewToken, file.name)
    } catch (e) {
      const status = statusOf(e)
      if (status === 401) onUnauthorized()
      else setDownloadError(downloadErrorMessage(status))
    } finally {
      setDownloading(false)
    }
  }

  let body: ReactNode
  if (!token) {
    // 토큰 없는 주소 — 정보 조회가 꺼져 로딩에 머물지 않게 없는 링크로 안내한다.
    body = <ShareErrorCard status={404} />
  } else if (authLoading || info.isPending) {
    body = (
      <ShareCard>
        <p className="text-center text-sm text-muted-foreground" role="status" data-testid="share-loading">
          불러오는 중…
        </p>
      </ShareCard>
    )
  } else if (info.isError) {
    body = <ShareErrorCard status={statusOf(info.error)} onRetry={() => void refetchInfo()} />
  } else if (info.data.loginRequired) {
    body = (
      <ShareCard>
        <LockHeader title="사내 전용 파일" description="로그인한 같은 워크스페이스 사람만 볼 수 있습니다." />
        <Button asChild className="w-full">
          <Link to="/login" onClick={() => rememberReturn(token)} data-testid="share-login-btn">
            로그인
          </Link>
        </Button>
      </ShareCard>
    )
  } else if (info.data.passwordRequired) {
    body = (
      <ShareCard>
        <PasswordLock token={token} onUnlocked={setViewToken} recheckLogin={recheckLogin} />
      </ShareCard>
    )
  } else if (file) {
    body = (
      <>
        <ShareCard>
          <div className="flex items-start gap-3" data-testid="share-file-card">
            <FileTypeIcon mimeType={file.mimeType} className="size-10 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <h1 className="break-all text-base font-semibold" data-testid="share-file-name">
                {file.name}
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="share-file-meta">
                {fileTypeLabel(file.name, file.mimeType)} · {formatFileSize(file.sizeBytes)}
              </p>
              {file.sharedBy && (
                <p className="text-sm text-muted-foreground" data-testid="share-file-shared-by">
                  공유한 사람 {file.sharedBy}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setViewerOpen(true)} data-testid="share-preview-btn">
              미리보기
            </Button>
            <Button onClick={() => void handleDownload()} disabled={downloading} data-testid="share-download-btn">
              {downloading ? '다운로드 중...' : '다운로드'}
            </Button>
          </div>
          {downloadError && (
            <p className="text-sm text-destructive" role="alert" data-testid="share-download-error">
              {downloadError}
            </p>
          )}
        </ShareCard>
        <DriveOpenLine token={token} file={file} isAuthenticated={isAuthenticated} fromLogin={fromLogin} />
      </>
    )
  }

  return (
    // 전체 화면 중앙 정렬 — AppLayout 없이 최소 UI. 좁은 폰(360px)에서도 카드가 좌우 16px 여백 안에 들어간다.
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-8">
      {/* 브랜드/홈 링크 — AppLayout 밖 독립 페이지라 대체 내비게이션 수단이 없어 둔다(#677). */}
      <Link to="/" className="mb-6 text-sm font-medium text-muted-foreground hover:text-foreground">
        Gen:iA Works
      </Link>
      {body}
      {viewerOpen && items.length > 0 && (
        <AttachmentViewer items={items} index={0} onIndexChange={() => {}} onClose={() => setViewerOpen(false)} shareable={false} />
      )}
    </div>
  )
}

/** 정보 조회 실패 카드 — 원인 + 다음 행동(만료·없음은 새 링크 요청, 일시 실패는 [다시 시도]). 다른 워크스페이스(403)는 안내만. */
function ShareErrorCard({ status, onRetry }: { status: number; onRetry?: () => void }) {
  const gone = status === 410 || status === 404
  return (
    <ShareCard>
      <div className="space-y-2 text-center">
        <p className="text-sm text-destructive" role="alert" data-testid="share-error-msg">
          {infoErrorMessage(status)}
        </p>
        {gone && (
          <p className="text-sm text-muted-foreground" data-testid="share-error-action">
            링크를 공유한 사람에게 새 링크를 요청하세요.
          </p>
        )}
        {status !== 403 && !gone && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        )}
      </div>
    </ShareCard>
  )
}

/** 공용 카드 틀 — 모든 상태가 같은 폭·여백을 쓴다. */
function ShareCard({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">{children}</div>
}

/** 잠금 카드 머리 — 자물쇠 아이콘 + 제목 + 설명. */
function LockHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2 text-center">
      <Lock className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * 비밀번호 잠금 카드 — [확인]이 POST /unlock 으로 열람 토큰을 받아 부모에 넘기고 입력값은 지운다.
 * 틀림(401)·잠김(429)은 칸 아래 인라인으로 알린다. 401 은 사내 링크의 세션 만료일 수도 있어 recheckLogin 으로 정보를 다시 묻고,
 * 로그인 잠금이면(부모가 사내 잠금 카드로 바꾼다) 틀림 안내를 띄우지 않는다.
 */
function PasswordLock({
  token,
  onUnlocked,
  recheckLogin,
}: {
  token: string
  onUnlocked: (viewToken: string) => void
  recheckLogin: () => Promise<boolean>
}) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: SyntheticEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { viewToken } = await unlockShare(token, password)
      // 비밀번호는 더 들고 있지 않는다 — 열람 토큰만 남긴다.
      setPassword('')
      onUnlocked(viewToken)
    } catch (err) {
      const status = statusOf(err)
      if (status === 401 && (await recheckLogin().catch(() => false))) return
      setError(
        isLocked(status)
          ? LOCKED_MESSAGE
          : status === 401
            ? '비밀번호가 맞지 않습니다.'
            : status === 410 || status === 404
              ? infoErrorMessage(status)
              : '확인하지 못했습니다. 잠시 후 다시 시도하세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <LockHeader title="비밀번호로 보호된 파일" description="공유한 사람에게 받은 비밀번호를 넣으세요." />
      <div className="space-y-2">
        <Label htmlFor="share-password" className="sr-only">
          공유 링크 비밀번호
        </Label>
        <PasswordInput
          id="share-password"
          fieldLabel="비밀번호"
          autoComplete="off"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'share-password-error' : undefined}
          data-testid="share-password-input"
        />
        {error && (
          <p id="share-password-error" className="text-sm text-destructive" role="alert" data-testid="share-unlock-error">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={!password || submitting} data-testid="share-unlock-btn">
        확인
      </Button>
    </form>
  )
}

/**
 * 카드 아래 작은 링크 — 공간 권한이 있으면 같은 창에서 드라이브로, 비로그인이면 로그인 뒤 이 링크로 돌아오게.
 * 로그인했는데 권한이 없으면 링크를 두지 않고, 로그인하고 막 돌아온 경우(from=login)만 이유를 알린다.
 */
function DriveOpenLine({
  token,
  file,
  isAuthenticated,
  fromLogin,
}: {
  token: string
  file: ShareFileInfo
  isAuthenticated: boolean
  fromLogin: boolean
}) {
  const linkClass = 'mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline'
  if (file.driveOpen) {
    const { spaceId, folderId, driveFileId } = file.driveOpen
    return (
      <Link to={driveFilePath(spaceId, folderId, driveFileId)} className={linkClass} data-testid="share-drive-open-link">
        드라이브에서 열기 →
      </Link>
    )
  }
  if (file.loginAvailable) {
    return (
      <Link to="/login" onClick={() => rememberReturn(token)} className={linkClass} data-testid="share-login-open-link">
        로그인하고 드라이브에서 열기 →
      </Link>
    )
  }
  if (isAuthenticated && fromLogin) {
    return (
      <p className="mt-4 text-sm text-muted-foreground" data-testid="share-no-access-msg">
        이 파일이 있는 공간에 접근 권한이 없습니다
      </p>
    )
  }
  return null
}
