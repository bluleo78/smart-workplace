// AI 현황 개요의 종류별 자리(WP-1824) — 실패율 내림차순 상위 6행을 표로, 남은 종류는 「나머지 n종 보기」 로 접어 둔다.
// 모바일 폭은 표 대신 목록(종류·실패율 + 건수·p95·토큰) — useIsMobile 이 폭을 판정해 갈라 그린다(설계 §5-3 6).
// 행(종류 이름 링크 — 표에서는 링크가 행 전체를 덮는다)을 누르면 그 종류의 처리 이력(/settings/ai-status/history?kind=…)으로 간다(WP-1824 리뷰).
// 요약 행은 새로 계산하지 않는다(설계 §5-6 5).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { AiStatusPeriod, KindRow } from '@/api/aiStatus'
import { MetricCard } from '@/components/metrics/MetricCard'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/useIsMobile'
import { EMPTY_GLYPH, formatDateTime } from '@/lib/formatters'

import { durationText, historyHref, numberText, percentText, sortKinds } from './aiStatusModel'

/** 표의 열 — 설계 §5-3 6 확정 순서(종류·건수·실패율·p50·p95·입력 토큰·출력 토큰·최근 실패). */
const COLUMNS = ['종류', '건수', '실패율', 'p50', 'p95', '입력 토큰', '출력 토큰', '최근 실패'] as const

/** 처음 보이는 종류 수 — 상위 6행만 펼치고 나머지는 접는다(설계 §5-6 5). */
const TOP_N = 6

/** 최근 실패 칸 — 시각과 사유를 이어 쓰고, 사유가 없으면 시각만, 실패 기록이 없으면 —. */
function lastFailureText(row: KindRow): string {
  if (row.lastFailure == null) return EMPTY_GLYPH
  const at = formatDateTime(row.lastFailure.at)
  return row.lastFailure.reason == null ? at : `${at} · ${row.lastFailure.reason}`
}

/** 종류 한 행의 셀 텍스트 — 표 모양과 목록 모양이 같은 값·같은 포매터를 쓰게 여기서 만든다. */
function kindCells(row: KindRow) {
  return {
    count: numberText(row.count),
    failureRate: percentText(row.failureRate),
    p50: durationText(row.p50),
    p95: durationText(row.p95),
    inputTokens: numberText(row.inputTokens),
    outputTokens: numberText(row.outputTokens),
    lastFailure: lastFailureText(row),
  }
}

/** 종류 이름 링크 — 키보드·화면 읽기 프로그램이 닿는 이동 수단. stretch 면 ::after 가 상대 위치 조상(표 행)을 덮어
 * 행 아무 곳을 눌러도(가운데·Ctrl 클릭 새 탭 포함) 같은 링크로 간다 — 행에 따로 클릭 손잡이를 두지 않는다. */
function KindLink({ kind, href, stretch = false }: { kind: string; href: string; stretch?: boolean }) {
  return (
    <Link to={href} className={stretch ? 'hover:underline after:absolute after:inset-0' : 'hover:underline'}>
      {kind}
    </Link>
  )
}

/** 종류별 표 — 데스크톱은 여덟 열 표, 모바일은 한 줄 목록. 둘 다 같은 순서(실패율 내림차순 상위 6 + 접힌 나머지)를 쓴다.
 * 행마다 그 종류·지금 기간의 처리 이력으로 가는 링크를 둔다. */
export function AiStatusKindsTable({ kinds, period }: { kinds: KindRow[]; period: AiStatusPeriod }) {
  const [expanded, setExpanded] = useState(false)
  const isMobile = useIsMobile()

  // 한 번 정렬한 목록을 앞 TOP_N 행과 접힌 나머지로 나눈다 — 요약 행을 새로 계산하지 않는다(집계 금지)
  const sorted = useMemo(() => sortKinds(kinds), [kinds])
  const rows = expanded ? sorted : sorted.slice(0, TOP_N)
  const restCount = Math.max(0, sorted.length - TOP_N)
  const toggleLabel = expanded ? `나머지 ${restCount}종 접기` : `나머지 ${restCount}종 보기`

  return (
    <section className="space-y-2" data-testid="ai-status-kinds" data-help="ai-status.kinds">
      <h2 className="text-sm font-semibold">종류별</h2>
      <MetricCard>
        {isMobile ? (
          <ul aria-label="종류별" className="space-y-3">
            {rows.map((row) => {
              const cells = kindCells(row)
              return (
                <li key={row.kind} data-testid={`kind-row-${row.kind}`} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      <KindLink kind={row.kind} href={historyHref({ period, kinds: [row.kind] })} />
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">실패율 {cells.failureRate}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {cells.count}건 · p95 {cells.p95} · 입력 토큰 {cells.inputTokens} · 출력 토큰 {cells.outputTokens}
                  </p>
                </li>
              )
            })}
          </ul>
        ) : (
          <Table aria-label="종류별">
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const cells = kindCells(row)
                return (
                  <TableRow key={row.kind} data-testid={`kind-row-${row.kind}`} className="relative">
                    <TableCell className="font-medium">
                      <KindLink kind={row.kind} href={historyHref({ period, kinds: [row.kind] })} stretch />
                    </TableCell>
                    <TableCell className="tabular-nums">{cells.count}</TableCell>
                    <TableCell className="tabular-nums">{cells.failureRate}</TableCell>
                    <TableCell className="tabular-nums">{cells.p50}</TableCell>
                    <TableCell className="tabular-nums">{cells.p95}</TableCell>
                    <TableCell className="tabular-nums">{cells.inputTokens}</TableCell>
                    <TableCell className="tabular-nums">{cells.outputTokens}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{cells.lastFailure}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </MetricCard>
      {restCount > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {toggleLabel}
        </Button>
      )}
    </section>
  )
}
