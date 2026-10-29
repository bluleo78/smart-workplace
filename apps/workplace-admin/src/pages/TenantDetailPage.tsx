import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { ArrowLeft, Loader2, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { platformTenants } from '../api/platformTenants'
import { AddTenantMemberDialog } from '../components/AddTenantMemberDialog'
import { EditTenantDialog } from '../components/EditTenantDialog'
import { PurgeTenantDialog } from '../components/PurgeTenantDialog'
import { TenantDangerZone } from '../components/TenantDangerZone'
import { TenantStatusBadge } from '../components/TenantStatusBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { PendingLabel } from '../components/ui/pending-label'
import { Separator } from '../components/ui/separator'
import { Skeleton } from '../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { TableEmptyRow } from '../components/ui/table-empty'
import { TableSkeletonRows } from '../components/ui/table-skeleton'
import { serverMessage } from '../lib/errors'
import { eulReul, formatDate } from '../lib/utils'
import type { TenantMember } from '../types/platform'

// 역할 레이블 — API 원시값을 한국어로 변환.
const ROLE_LABEL: Record<TenantMember['role'], string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  MEMBER: '멤버',
}

// 멤버 상태 레이블 — API 원시값을 한국어로 변환.
function memberStatusLabel(status: TenantMember['status']): string {
  return status === 'ACTIVE' ? '활성' : '정지됨'
}

// 멤버 role 배지 — OWNER 는 강조(default), 그 외는 secondary.
function RoleBadge({ role }: { role: TenantMember['role'] }) {
  if (role === 'OWNER') {
    return <Badge variant="default">{ROLE_LABEL[role]}</Badge>
  }
  return <Badge variant="secondary">{ROLE_LABEL[role] ?? role}</Badge>
}

// 멤버 테이블 컬럼 수: 이름 / 사용자 ID / 이메일 / 역할 / 상태
const MEMBER_COLUMN_COUNT = 5

// axios 404 판별 — 테넌트 단건 조회 실패가 "없음" 인지 구분한다.
function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404
}

// 상태 변경 동작 — 확인 다이얼로그·mutation 이 공유한다. remove 는 복원 가능한 삭제(DELETED).
type StatusAction = 'suspend' | 'activate' | 'remove' | 'restore'

// 동작별 설정 — verb: 토스트·버튼 동사, call: API 호출, confirm: 확인 다이얼로그 문구(복원은 확인 없이 바로 실행).
// 삭제는 복원 가능함을 함께 안내한다.
const ACTIONS: Record<
  StatusAction,
  {
    verb: string
    call: (id: number) => Promise<void>
    confirm?: { title: (name: string) => string; description: (name: string) => string }
  }
> = {
  suspend: {
    verb: '정지',
    call: platformTenants.suspend,
    confirm: {
      title: () => '테넌트 정지',
      description: () => '이 테넌트를 정지하시겠습니까? 정지된 테넌트의 사용자는 접근할 수 없습니다.',
    },
  },
  activate: {
    verb: '활성화',
    call: platformTenants.activate,
    confirm: { title: () => '테넌트 활성화', description: () => '이 테넌트를 활성화하시겠습니까?' },
  },
  remove: {
    verb: '삭제',
    call: platformTenants.remove,
    // 삭제는 대상 이름을 제목·본문에 넣어 어떤 테넌트를 지우는지 다이얼로그만 보고 확인할 수 있게 한다(S6).
    confirm: {
      title: (name) => `${name}${eulReul(name)} 삭제하시겠습니까?`,
      description: () => '구성원의 로그인이 즉시 차단됩니다. 영구 삭제 전까지 복원할 수 있습니다.',
    },
  },
  restore: { verb: '복원', call: platformTenants.restore },
}

// 영구 삭제 진행 상태 폴링 주기 — 백그라운드 잡 진행을 보여주되 서버 부하는 작게.
const PURGE_POLL_MS = 5000

// 운영자 콘솔 테넌트 상세 화면.
// - 테넌트 정보 카드 + 상태 액션(정지/활성화) + 멤버 테이블.
// - 단건 조회 404 → "찾을 수 없습니다" 안내 후 early return(멤버 테이블/액션 미렌더).
// - WP-341: 삭제됨/영구 삭제 중 배너, 복원, 위험 구역(삭제·영구 삭제), 영구 삭제 진행 폴링.
export default function TenantDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // 확인 다이얼로그를 띄운 상태 변경 동작(정지/활성화/삭제). null 이면 닫힘.
  const [confirmAction, setConfirmAction] = useState<Exclude<StatusAction, 'restore'> | null>(null)
  // 영구 삭제 확인 다이얼로그 열림 상태.
  const [purgeOpen, setPurgeOpen] = useState(false)
  // 확인 다이얼로그를 연 트리거 버튼 — 닫힐 때 포커스를 되돌린다(S5). controlled AlertDialog 는 Trigger 가 없어
  // Radix 가 복귀 대상을 몰라 포커스가 body 로 사라진다. 성공으로 버튼이 사라졌으면(isConnected 아님) 기본 동작에 맡긴다.
  const triggerRef = useRef<HTMLElement | null>(null)
  // 상태 전이 뒤 포커스를 보낼 곳(S1·S2) — 성공한 동작이 정한다. 대상 버튼이 전이로 사라지거나(삭제→복원 버튼) 다이얼로그가 닫히며
  // 포커스를 잃는(복원·영구 삭제 시작) 경우, 재조회로 status 가 바뀐 뒤 아래 effect 가 옮긴다.
  const focusIntentRef = useRef<'restore' | 'title' | 'purging' | null>(null)
  const restoreButtonRef = useRef<HTMLButtonElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const purgingBannerRef = useRef<HTMLDivElement | null>(null)
  const restoreFocus = (e: Event) => {
    // 포커스 이동 예약이 있으면 Radix 의 트리거 복귀를 막는다 — 트리거가 아직 붙어 있어도 곧 사라질 버튼이라 status 전이 effect 에 맡긴다.
    if (focusIntentRef.current) {
      e.preventDefault()
      return
    }
    const el = triggerRef.current
    if (el?.isConnected) {
      e.preventDefault()
      el.focus()
    }
  }
  // 트리거를 기억하며 확인 다이얼로그를 연다.
  const openConfirm = (action: Exclude<StatusAction, 'restore'>, trigger: HTMLElement) => {
    triggerRef.current = trigger
    setConfirmAction(action)
  }
  // 영구 삭제 완료 처리(토스트·이동)를 한 번만 하기 위한 가드 — StrictMode·폴링 중복 방지.
  const purgeDoneRef = useRef(false)
  // 이 화면에서 영구 삭제를 요청했는지 — 잡이 요청 직후 끝나 PURGING 을 못 본 채 재조회가 404 가 되는 경우를 완료로 보기 위함.
  const purgeRequestedRef = useRef(false)
  // 멤버 추가 다이얼로그(#497) 열림 상태.
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  // 테넌트 정보 편집 다이얼로그 열림 상태(WP-336).
  const [editOpen, setEditOpen] = useState(false)
  // 드라이브 한도 입력값(GB 단위 문자열) — tenant 로드 후 초기화.
  const [gb, setGb] = useState('')

  // 테넌트 단건 조회. queryKey 는 useParams 의 string id 를 그대로 사용한다
  // — mutation invalidate 키와 byte-identical 해야 재조회가 발동한다.
  const {
    data: tenant,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => platformTenants.get(Number(id)),
    retry: false,
    // 영구 삭제 중이면 진행을 따라가도록 주기적으로 재조회한다. 완료되면 행이 사라져 404 가 된다.
    refetchInterval: (q) => (q.state.data?.status === 'PURGING' ? PURGE_POLL_MS : false),
  })

  // 영구 삭제 완료 감지 — PURGING 을 보던 중(이전 data 유지) 이거나 이 화면에서 영구 삭제를 요청한 뒤
  // 재조회가 404 가 되면 완료로 본다. 처음부터 404 인 경우는 data 가 없어 여기 해당하지 않고
  // 기존 "찾을 수 없음" 화면을 유지한다.
  // (ref 는 렌더 중에 읽지 않고 effect 안에서만 읽는다.)
  const goneAfterData = !!tenant && isError && isNotFound(error)
  const wasPurging = tenant?.status === 'PURGING'
  useEffect(() => {
    if (!goneAfterData || purgeDoneRef.current) return
    if (!wasPurging && !purgeRequestedRef.current) return
    purgeDoneRef.current = true
    queryClient.invalidateQueries({ queryKey: ['tenants'] })
    toast.success('영구 삭제가 완료되었습니다.')
    navigate('/?view=deleted', { replace: true })
  }, [goneAfterData, wasPurging, queryClient, navigate])

  // status 전이 감지 — (1) 예약된 포커스 이동 실행(S1·S2), (2) 영구 삭제 실패 복귀(PURGING→DELETED+purgeError) 토스트(S3).
  const status = tenant?.status
  const purgeError = tenant?.purgeError
  const prevStatusRef = useRef<typeof status>(undefined)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'PURGING' && status === 'DELETED' && purgeError) {
      toast.error('영구 삭제에 실패했습니다. 사유를 확인한 뒤 다시 시도하세요.')
    }
    if (prev === undefined || prev === status) return
    const intent = focusIntentRef.current
    if (!intent) return
    focusIntentRef.current = null
    // 닫히는 다이얼로그의 포커스 트랩이 풀린 뒤 옮기도록 한 틱 미룬다.
    const t = setTimeout(() => {
      const target =
        intent === 'restore' ? restoreButtonRef.current : intent === 'purging' ? purgingBannerRef.current : titleRef.current
      ;(target ?? titleRef.current)?.focus()
    }, 50)
    return () => clearTimeout(t)
  }, [status, purgeError])

  // 멤버 목록 — 테넌트가 정상 조회된 뒤에만 가져온다(404 아래에 테이블이 깔리지 않게).
  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
  } = useQuery({
    queryKey: ['tenant', id, 'members'],
    queryFn: () => platformTenants.members(Number(id)),
    enabled: !!tenant,
  })

  const GB = 1024 * 1024 * 1024

  // tenant 가 로드되면 GB 입력값을 초기화한다.
  useEffect(() => {
    if (tenant) setGb(String(tenant.quotaBytes / GB))
  }, [tenant, GB])

  // 드라이브 한도 변경 mutation(#81) — 성공 시 ['tenant', id] 무효화.
  const quotaMutation = useMutation({
    mutationFn: () => platformTenants.updateQuota(Number(id), Math.round(Number(gb) * GB)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] })
      toast.success('드라이브 한도를 저장했습니다.')
    },
    onError: (err) => toast.error(serverMessage(err) ?? '드라이브 한도 저장에 실패했습니다.'),
  })

  // 상태 변경 mutation(정지/활성화/삭제/복원) — 성공 시 상세·목록 캐시를 무효화해 재조회한다.
  // 동작은 mutate 인자로 받아, invalidate 후 tenant.status 가 바뀌어도 토스트 문구가 틀어지지 않게 한다.
  const statusMutation = useMutation({
    mutationFn: (action: StatusAction) => ACTIONS[action].call(Number(id)),
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] })
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast.success(`테넌트를 ${ACTIONS[action].verb}했습니다.`)
      // 삭제 → 되돌리기 행동인 [복원], 복원 → 이름 제목으로 포커스를 보낸다(S1·S2). 정지/활성화는 트리거가 남아 기본 복귀.
      focusIntentRef.current = action === 'remove' ? 'restore' : action === 'restore' ? 'title' : null
      setConfirmAction(null)
    },
    onError: (err, action) => {
      toast.error(serverMessage(err) ?? `테넌트 ${ACTIONS[action].verb}에 실패했습니다.`)
      setConfirmAction(null)
    },
  })

  // 영구 삭제 요청 mutation — 서버는 202 로 받고 백그라운드에서 처리한다(이후 PURGING 폴링).
  const purgeMutation = useMutation({
    mutationFn: (confirmName: string) => platformTenants.purge(Number(id), confirmName),
    onSuccess: () => {
      purgeRequestedRef.current = true
      focusIntentRef.current = 'purging'
      setPurgeOpen(false)
      queryClient.invalidateQueries({ queryKey: ['tenant', id] })
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast.success('영구 삭제를 시작했습니다.')
    },
    onError: (err) => toast.error(serverMessage(err) ?? '영구 삭제 요청에 실패했습니다.'),
  })

  // 404 → 전용 안내 + 목록 링크. early return.
  // 이전 data 가 남아 있으면(영구 삭제 폴링 중 재조회 실패) 화면을 유지한다 — 완료 처리는 위 effect 가 한다.
  if (isError && !tenant && isNotFound(error)) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border py-16 text-center">
        <p className="text-sm text-muted-foreground" data-testid="tenant-not-found">
          테넌트를 찾을 수 없습니다.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">목록으로</Link>
        </Button>
      </div>
    )
  }

  // 404 외 에러 → 일반 에러 안내.
  if (isError && !tenant) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border py-16 text-center">
        <p className="text-sm text-muted-foreground">테넌트 정보를 불러오지 못했습니다.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">목록으로</Link>
        </Button>
      </div>
    )
  }

  // 확인 다이얼로그 문구 — 확인 대상 동작이 없거나(restore) 닫혀 있으면 undefined.
  const confirmCopy = confirmAction ? ACTIONS[confirmAction].confirm : undefined
  const isActive = tenant?.status === 'ACTIVE'
  // 운영 중(편집·정지/활성화·삭제 가능) / 삭제됨(복원·영구 삭제 가능) / 영구 삭제 중(조회만).
  const isLive = tenant?.status === 'ACTIVE' || tenant?.status === 'SUSPENDED'
  const isDeleted = tenant?.status === 'DELETED'
  const isPurging = tenant?.status === 'PURGING'
  // 상태 변경(복원 등)·영구 삭제 요청 중 하나라도 진행 중이면 상충 동작(복원↔영구 삭제)을 서로 막는다(F1).
  const busy = statusMutation.isPending || purgeMutation.isPending

  return (
    <div className="space-y-6">
      {/* 뒤로가기 — 목록으로. */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="tenant-back"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        목록으로
      </Link>

      {/* 상태 안내 라이브 영역(S3) — 항상 마운트돼 있고 문구만 바뀐다. 내용이 채워진 채 삽입된 live region 은 스크린리더가
          읽지 않으므로, 배너가 바뀌어도 이 노드의 텍스트 변화로 전이를 알린다. 시각 배너는 role 없이 표시만 한다. */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="tenant-status-announcer">
        {isDeleted
          ? `삭제된 테넌트입니다. 복원할 수 있습니다.${tenant?.purgeError ? ` 지난 영구 삭제 실패: ${tenant.purgeError}` : ''}`
          : isPurging
            ? '영구 삭제를 진행하고 있습니다. 되돌릴 수 없습니다.'
            : ''}
      </div>

      {/* 삭제됨 배너 — 다음 행동인 [복원]을 배너 오른쪽에 둔다(N3). 지난 영구 삭제가 실패했으면 사유를 별도 줄로 보여준다(N9). */}
      {isDeleted && tenant && (
        <div
          data-testid="tenant-deleted-banner"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              {tenant.deletedAt ? `${formatDate(tenant.deletedAt)}에 ` : ''}삭제된 테넌트입니다. 구성원은 접근할 수 없고, 복원 전에는
              정보를 바꿀 수 없습니다.
              {tenant.purgeError && (
                <p className="mt-1" data-testid="purge-error-line">
                  지난 영구 삭제 실패: <code className="text-xs">{tenant.purgeError}</code>
                </p>
              )}
            </div>
            {/* disabled 대신 aria-disabled — 요청 중에도 포커스를 유지한다(S2). 글자는 배너 빨강을 상속하지 않고 중립(S4). */}
            <Button
              ref={restoreButtonRef}
              variant="outline"
              size="sm"
              className="shrink-0 text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
              data-testid="restore-button"
              aria-disabled={busy}
              onClick={() => {
                if (busy) return
                statusMutation.mutate('restore')
              }}
            >
              <PendingLabel
                pending={statusMutation.isPending && statusMutation.variables === 'restore'}
                label="복원"
                pendingLabel="복원 중…"
              />
            </Button>
          </div>
        </div>
      )}

      {/* 영구 삭제 중 배너 — 복원은 불가라 버튼 없이 안내만. 스피너로 진행 중임을 색 외 신호로도 전한다(N6). 재시도 오류는 별도 줄(N9).
          영구 삭제 시작 직후 포커스를 받을 수 있게 tabIndex=-1(S2). */}
      {isPurging && tenant && (
        <div
          ref={purgingBannerRef}
          tabIndex={-1}
          data-testid="tenant-purging-banner"
          className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm text-info-text outline-none"
        >
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            <span>영구 삭제를 진행하고 있습니다. 시작된 영구 삭제는 되돌릴 수 없으며, 완료되면 목록에서 사라집니다.</span>
          </div>
          {tenant.purgeError && (
            <p className="mt-1" data-testid="purge-error-line">
              마지막 시도 오류: <code className="text-xs">{tenant.purgeError}</code>
            </p>
          )}
        </div>
      )}

      {/* 테넌트 정보 카드 */}
      <Card>
        <CardHeader>
          {isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <CardTitle
                ref={titleRef}
                tabIndex={-1}
                className="min-w-0 text-xl break-words outline-none"
                data-testid="tenant-detail-name"
              >
                {tenant?.name}
              </CardTitle>
              {tenant && (
                <div className="flex shrink-0 items-center gap-2">
                  {/* 정보 편집(WP-336) — 보조(outline) 버튼. 삭제됨·영구 삭제 중이면 숨긴다(WP-341: 서버도 409, 영구 삭제 이름 확인 보호). */}
                  {isLive && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="edit-tenant-button"
                      onClick={() => setEditOpen(true)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      편집
                    </Button>
                  )}
                  {/* 상태 액션 — ACTIVE 면 정지(위험 구역 [삭제]와 같은 outline+빨간 글자 톤, N2), SUSPENDED 면 활성화.
                      삭제됨·영구 삭제 중의 복원은 배너로 옮겼다(N3). */}
                  {isLive &&
                    (isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        data-testid="suspend-button"
                        onClick={(e) => openConfirm('suspend', e.currentTarget)}
                      >
                        정지
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        data-testid="activate-button"
                        onClick={(e) => openConfirm('activate', e.currentTarget)}
                      >
                        활성화
                      </Button>
                    ))}
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : (
            tenant && (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">슬러그</dt>
                <dd>{tenant.slug ?? '-'}</dd>
                <dt className="text-muted-foreground">상태</dt>
                <dd>
                  <TenantStatusBadge status={tenant.status} />
                </dd>
                <dt className="text-muted-foreground">생성일</dt>
                <dd>{formatDate(tenant.createdAt)}</dd>
                <dt className="text-muted-foreground">멤버수</dt>
                <dd data-testid="tenant-member-count">{tenant.memberCount}</dd>
              </dl>
            )
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* 드라이브 한도 카드(#81) */}
      <div className="rounded-lg border p-4" data-testid="quota-section">
        <h3 className="mb-2 text-sm font-semibold">드라이브 용량 한도 (GB)</h3>
        <div className="flex items-center gap-2">
          <Input
            data-testid="quota-gb-input"
            type="number"
            value={gb}
            onChange={(e) => setGb(e.target.value)}
            className="w-32"
            disabled={!isLive}
          />
          {/* 삭제됨·영구 삭제 중에는 서버가 409 로 거부하므로 편집 UI 를 잠근다. */}
          <Button data-testid="quota-save" disabled={!isLive} onClick={() => quotaMutation.mutate()}>
            저장
          </Button>
        </div>
      </div>

      <Separator />

      {/* 멤버 테이블 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">멤버</h2>
          {/* 소유자/멤버 추가(#497) — 테넌트가 정상 조회됐을 때만 노출. */}
          {tenant && (
            <Button
              variant="outline"
              size="sm"
              data-testid="add-member-button"
              disabled={!isLive}
              onClick={() => setAddMemberOpen(true)}
            >
              멤버 추가
            </Button>
          )}
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>사용자 ID</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersLoading || (isLoading && !members) ? (
                <TableSkeletonRows columns={MEMBER_COLUMN_COUNT} />
              ) : membersError ? (
                <TableEmptyRow
                  colSpan={MEMBER_COLUMN_COUNT}
                  message="멤버 목록을 불러오지 못했습니다."
                />
              ) : members && members.length > 0 ? (
                members.map((member) => (
                  <TableRow key={member.userId} data-testid="member-row">
                    <TableCell className="font-medium">
                      {member.name}
                      {/* 플랫폼 운영자 계정에만 핀 표시 */}
                      {member.isPlatformOperator && (
                        <span
                          data-testid="operator-pin"
                          className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                        >
                          운영자
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{member.username}</TableCell>
                    <TableCell className="text-muted-foreground">{member.email ?? '-'}</TableCell>
                    <TableCell>
                      <RoleBadge role={member.role} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{memberStatusLabel(member.status)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow colSpan={MEMBER_COLUMN_COUNT} message="멤버가 없습니다." />
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 위험 구역(WP-341) — 삭제 불가 테넌트(기본 테넌트)도 숨기지 않고 이유와 비활성 버튼을 보여준다(N5). 영구 삭제 중 숨김은 컴포넌트가 status 로 판단한다. */}
      {tenant && (
        <TenantDangerZone
          status={tenant.status}
          deletable={tenant.deletable}
          purgePending={purgeMutation.isPending}
          busy={busy}
          hasPurgeError={!!tenant.purgeError}
          onDelete={(trigger) => openConfirm('remove', trigger)}
          onPurge={(trigger) => {
            triggerRef.current = trigger
            setPurgeOpen(true)
          }}
        />
      )}

      {/* 영구 삭제 확인 다이얼로그 — 이름 입력 확인. */}
      {tenant && (
        <PurgeTenantDialog
          open={purgeOpen}
          onOpenChange={setPurgeOpen}
          tenantName={tenant.name}
          pending={purgeMutation.isPending}
          busy={busy}
          onConfirm={(confirmName) => purgeMutation.mutate(confirmName)}
          onCloseAutoFocus={restoreFocus}
        />
      )}

      {/* 멤버 추가 다이얼로그(#497) — id 는 invalidate 키와 byte-identical 한 string 으로 넘긴다. */}
      {id && (
        <AddTenantMemberDialog tenantId={id} open={addMemberOpen} onOpenChange={setAddMemberOpen} />
      )}

      {/* 테넌트 정보 편집 다이얼로그(WP-336) — 열 때만 마운트해 그 시점 값으로 폼을 채운다. */}
      {id && tenant && isLive && editOpen && (
        <EditTenantDialog tenantKey={id} tenant={tenant} onOpenChange={setEditOpen} />
      )}

      {/* 정지/활성화/삭제 확인 다이얼로그 */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          {confirmAction && confirmCopy && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy.title(tenant?.name ?? '')}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy.description(tenant?.name ?? '')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={statusMutation.isPending}>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant={confirmAction === 'activate' ? 'default' : 'destructive'}
                  data-testid={confirmAction === 'remove' ? 'confirm-delete' : 'confirm-suspend'}
                  disabled={statusMutation.isPending}
                  // AlertDialogAction 은 기본적으로 클릭 시 닫는다 — 비동기 결과 전까지 열어두기 위해 기본 닫힘을 막고
                  // mutation onSuccess/onError 에서 명시적으로 닫는다.
                  onClick={(e) => {
                    e.preventDefault()
                    statusMutation.mutate(confirmAction)
                  }}
                >
                  <PendingLabel
                    pending={statusMutation.isPending}
                    label={ACTIONS[confirmAction].verb}
                    pendingLabel={`${ACTIONS[confirmAction].verb} 중…`}
                  />
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
