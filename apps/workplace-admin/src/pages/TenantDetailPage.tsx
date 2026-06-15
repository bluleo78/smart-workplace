import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { platformTenants } from '../api/platformTenants'
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
import type { TenantMember, TenantStatus } from '../types/platform'

// 생성일 포맷 — 목록 화면과 동일하게 yyyy-MM-dd.
function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'yyyy-MM-dd')
}

// 상태 배지 — 목록 화면(TenantListPage)과 동일 매핑(ACTIVE=success/활성, SUSPENDED=warning/정지됨).
function StatusBadge({ status }: { status: TenantStatus }) {
  if (status === 'SUSPENDED') {
    return (
      <Badge variant="warning" data-testid="tenant-status">
        정지됨
      </Badge>
    )
  }
  return (
    <Badge variant="success" data-testid="tenant-status">
      활성
    </Badge>
  )
}

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

const MEMBER_COLUMN_COUNT = 4

// axios 404 판별 — 테넌트 단건 조회 실패가 "없음" 인지 구분한다.
function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404
}

// 운영자 콘솔 테넌트 상세 화면.
// - 테넌트 정보 카드 + 상태 액션(정지/활성화) + 멤버 테이블.
// - 단건 조회 404 → "찾을 수 없습니다" 안내 후 early return(멤버 테이블/액션 미렌더).
export default function TenantDetailPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)

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
  })

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

  // 정지/활성화 mutation — 성공 시 ['tenant', id] 무효화로 상태를 재조회한다.
  // 동작 문구(verb)는 호출 시점에 onMutate 로 캡처해 context 로 흘린다. invalidate 후 재조회로
  // tenant.status 가 바뀌면, 성공/실패 콜백이 늦게 읽는 status 가 반전되어 토스트 문구가 틀어지는
  // stale-closure 문제가 있으므로, 콜백은 context 의 verb 만 쓴다.
  const statusMutation = useMutation({
    mutationFn: () =>
      tenant?.status === 'ACTIVE'
        ? platformTenants.suspend(Number(id))
        : platformTenants.activate(Number(id)),
    onMutate: (): { verb: string } => ({
      verb: tenant?.status === 'ACTIVE' ? '정지' : '활성화',
    }),
    onSuccess: (_data, _vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['tenant', id] })
      toast.success(`테넌트를 ${ctx.verb}했습니다.`)
      setConfirmOpen(false)
    },
    onError: (_err, _vars, ctx) => {
      toast.error(`테넌트 ${ctx?.verb}에 실패했습니다.`)
      setConfirmOpen(false)
    },
  })

  // 404 → 전용 안내 + 목록 링크. early return.
  if (isError && isNotFound(error)) {
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
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border py-16 text-center">
        <p className="text-sm text-muted-foreground">테넌트 정보를 불러오지 못했습니다.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">목록으로</Link>
        </Button>
      </div>
    )
  }

  const isActive = tenant?.status === 'ACTIVE'

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

      {/* 테넌트 정보 카드 */}
      <Card>
        <CardHeader>
          {isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-xl" data-testid="tenant-detail-name">
                {tenant?.name}
              </CardTitle>
              {/* 상태 액션 — ACTIVE 면 정지(destructive), SUSPENDED 면 활성화. */}
              {tenant &&
                (isActive ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid="suspend-button"
                    onClick={() => setConfirmOpen(true)}
                  >
                    정지
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    data-testid="activate-button"
                    onClick={() => setConfirmOpen(true)}
                  >
                    활성화
                  </Button>
                ))}
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
                  <StatusBadge status={tenant.status} />
                </dd>
                <dt className="text-muted-foreground">생성일</dt>
                <dd>{formatDate(tenant.createdAt)}</dd>
                <dt className="text-muted-foreground">멤버수</dt>
                <dd>{tenant.memberCount}</dd>
              </dl>
            )
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* 멤버 테이블 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">멤버</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
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
                    <TableCell className="font-medium">{member.name}</TableCell>
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

      {/* 정지/활성화 확인 다이얼로그 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isActive ? '테넌트 정지' : '테넌트 활성화'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? '이 테넌트를 정지하시겠습니까? 정지된 테넌트의 사용자는 접근할 수 없습니다.'
                : '이 테넌트를 활성화하시겠습니까?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusMutation.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              variant={isActive ? 'destructive' : 'default'}
              data-testid="confirm-suspend"
              disabled={statusMutation.isPending}
              // AlertDialogAction 은 기본적으로 클릭 시 닫는다 — 비동기 결과 전까지 열어두기 위해 기본 닫힘을 막고
              // mutation onSuccess/onError 에서 명시적으로 닫는다.
              onClick={(e) => {
                e.preventDefault()
                statusMutation.mutate()
              }}
            >
              {isActive ? '정지' : '활성화'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
