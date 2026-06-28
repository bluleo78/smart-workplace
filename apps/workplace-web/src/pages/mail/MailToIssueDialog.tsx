// #520 메일→이슈 승격 모달. AI 초안으로 사전채움 → 사용자 수정 → 생성.
// 담당 드롭다운은 선택 프로젝트 멤버(사람+AGENT). 프로젝트 변경 시 멤버 재조회.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { IssueDraftFields, type IssueDraftValue } from '@/components/issue/IssueDraftFields'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { usePromoteToIssue } from '@/hooks/queries/useMailMessages'
import { useProjectMembers } from '@/hooks/queries/useProjectMembers'
import type { MailIssueDraft } from '@/types/mailMessage'

export function MailToIssueDialog({
  open, messageId, draft, mailSubject, onOpenChange, onCreated,
}: {
  open: boolean
  messageId: number
  draft: MailIssueDraft | null
  mailSubject: string
  onOpenChange: (v: boolean) => void
  onCreated: (issueKey: string) => void
}) {
  const promote = usePromoteToIssue()
  // 초기 프로젝트: AI 추천 → 없으면 첫 후보.
  const [value, setValue] = useState<IssueDraftValue>({
    title: '', body: '', priority: 'MID', projectKey: '', assigneeIds: [],
  })

  // 초안 도착 시 폼 사전채움.
  useEffect(() => {
    if (!draft) return
    const projectKey = draft.suggestedProjectKey ?? draft.candidateProjects[0]?.key ?? ''
    setValue({
      title: draft.title,
      body: draft.body,
      priority: draft.priority,
      projectKey,
      assigneeIds: [],
    })
  }, [draft])

  const members = useProjectMembers(value.projectKey)
  const memberOpts = (members.data ?? []).map((m) => ({ userId: m.userId, name: m.name, kind: m.kind }))

  const onSubmit = async () => {
    try {
      const { issueKey } = await promote.mutateAsync({
        messageId,
        payload: {
          projectKey: value.projectKey,
          title: value.title,
          body: value.body || undefined,
          priority: value.priority,
          assigneeIds: value.assigneeIds.length ? value.assigneeIds : undefined,
        },
      })
      toast.success(`이슈 ${issueKey} 를 만들었어요`)
      onCreated(issueKey)
      onOpenChange(false)
    } catch {
      // handleApiError 가 훅에서 토스트 처리.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mail-to-issue-dialog">
        <DialogHeader>
          <DialogTitle>이슈로 만들기 (AI 초안)</DialogTitle>
          <DialogDescription className="sr-only">메일을 이슈로 승격</DialogDescription>
        </DialogHeader>
        {draft ? (
          <IssueDraftFields
            value={value}
            onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
            candidateProjects={draft.candidateProjects}
            members={memberOpts}
            editable
          />
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">이슈 작성 중…</div>
        )}
        {/* 원본 메일 백레퍼런스 표시(읽기) */}
        <div className="text-xs text-muted-foreground">원본 메일: {mailSubject}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button
            data-testid="mail-to-issue-submit"
            disabled={!draft || !value.title || !value.projectKey || promote.isPending}
            onClick={onSubmit}
          >
            {promote.isPending ? '생성 중…' : '이슈 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
