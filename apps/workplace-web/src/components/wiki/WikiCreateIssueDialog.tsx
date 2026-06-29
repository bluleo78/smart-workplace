// 위키 노트→이슈 생성 다이얼로그. 공용 IssueDraftFields(editable) + POST /api/v1/actions/confirm.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { confirmAction } from '@/api/actions'
import { IssueDraftFields, type IssueDraftValue } from '@/components/issue/IssueDraftFields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useProjects } from '@/hooks/queries/useProjects'

export interface CreatedIssue {
  id: number
  projectKey: string
  number: number
  title: string
}

// 내부 폼 — open=true 일 때만 마운트되므로 useState 초기값이 매번 fresh 하게 적용된다.
// effect 내 setState 없이 깔끔하게 초기화할 수 있다.
function WikiCreateIssueForm({
  initialTitle,
  initialBody,
  initialProjectKey,
  candidateProjects,
  onCreated,
  onClose,
}: {
  initialTitle: string
  initialBody: string
  initialProjectKey: string
  candidateProjects: { key: string; name: string }[]
  onCreated: (issue: CreatedIssue) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<IssueDraftValue>({
    title: initialTitle,
    body: initialBody,
    priority: 'MID',
    projectKey: initialProjectKey,
    assigneeIds: [],
  })
  const [busy, setBusy] = useState(false)

  const onChange = (patch: Partial<IssueDraftValue>) => {
    setDraft((s) => ({ ...s, ...patch }))
  }

  const onConfirm = async () => {
    if (!draft.projectKey || !draft.title.trim()) return
    setBusy(true)
    try {
      const issue = await confirmAction<CreatedIssue>({
        actionType: 'issue.create',
        params: {
          projectKey: draft.projectKey,
          title: draft.title.trim(),
          body: draft.body,
          priority: draft.priority,
        },
      })
      onCreated(issue)
      onClose()
    } catch {
      toast.error('이슈 생성에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <IssueDraftFields
        editable
        value={draft}
        onChange={onChange}
        candidateProjects={candidateProjects}
        members={[]}
        showAssignee={false}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button data-testid="wiki-create-issue-confirm" onClick={onConfirm} disabled={busy}>
          이슈 생성
        </Button>
      </DialogFooter>
    </>
  )
}

/** 노트 선택 블록 → 이슈 생성 확인 다이얼로그.
 *  확인 시 POST /api/v1/actions/confirm(issue.create) → 생성된 이슈를 onCreated 로 넘긴다. */
export function WikiCreateIssueDialog({
  open,
  initialTitle,
  initialBody,
  onCreated,
  onClose,
}: {
  open: boolean
  initialTitle: string
  initialBody: string
  onCreated: (issue: CreatedIssue) => void
  onClose: () => void
}) {
  const { data: projectsPage } = useProjects()
  // projectsPage?.content ?? [] 를 useMemo 로 안정화해 아래 useMemo 의 deps 에 안전하게 쓴다.
  const projects = useMemo(() => projectsPage?.content ?? [], [projectsPage])

  // candidateProjects: IssueDraftFields 가 요구하는 형태로 변환.
  const candidateProjects = useMemo(
    () => projects.map((p) => ({ key: p.key, name: p.name })),
    [projects],
  )

  // 기본 프로젝트 = 서버 자동 생성 개인(PERSONAL+isDefault), 없으면 첫 항목.
  const defaultProjectKey = useMemo(() => {
    const personal = projects.find((p) => p.type === 'PERSONAL' && p.isDefault)
    return personal?.key ?? projects[0]?.key ?? ''
  }, [projects])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="wiki-create-issue-dialog">
        <DialogHeader>
          <DialogTitle>이슈로 만들기</DialogTitle>
        </DialogHeader>
        {/* open 시에만 마운트 → useState 초기값이 매번 선택 텍스트·프로젝트로 fresh 하게 적용됨. */}
        {open && (
          <WikiCreateIssueForm
            initialTitle={initialTitle}
            initialBody={initialBody}
            initialProjectKey={defaultProjectKey}
            candidateProjects={candidateProjects}
            onCreated={onCreated}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
