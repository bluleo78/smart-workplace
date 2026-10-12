import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { platformTenants } from '../api/platformTenants'
import { CreateTenantDialog } from '../components/CreateTenantDialog'
import { TenantStatusBadge } from '../components/TenantStatusBadge'
import { Button } from '../components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { TableSkeletonRows } from '../components/ui/table-skeleton'
import { formatDate } from '../lib/utils'
import type { TenantSummary } from '../types/platform'

// 삭제됨 탭에 속하는 상태 — 삭제(복원 가능)와 영구 삭제 진행 중.
function isDeleted(t: TenantSummary): boolean {
  return t.status === 'DELETED' || t.status === 'PURGING'
}

const COLUMN_COUNT = 5

// 운영자 콘솔 테넌트 목록 화면.
// - 헤더행(제목 + 생성 버튼)은 쿼리 상태와 무관하게 항상 렌더한다.
// - 테이블 영역만 로딩/에러/빈/목록으로 전환한다.
// - 목록 API 는 모든 상태를 반환하고, 화면이 '운영 중'(활성·정지)/'삭제됨'(삭제·영구 삭제 중) 탭으로 나눈다(WP-341).
export default function TenantListPage() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  // 탭 상태는 URL(?view=deleted)로 유지 — 새로고침·뒤로가기에도 보던 탭을 유지한다.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'deleted' ? 'deleted' : 'active'

  const {
    data: tenants,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: platformTenants.list,
  })

  // 탭별 목록 — 건수 표시에 두 목록이 모두 필요해 한 번 조회한 결과를 나눈다.
  const live = tenants?.filter((t) => !isDeleted(t)) ?? []
  const deleted = tenants?.filter(isDeleted) ?? []
  const rows = view === 'deleted' ? deleted : live

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">테넌트</h1>
        <Button data-testid="create-tenant-button" onClick={() => setCreateOpen(true)}>
          테넌트 생성
        </Button>
      </div>

      {/* 보기 전환 토글 그룹(S7) — 탭 패널이 따로 없는 URL 필터라 tab 패턴 대신 aria-pressed 버튼으로 노출한다.
          회색 트랙 안 흰 선택 칩. 운영 중은 쿼리를 지워 기본 URL 로 돌아간다. */}
      <div className="inline-flex rounded-md bg-muted p-1" role="group" aria-label="테넌트 보기">
        {(
          [
            ['active', `운영 중 ${live.length}`],
            ['deleted', `삭제됨 ${deleted.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            data-state={view === key ? 'on' : 'off'}
            data-testid={`tenant-view-${key}`}
            onClick={() => setSearchParams(key === 'deleted' ? { view: 'deleted' } : {})}
            className={
              view === key
                ? 'whitespace-nowrap rounded-sm bg-background px-3 py-1 text-sm font-medium shadow-sm'
                : 'whitespace-nowrap rounded-sm px-3 py-1 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {isError ? (
        <div
          className="flex flex-col items-center gap-3 rounded-md border py-12 text-center"
          data-testid="tenant-list-error"
        >
          <p className="text-sm text-muted-foreground">테넌트 목록을 불러오지 못했습니다.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>슬러그</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">멤버수</TableHead>
                {/* 삭제됨 탭은 마지막 열을 삭제일로 — 영구 삭제 판단에 생성일보다 삭제 시점이 중요하다. */}
                <TableHead>{view === 'deleted' ? '삭제일' : '생성일'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeletonRows columns={COLUMN_COUNT} />
              ) : rows.length > 0 ? (
                rows.map((tenant) => (
                  <TableRow
                    key={tenant.id}
                    className="cursor-pointer"
                    data-testid="tenant-row"
                    onClick={() => navigate(`/tenants/${tenant.id}`)}
                  >
                    {/* 키보드 진입점(S8) — 이름 셀을 링크로 만든다. 행 클릭은 그대로 두되 링크 클릭이 행 핸들러로 번져 이중 이동하지 않게 막는다. */}
                    <TableCell className="font-medium">
                      <Link
                        to={`/tenants/${tenant.id}`}
                        data-testid="tenant-row-link"
                        className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {tenant.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tenant.slug ?? '-'}</TableCell>
                    <TableCell>
                      <TenantStatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell className="text-right">{tenant.memberCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(
                        view === 'deleted' ? (tenant.deletedAt ?? tenant.createdAt) : tenant.createdAt,
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center">
                    <div
                      className="flex flex-col items-center gap-3"
                      data-testid="tenant-list-empty"
                    >
                      {view === 'deleted' ? (
                        // 삭제됨 탭 빈 상태 — 생성 유도 버튼 없이 안내만.
                        <p className="text-sm text-muted-foreground">삭제된 테넌트가 없습니다.</p>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">아직 테넌트가 없습니다.</p>
                          <Button size="sm" onClick={() => setCreateOpen(true)}>
                            첫 테넌트 생성
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
