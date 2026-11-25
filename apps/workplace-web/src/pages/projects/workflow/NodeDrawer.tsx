import { useMemo } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { NodeDrawerTab } from './drawerModel'
import { DrawerShell } from './DrawerShell'
import { type NodePatch, readNodeDetail, updateNode, type WorkflowGraph } from './graphYaml'
import { NodeKindIcon } from './NodePanel'
import { NodePathsTab } from './NodePathsTab'
import { NodeRecentRuns } from './NodeRecentRuns'
import { NodeSettingsTab } from './NodeSettingsTab'

/**
 * 고른 노드를 고치는 노드 서랍(WP-2091) — 옛 노드 편집 패널을 대신한다. 탭 「설정」「결과·경로」「최근 실행」.
 * 상태를 따로 두지 않고 yaml 에서 매번 읽는다 — YAML 편집기와 한 원본을 공유하기 위해서다. 입력이 바뀔 때마다 updateNode 로 YAML 을 고쳐 onChange 로 올린다.
 * 부모는 key={노드 키} 로 그려 노드를 바꾸면 줄의 지역 상태(입력 중인 값 키·지시 펼침 등)가 새로 시작되게 한다.
 * 탭은 부모가 든다(tab·onTabChange) — 검사 결과에서 노드의 특정 탭을 열 수 있게.
 */
export function NodeDrawer({ yaml, graph, nodeKey, tab, onTabChange, readOnly, onChange, onClose, onOpenYaml, workflowId }: {
  yaml: string
  /** 부모가 이미 파싱한 그래프 — 서랍이 YAML 을 다시 파싱하지 않게 역할·공용 지시·노드 목록을 여기서 읽는다 */
  graph: WorkflowGraph
  nodeKey: string
  tab: NodeDrawerTab
  onTabChange: (tab: NodeDrawerTab) => void
  readOnly: boolean
  onChange: (yaml: string) => void
  onClose: () => void
  /** YAML 보기로 넘어간다 — 설정 탭의 「YAML 에서 고치기」 안내가 쓴다 */
  onOpenYaml: () => void
  /** 「최근 실행」 탭이 실행을 조회하는 정의 id — 탭을 열었을 때만 묻는다 */
  workflowId: number
}) {
  // yaml·노드가 같은 재렌더(선택·호버 등)에서는 다시 파싱하지 않는다
  const detail = useMemo(() => readNodeDetail(yaml, nodeKey), [yaml, nodeKey])
  if (!detail) return null
  const patch = (p: NodePatch) => onChange(updateNode(yaml, nodeKey, p))
  const tabProps = { yaml, graph, nodeKey, detail, readOnly, onChange, patch }

  return (
    <DrawerShell
      label="노드 설정"
      heading={
        <>
          <NodeKindIcon type={detail.type} />
          <h3 className="min-w-0 truncate text-sm font-semibold">{`${detail.name || detail.key} 노드 설정`}</h3>
          <code className="shrink-0 text-xs text-muted-foreground">{detail.key}</code>
        </>
      }
      onClose={onClose}
    >
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as NodeDrawerTab)} className="gap-0">
        <TabsList className="mx-3 mb-3 w-[calc(100%-1.5rem)]">
          <TabsTrigger value="settings">설정</TabsTrigger>
          <TabsTrigger value="paths">결과·경로</TabsTrigger>
          <TabsTrigger value="runs">최근 실행</TabsTrigger>
        </TabsList>
        <TabsContent value="settings"><NodeSettingsTab {...tabProps} onOpenYaml={onOpenYaml} /></TabsContent>
        <TabsContent value="paths"><NodePathsTab {...tabProps} onClose={onClose} /></TabsContent>
        <TabsContent value="runs"><NodeRecentRuns workflowId={workflowId} nodeKey={nodeKey} enabled={tab === 'runs'} /></TabsContent>
      </Tabs>
    </DrawerShell>
  )
}
