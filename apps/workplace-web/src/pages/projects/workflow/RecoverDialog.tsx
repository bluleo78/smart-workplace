// 멈춘(조치 필요) 워크플로우 실행의 조치 창(WP-1991) — 실행 상세와 이슈 카드가 함께 쓴다.
// 왜: 기계가 저절로 옮기지 않는다. 다시 시도·오류 경로·옮기기·취소 중 무엇을 할지 사람이 고르고, 남길 말과 함께 한 번 확인한다.
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { extractApiErrorCode } from '@/lib/api-error'
import { type RecoverAction, useRecoverIssueWorkflow, workflowErrorMessage } from '@/lib/workflow'
import type { WorkflowModel, WorkflowModelNode } from '@/lib/workflows'

import { workflowSelectClass } from './WorkflowVersions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueId: number
  projectKey: string
  /** 창을 열 때의 run.revision — 호출자가 고정해 넘긴다(창이 열린 동안 쿼리가 새로 고쳐져도 이 값으로 보낸다). */
  revision: number
  /** 지금 멈춘 노드 — onError 유무와 옮기기 후보 제외에 쓴다. 버전 모델을 못 읽었으면 undefined(오류 경로 숨김). */
  currentNode: WorkflowModelNode | undefined
  /** 게시 버전 모델 — 못 읽었으면 undefined. 그때는 다시 시도·실행 취소만 가능하고 옮기기 자리에 안내가 보인다. */
  model: WorkflowModel | undefined
  /** 프로젝트 관리 권한 — 「다른 노드로 옮기기」는 관리자만. */
  canManage: boolean
  /** 조치 성공 또는 낡은 화면(STALE) — 호출자가 상세·목록을 새로 읽는다. */
  onDone: () => void
}

/** 조치 창 — 닫히면 안의 입력(고른 조치·남길 말)이 함께 사라지도록 본문을 따로 둔다. */
export function RecoverDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>조치 고르기</DialogTitle>
        </DialogHeader>
        <RecoverBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RecoverBody({
  issueId, projectKey, revision, currentNode, model, canManage, onDone, onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const recover = useRecoverIssueWorkflow(issueId, projectKey)
  // 모델·지금 노드를 모르면 오류 경로의 대상 노드를 알 수 없어 그 경로는 내놓지 않는다.
  const onError = model && currentNode ? currentNode.onError : undefined
  const onErrorTarget = onError ? model?.nodes.find((n) => n.key === onError.to) : undefined
  // 옮길 후보 — 지금 노드와 시작 노드는 뺀다.
  const moveCandidates = (model?.nodes ?? []).filter((n) => n.key !== currentNode?.key && n.type !== 'start')
  // 기본 선택: 오류 경로가 있으면 그것, 없으면 다시 시도(고르는 것은 늘 사람 — 단추를 눌러야 실행된다).
  const [action, setAction] = useState<RecoverAction>(onError ? 'ON_ERROR' : 'RETRY')
  const [toNode, setToNode] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    try {
      await recover.mutateAsync({
        action,
        ...(action === 'MOVE_TO' ? { toNode } : {}),
        ...(comment.trim() !== '' ? { comment: comment.trim() } : {}),
        expectedRevision: revision,
      })
      toast.success('조치했어요.')
      onDone()
      onClose()
    } catch (e) {
      const message = workflowErrorMessage(e, '조치를 하지 못했습니다.')
      if (extractApiErrorCode(e) === 'WORKFLOW_STALE') {
        // 낡은 화면(STALE) — 창을 연 순간의 revision 이 고정돼 있어 열어 둬도 계속 STALE 이다. 이유를 토스트로 알리고
        // 호출자가 새로 읽게 한 뒤 창을 닫는다. 다시 열면 새 revision 으로 고정된다.
        toast.error(message)
        onDone()
        onClose()
        return
      }
      // 그 밖의 실패는 창을 열어 둔 채 안에 이유를 보인다(남길 말을 지키고 다시 누를 수 있게).
      setError(message)
    }
  }

  const item = (value: RecoverAction, label: string) => (
    <label key={value} className="flex cursor-pointer items-center gap-2">
      <RadioGroupItem value={value} aria-label={label} />
      {label}
    </label>
  )

  return (
    <>
      <div className="space-y-3 text-sm">
        <RadioGroup aria-label="조치" value={action} onValueChange={(v) => setAction(v as RecoverAction)} className="space-y-1">
          {item('RETRY', '다시 시도')}
          {onError && item('ON_ERROR', `오류 경로로 보내기 → ${onErrorTarget?.name ?? onError.to}`)}
          {canManage && model && item('MOVE_TO', '다른 노드로 옮기기')}
          {item('CANCEL', '실행 취소')}
        </RadioGroup>
        {canManage && !model && <p className="text-sm text-muted-foreground">단계 목록을 불러오지 못했어요</p>}
        {canManage && model && action === 'MOVE_TO' && (
          <select aria-label="옮길 노드" className={workflowSelectClass} value={toNode} onChange={(e) => setToNode(e.target.value)}>
            <option value="">노드 고르기</option>
            {moveCandidates.map((n) => <option key={n.key} value={n.key}>{n.name ?? n.key}</option>)}
          </select>
        )}
        <Textarea aria-label="남길 말(선택)" placeholder="남길 말(선택)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>취소</Button>
        <Button type="button" disabled={recover.isPending || (action === 'MOVE_TO' && toNode === '')} onClick={() => void submit()}>
          확인
        </Button>
      </DialogFooter>
    </>
  )
}
