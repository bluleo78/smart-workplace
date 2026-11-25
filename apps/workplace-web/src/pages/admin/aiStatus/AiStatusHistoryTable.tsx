// 처리 이력 표(WP-1825) — 행 하나가 처리(R-)나 위임 작업(W-) 한 건. 값 없음은 「—」.
// 행을 누르면 onOpen(상세 열기)이고, 키보드·보조기기의 진입점은 종류 칸 버튼이다 — 행 전체를 role=button 으로 두면
// 대상 링크가 버튼 안에 중첩되므로 RoleListPage 처럼 행은 마우스용 onClick 만, 진입점은 칸 안에 따로 둔다(WP-1555).
// 대상 링크는 행 누름과 따로 이동하도록 전파를 막는다.
import type { AiRunListItem } from '@/api/aiStatus'
import { StatusBadge } from '@/components/ui/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeletonRows } from '@/components/ui/table-skeleton'
import { aiRunReasonLabel } from '@/lib/aiRunReasonLabels'
import { EMPTY_GLYPH, formatDurationMs } from '@/lib/formatters'

import { AiStatusActor } from './AiStatusActor'
import { runStatusBadge, runStatusLabel, runTimeText, tokensText } from './aiStatusHistoryModel'
import { AiStatusKindButton } from './AiStatusKindButton'
import { AiStatusRunTarget } from './AiStatusRunTarget'

const COLUMNS = 10

/** 시간(ms) 칸 — 없으면 빈 값 표기. */
function msText(ms: number | null): string {
  return ms === null ? EMPTY_GLYPH : formatDurationMs(ms)
}

/** 처리 이력 표 — 로딩 중이면 스켈레톤 행, 빈 목록 안내는 쓰는 쪽이 표 아래에 둔다. */
export function AiStatusHistoryTable({
  items,
  loading,
  onOpen,
}: {
  items: AiRunListItem[]
  loading: boolean
  onOpen: (item: AiRunListItem) => void
}) {
  return (
    <div className="rounded-md border">
      <Table aria-label="AI 처리 이력">
        <TableHeader>
          <TableRow>
            <TableHead>시각</TableHead>
            <TableHead>종류</TableHead>
            <TableHead>대상</TableHead>
            <TableHead>실행 주체</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>대기</TableHead>
            <TableHead>처리 시간</TableHead>
            <TableHead>토큰</TableHead>
            <TableHead>모델</TableHead>
            <TableHead>오류</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows columns={COLUMNS} rows={8} />
          ) : (
            items.map((item) => (
                <TableRow
                  key={item.id}
                  data-testid="ai-run-row"
                  className="row-hover cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpen(item)}
                >
                  <TableCell className="whitespace-nowrap text-sm">{runTimeText(item.startedAt)}</TableCell>
                  <TableCell>
                    <AiStatusKindButton item={item} onOpen={onOpen} className="hover:underline" />
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    <AiStatusRunTarget target={item.target} />
                  </TableCell>
                  <TableCell>
                    <AiStatusActor actor={item.actor} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge type={runStatusBadge(item.status)}>{runStatusLabel(item.status)}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{msText(item.waitMs)}</TableCell>
                  <TableCell className="whitespace-nowrap">{msText(item.durationMs)}</TableCell>
                  <TableCell className="whitespace-nowrap">{tokensText(item.inputTokens, item.outputTokens)}</TableCell>
                  <TableCell>{item.model ?? EMPTY_GLYPH}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-muted-foreground" title={item.errorReason ?? undefined}>
                    {item.errorReason == null ? EMPTY_GLYPH : aiRunReasonLabel(item.errorReason)}
                  </TableCell>
                </TableRow>
              ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
