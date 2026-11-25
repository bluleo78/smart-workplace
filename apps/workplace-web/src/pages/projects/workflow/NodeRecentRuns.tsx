import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useWorkflowRuns } from '@/hooks/queries/useWorkflowRuns'
import { formatRelativeTime } from '@/lib/formatters'
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/workflow'

import { workflowTabSearch } from './workflowView'

/** 서랍에 보일 최대 실행 수 — 넘치면 실행 목록으로 보낸다 */
const MAX_ROWS = 5

/**
 * 노드 서랍 「최근 실행」 탭(WP-2091) — 지금 이 노드에 머문 실행을 최대 5건 보인다.
 * 실행 목록 API 의 node 필터를 그대로 쓰므로 목록 화면과 같은 기준이다. 줄을 누르면 실행 목록에서 그 실행의 상세가 열린다.
 * enabled 는 탭이 열렸을 때만 true — 탭을 열기 전엔 묻지 않는다.
 */
export function NodeRecentRuns({ workflowId, nodeKey, enabled }: { workflowId: number; nodeKey: string; enabled: boolean }) {
  // 링크는 지금 주소(?workflow= 등)를 지키고 view·run 만 바꾼다 — 보기 전환(setView)과 같은 조립 함수를 쓴다
  const [current] = useSearchParams()
  const runsSearch = (runId?: number) => '?' + workflowTabSearch(current, { view: 'runs', run: runId === undefined ? null : String(runId) }).toString()
  const runs = useWorkflowRuns(workflowId, { node: nodeKey }, enabled)
  const all = runs.data?.pages.flatMap((p) => p.items) ?? []
  const items = all.slice(0, MAX_ROWS)
  // 다음 쪽이 있거나 5건을 넘으면 더 있다
  const hasMore = all.length > MAX_ROWS || runs.hasNextPage

  return (
    <div className="space-y-2 px-3 pb-3">
      <p className="text-xs text-muted-foreground">지금 이 노드에 있는 실행</p>
      {runs.isError ? (
        <p role="alert" className="text-sm">
          실행을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void runs.refetch()}>다시 시도</Button>
        </p>
      ) : runs.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">이 노드에 머문 실행이 없습니다</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.runId}>
              <Link
                to={{ search: runsSearch(item.runId) }}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{item.issueKey}</span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <Badge variant="outline" className={RUN_STATUS_TONE[item.status]}>{RUN_STATUS_LABEL[item.status]}</Badge>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(item.enteredAt)}부터</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        // 실행 목록의 노드 필터는 주소가 아니라 화면 상태라 노드를 함께 넘길 수 없다 — 목록으로만 보낸다
        <Link to={{ search: runsSearch() }} className="text-sm underline underline-offset-2">실행 목록에서 모두 보기</Link>
      )}
    </div>
  )
}
