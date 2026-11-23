// 워크플로우 시작 창(WP-1989) — 켜진 워크플로우를 고르면 시작 단계를 미리 계산해(dryRun) 보여 주고, 맞는 시작 조건이 없으면 시작을 막는다.
// 담당자(읽기 전용)의 역할로 시작 노드가 정해지므로, 시작 전에 「누구에게 알림이 가는지」를 확인하게 하는 것이 목적이다.
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { issueWorkflowKeys } from '@/hooks/queries/issueWorkflowKeys'
import { startableWorkflows, useIssueWorkflowPreview, useStartIssueWorkflow, workflowErrorMessage } from '@/lib/workflow'
import { useProjectWorkflows } from '@/lib/workflows'

import { UserNames } from './IssueWorkflowCard'
import { WorkflowRadioList } from './WorkflowRadioList'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueId: number
  projectKey: string
  projectId: number
  issueTitle: string
  assignees: { id: number; name: string; kind: 'HUMAN' | 'AGENT' }[]
}

export function StartWorkflowDialog({ open, onOpenChange, issueId, projectKey, projectId, issueTitle, assignees }: Props) {
  const list = useProjectWorkflows(projectId)
  const workflows = startableWorkflows(list.data)
  const [picked, setPicked] = useState<number | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const start = useStartIssueWorkflow(issueId, projectKey)
  const qc = useQueryClient()

  // 열릴 때 첫 워크플로우를 고른다 — 목록이 아직 없으면 도착한 뒤.
  const effective = picked ?? workflows[0]?.id ?? null
  // 시작 단계 미리보기 — 창이 열려 있고 고른 것이 있을 때만 묻는다. 선택을 바꾸면 그 선택의 결과가 올 때까지 로딩이다.
  const preview = useIssueWorkflowPreview(issueId, effective, open)
  const node = preview.data?.currentNode

  function handleOpenChange(next: boolean) {
    if (!next) {
      // 미리보기 캐시를 지운다 — 담당을 바꾼 뒤 다시 열었을 때 옛 시작 노드로 시작이 눌리지 않게(WP-1989).
      qc.removeQueries({ queryKey: issueWorkflowKeys.preview(issueId) })
      setPicked(null)
      setStartError(null)
    }
    onOpenChange(next)
  }

  async function submit() {
    if (effective == null) return
    setStartError(null)
    try {
      await start.mutateAsync({ workflowId: effective })
      handleOpenChange(false)
    } catch (e) {
      setStartError(workflowErrorMessage(e, '워크플로우를 시작하지 못했어요.'))
    }
  }

  const loading = effective != null && preview.isPending
  // 다시 읽는 중(isFetching)에는 시작을 막는다 — 남아 있던 옛 응답으로 시작하지 않게.
  const canStart = preview.isSuccess && !preview.isFetching && !start.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>워크플로우 시작</DialogTitle>
          <DialogDescription>{issueTitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <WorkflowRadioList workflows={workflows} value={effective} onValueChange={setPicked} />
          {/* 목록 조회 실패는 「없음」과 다르게 알린다 — 오류를 빈 목록으로 보이지 않게. */}
          {list.isError && <p role="alert" className="text-destructive">워크플로우 목록을 불러오지 못했어요.</p>}
          {!list.isPending && !list.isError && workflows.length === 0 && <p className="text-muted-foreground">시작할 수 있는 워크플로우가 없어요.</p>}
          {list.isPending && <p className="text-muted-foreground">워크플로우를 불러오는 중…</p>}
          <div className="text-xs text-muted-foreground">
            담당: {assignees.length === 0 ? '없음' : <UserNames users={assignees} />}
          </div>
          {loading && <p className="text-muted-foreground">시작 단계를 확인하는 중…</p>}
          {preview.isSuccess && (
            <div>
              <p>{`${node?.name ?? node?.key ?? ''} 에서 시작해요`}</p>
              {node && node.assignees.length > 0 && (
                <p className="text-xs text-muted-foreground">{`${node.assignees.map((u) => u.name).join(', ')} 에게 바로 알림이 가요.`}</p>
              )}
            </div>
          )}
          {preview.isError && (
            <p role="alert" className="text-destructive">
              {workflowErrorMessage(preview.error, '시작 단계를 확인하지 못했어요.')}
            </p>
          )}
          {startError && <p role="alert" className="text-destructive">{startError}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>취소</Button>
          <Button type="button" disabled={!canStart} onClick={submit}>시작</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
