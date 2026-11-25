import { type ReactNode, useMemo } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkflowProblem } from '@/lib/workflows'

import { type GraphProblems, instructionPreview, type OverviewTab } from './drawerModel'
import { DrawerShell, YamlFixButton } from './DrawerShell'
import { readShared, type WorkflowGraph } from './graphYaml'
import { WorkflowProblemsList } from './WorkflowProblemsList'

/**
 * 워크플로우 개요 서랍(WP-2091) — 빈 캔버스나 탭 머리 검사 배지(그래프 보기)를 누르면 연다.
 * 탭 「검사 결과 n」(행을 누르면 그 노드 서랍으로), 읽기 전용 「역할」「시작 조건」「공통 지시」.
 * 읽기 탭은 그래프에서 고치지 않는다 — 탭 끝 「YAML 에서 고치기」로 YAML 보기에 넘긴다(편집 폼을 둘로 두지 않으려는 것).
 * 탭은 부모가 든다(tab·onTabChange) — 배지가 검사 결과 탭을 바로 열 수 있게.
 */
export function OverviewDrawer({ yaml, graph, tab, onTabChange, problems, readOnly, onSelectProblem, onAddAskPath, onOpenYaml, onClose }: {
  yaml: string
  /** 부모가 이미 파싱한 그래프 — 역할·시작 조건·노드 이름을 여기서 읽는다 */
  graph: WorkflowGraph
  tab: OverviewTab
  onTabChange: (tab: OverviewTab) => void
  problems: GraphProblems
  readOnly: boolean
  onSelectProblem: (problem: WorkflowProblem) => void
  onAddAskPath: (nodeKey: string) => void
  onOpenYaml: () => void
  onClose: () => void
}) {
  // 공통 지시 본문은 그래프에 이름만 있어 YAML 에서 따로 읽는다 — 그 탭을 볼 때만, yaml 이 같으면 다시 파싱하지 않는다
  const shared = useMemo(() => (tab === 'shared' ? readShared(yaml) : []), [yaml, tab])
  const nodeNames = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n.name ?? n.key])), [graph.nodes])
  // 시작 조건은 시작 노드에서 나가는 start 선(라벨 = 「담당=역할」 등)
  const triggers = graph.edges.filter((e) => e.kind === 'start')
  const fixInYaml = <YamlFixButton onClick={onOpenYaml} />

  return (
    <DrawerShell label="워크플로우 개요" heading={<h3 className="min-w-0 truncate text-sm font-semibold">워크플로우 개요</h3>} onClose={onClose}>
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as OverviewTab)} className="gap-0">
        <TabsList className="mx-3 mb-3 w-[calc(100%-1.5rem)]">
          <TabsTrigger value="problems">{`검사 결과 ${problems.problems.length}`}</TabsTrigger>
          <TabsTrigger value="roles">역할</TabsTrigger>
          <TabsTrigger value="triggers">시작 조건</TabsTrigger>
          <TabsTrigger value="shared">공통 지시</TabsTrigger>
        </TabsList>
        <TabsContent value="problems" className="px-3 pb-3">
          <WorkflowProblemsList
            problems={problems.problems}
            checking={problems.checking}
            failed={problems.failed}
            stale={problems.stale}
            // 편집기 readOnly(저장 중·로그아웃)에 더해 부모의 판정(충돌 포함)도 따른다 — 헤더 배지와 같게
            readOnly={readOnly || problems.readOnly === true}
            // 실패 안내는 헤더 배지(그래프 보기)가 이미 알린다 — 개요 서랍은 다시 알리지 않는다
            announce={false}
            onRetry={problems.onRetry}
            onAddAskPath={onAddAskPath}
            onOpenYaml={onOpenYaml}
            onSelect={onSelectProblem}
          />
        </TabsContent>
        <TabsContent value="roles">
          <ReadPane empty="역할이 없습니다" fix={fixInYaml}>
            {graph.roles.map((r) => (
              <li key={r.key} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{r.name ?? r.key}</span>
                <code className="shrink-0 text-xs text-muted-foreground">{r.key}</code>
              </li>
            ))}
          </ReadPane>
        </TabsContent>
        <TabsContent value="triggers">
          <ReadPane empty="시작 조건이 없습니다" fix={fixInYaml}>
            {triggers.map((e) => (
              <li key={e.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-muted-foreground">{e.label}</span>
                <span aria-hidden="true" className="text-muted-foreground">→</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{nodeNames.get(e.to) ?? e.to}</span>
              </li>
            ))}
          </ReadPane>
        </TabsContent>
        <TabsContent value="shared">
          <ReadPane empty="공통 지시가 없습니다" fix={fixInYaml}>
            {shared.map((s) => (
              <li key={s.name} className="space-y-1">
                {/* 서랍 제목이 h3 라 항목 이름은 h4(제목 단계 건너뛰기 없음 — WP-2054) */}
                <h4 className="text-xs font-medium">{s.name}</h4>
                <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{instructionPreview(s.text)}</p>
              </li>
            ))}
          </ReadPane>
        </TabsContent>
      </Tabs>
    </DrawerShell>
  )
}

/** 읽기 탭 한 칸 — 항목 목록(없으면 빈 안내)과 끝의 「YAML 에서 고치기」. */
function ReadPane({ empty, fix, children }: { empty: string; fix: ReactNode; children: ReactNode[] }) {
  return (
    <div className="space-y-3 px-3 pb-3">
      {children.length === 0
        ? <p className="text-muted-foreground">{empty}</p>
        : <ul className="space-y-2">{children}</ul>}
      {fix}
    </div>
  )
}
