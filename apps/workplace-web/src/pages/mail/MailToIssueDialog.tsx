// #520 메일→이슈 승격 모달. AI 초안으로 사전채움 → 사용자 수정 → 생성.
// 담당 드롭다운은 선택 프로젝트 멤버(사람+AGENT). 프로젝트 변경 시 멤버 재조회.
// 보고자(WP-954) — 「나」/「보낸 사람」. 기본은 보낸 사람이 그 프로젝트 멤버이거나 OPEN 이면 보낸 사람, 아니면 나. 프로젝트를 바꾸면 그 프로젝트의 기본으로 다시 맞춘다.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { IssueDraftFields, type IssueDraftValue } from '@/components/issue/IssueDraftFields'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { usePromoteToIssue } from '@/hooks/queries/useMailMessages'
import { useProjectMembers } from '@/hooks/queries/useProjectMembers'
import { type MailIssueReporter,mailReporterChoice } from '@/lib/mailIssueReporter'
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

  // 보고자 — 사용자가 고른 값은 그 프로젝트에서만 유지하고, 프로젝트를 바꾸면 그 프로젝트의 기본값으로 돌아간다(상태를 effect 로 맞추지 않고 파생한다).
  const reporterChoice = mailReporterChoice(draft, value.projectKey)
  const [picked, setPicked] = useState<{ projectKey: string; reporter: MailIssueReporter } | null>(null)
  const reporter: MailIssueReporter =
    picked && picked.projectKey === value.projectKey && (picked.reporter === 'ME' || reporterChoice.senderSelectable)
      ? picked.reporter
      : reporterChoice.defaultReporter

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
          // 보낸 사람을 고른 경우만 싣는다 — 생략은 나(구버전 서버와도 같은 뜻).
          ...(reporter === 'SENDER' ? { reporter: 'SENDER' as const } : {}),
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
        {draft && reporterChoice.visible && (
          <div className="space-y-1.5" data-testid="mail-to-issue-reporter">
            <Label className="text-xs font-medium text-muted-foreground">보고자</Label>
            <RadioGroup
              value={reporter}
              onValueChange={(v) => setPicked({ projectKey: value.projectKey, reporter: v as MailIssueReporter })}
              className="flex flex-wrap gap-2"
              aria-describedby={reporterChoice.reason ? 'mail-to-issue-reporter-reason' : undefined}
            >
              <Label
                htmlFor="mail-to-issue-reporter-me"
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id="mail-to-issue-reporter-me" value="ME" data-testid="mail-to-issue-reporter-me" />
                나
              </Label>
              <Label
                htmlFor="mail-to-issue-reporter-sender"
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal has-[[data-state=checked]]:border-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <RadioGroupItem
                  id="mail-to-issue-reporter-sender"
                  value="SENDER"
                  disabled={!reporterChoice.senderSelectable}
                  data-testid="mail-to-issue-reporter-sender"
                />
                {/* 구성원이면 구성원 이름, 아니면 주소 — 긴 주소는 말줄임 */}
                <span className="min-w-0 truncate">
                  보낸 사람 ({draft.sender?.name ?? draft.sender?.address ?? '알 수 없음'})
                </span>
              </Label>
            </RadioGroup>
            {reporterChoice.reason && (
              <p id="mail-to-issue-reporter-reason" className="text-xs text-muted-foreground" data-testid="mail-to-issue-reporter-reason">
                {reporterChoice.reason}
              </p>
            )}
          </div>
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
