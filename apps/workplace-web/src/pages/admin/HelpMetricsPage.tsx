// 설정 › 도움말 측정(WP-1512) — 매뉴얼에 채울 빈틈을 관리자가 본다.
// 세 탭: 화면별 열기(어느 화면에서 도움말을 많이 여는가) · 결과 없는 검색어(검색이 0건) · 매뉴얼에서 못 찾은 질문(AI 가 절을 못 찾음).
// 탭마다 표 하나, 기간(7·30·90일)은 세 탭이 함께 쓴다. 화면 배치는 감사 로그와 같은 SettingsPage + 표.
import { useState } from 'react'

import type { HelpMetricDays, HelpMetricKind } from '@/api/help'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { LoadErrorState } from '@/components/LoadErrorState'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyRow } from '@/components/ui/table-empty'
import { TableSkeletonRows } from '@/components/ui/table-skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHelpMetrics } from '@/hooks/queries/useHelpMetrics'
import { formatDateTime, formatNumber } from '@/lib/formatters'

/** 기간 선택지 — 값은 서버에 보내는 일수. */
const PERIODS: { value: HelpMetricDays; label: string }[] = [
  { value: 7, label: '7일' },
  { value: 30, label: '30일' },
  { value: 90, label: '90일' },
]

/**
 * 탭 정의 — 표 이름·첫 열 머리·첫 열에 보일 값(종류마다 다른 필드)·도움말 열 표시 여부.
 * 결과 없는 검색어는 서버가 검색어만으로 묶어(화면이 달라도 한 줄) 도움말 값이 없으므로 그 열을 숨긴다.
 */
type TabDef = {
  kind: HelpMetricKind
  label: string
  firstHead: string
  firstValue: 'route' | 'term'
  showHelpId: boolean
}

/** 종류별 탭 정의 — Record 라 모든 종류가 빠짐없이 있고 조회가 빗나가지 않는다. */
const TAB_BY_KIND: Record<HelpMetricKind, TabDef> = {
  OPEN: { kind: 'OPEN', label: '화면별 열기', firstHead: '화면', firstValue: 'route', showHelpId: true },
  SEARCH_MISS: { kind: 'SEARCH_MISS', label: '결과 없는 검색어', firstHead: '검색어', firstValue: 'term', showHelpId: false },
  AI_GAP: { kind: 'AI_GAP', label: '매뉴얼에서 못 찾은 질문', firstHead: '질문', firstValue: 'term', showHelpId: true },
}
/** 탭 표시 순서 — 위 Record 의 선언 순서. */
const TABS = Object.values(TAB_BY_KIND)

/** 선택한 종류·기간의 집계 표 — 로딩·오류·빈 상태를 표 안에서 처리한다. */
function MetricsTable({ tab, days }: { tab: TabDef; days: HelpMetricDays }) {
  const query = useHelpMetrics(tab.kind, days)
  const items = query.data?.items ?? []
  // 열 수 — 첫 열 · (도움말) · 횟수 · 최근. 빈·오류·로딩 행의 colSpan 에 쓴다.
  const columns = tab.showHelpId ? 4 : 3

  return (
    <Table aria-label={tab.label}>
      <TableHeader>
        <TableRow>
          <TableHead>{tab.firstHead}</TableHead>
          {tab.showHelpId && <TableHead>도움말</TableHead>}
          <TableHead className="text-right">횟수</TableHead>
          <TableHead>최근</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.isPending ? (
          <TableSkeletonRows columns={columns} rows={5} />
        ) : query.isError ? (
          <TableRow>
            <TableCell colSpan={columns}>
              <LoadErrorState
                variant="inline"
                title="도움말 측정을 불러오지 못함"
                queries={[query]}
                testId="help-metrics-error"
              />
            </TableCell>
          </TableRow>
        ) : items.length === 0 ? (
          <TableEmptyRow colSpan={columns} message="기록 없음" />
        ) : (
          items.map((row, i) => {
            const first = row[tab.firstValue]
            return (
              <TableRow key={`${row.route}|${row.helpId}|${row.term}|${i}`}>
                {/* 질문·검색어는 길 수 있어 한 줄로 자르고 전문은 title 로 — 휴대폰에선 더 좁게 잘라 횟수·최근 열이 화면에 남게 */}
                <TableCell className="max-w-48 truncate sm:max-w-md" title={first}>
                  {first}
                </TableCell>
                {tab.showHelpId && (
                  <TableCell className="text-muted-foreground">{row.helpId || '-'}</TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatNumber(row.count)}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDateTime(row.lastAt)}
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

/** 도움말 측정 화면 — 탭(종류)과 기간 선택. */
export default function HelpMetricsPage() {
  const [kind, setKind] = useState<HelpMetricKind>('OPEN')
  const [days, setDays] = useState<HelpMetricDays>(7)
  const tab = TAB_BY_KIND[kind]

  return (
    <SettingsPage title="도움말 측정" help={{ id: 'help-metrics', name: '도움말 측정' }}>
      {/* 탭 목록과 표를 한 Tabs 안에 두어 탭의 aria-controls 가 실제 패널(표)을 가리키게 한다 */}
      <Tabs value={kind} onValueChange={(v) => setKind(v as HelpMetricKind)} className="gap-0">
        {/* 좁은 폭에서는 탭 줄과 기간을 두 줄로 나누고, 탭 줄은 제 안에서만 가로로 밀린다
            (탭 세 개가 화면보다 넓어 페이지 전체가 옆으로 밀리던 것을 막는다).
            탭은 flex-none — 기본 flex-1 이면 탭이 글자보다 좁게 줄어 이름이 겹친다 */}
        <div className="flex min-w-0 flex-col items-start gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.kind} value={t.kind} className="flex-none">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as HelpMetricDays)}>
            <SelectTrigger className="w-[100px] shrink-0" aria-label="기간">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* 표는 세 탭이 한 컴포넌트를 함께 쓰므로 패널 하나를 현재 탭 값으로 둔다 */}
        <TabsContent value={kind}>
          <MetricsTable tab={tab} days={days} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  )
}
