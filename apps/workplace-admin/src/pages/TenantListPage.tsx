import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { platformTenants } from '../api/platformTenants'
import { CreateTenantDialog } from '../components/CreateTenantDialog'
import { Badge } from '../components/ui/badge'
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
import type { TenantStatus } from '../types/platform'

// 생성일 포맷 — web 과 동일하게 yyyy-MM-dd.
function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'yyyy-MM-dd')
}

// 상태 배지 — ACTIVE 는 기본(success), SUSPENDED 는 강조(warning).
function StatusBadge({ status }: { status: TenantStatus }) {
  if (status === 'SUSPENDED') {
    return <Badge variant="warning">정지됨</Badge>
  }
  return <Badge variant="success">활성</Badge>
}

const COLUMN_COUNT = 5

// 운영자 콘솔 테넌트 목록 화면.
// - 헤더행(제목 + 생성 버튼)은 쿼리 상태와 무관하게 항상 렌더한다.
// - 테이블 영역만 로딩/에러/빈/목록으로 전환한다.
export default function TenantListPage() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)

  const {
    data: tenants,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: platformTenants.list,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">테넌트</h1>
        <Button data-testid="create-tenant-button" onClick={() => setCreateOpen(true)}>
          테넌트 생성
        </Button>
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
                <TableHead>생성일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeletonRows columns={COLUMN_COUNT} />
              ) : tenants && tenants.length > 0 ? (
                tenants.map((tenant) => (
                  <TableRow
                    key={tenant.id}
                    className="cursor-pointer"
                    data-testid="tenant-row"
                    onClick={() => navigate(`/tenants/${tenant.id}`)}
                  >
                    <TableCell className="font-medium">{tenant.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tenant.slug ?? '-'}</TableCell>
                    <TableCell>
                      <StatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell className="text-right">{tenant.memberCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(tenant.createdAt)}
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
                      <p className="text-sm text-muted-foreground">아직 테넌트가 없습니다.</p>
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        첫 테넌트 생성
                      </Button>
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
