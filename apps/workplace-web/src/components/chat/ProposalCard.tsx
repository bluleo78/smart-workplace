// L3 위임 확인 카드 컴포넌트.
// AI 가 이슈 생성을 제안할 때 메시지 본문 대신 렌더되는 카드.
// - PENDING + 위임자(currentUserId === proposedByUserId): 프로젝트 드롭다운 + 승인/거부 버튼 활성.
// - PENDING + 비위임자: "확인 대기 중" 표시만.
// - CONFIRMED: 생성된 이슈 키 표시.
// - REJECTED: 거부됨 표시.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MessageProposal } from '@/types/messaging'

interface ProposalCardProps {
  proposal: MessageProposal
  /** 현재 로그인 사용자 id — 위임자 여부(승인/거부 권한) 판정에 사용. */
  currentUserId: number
  /** 승인 버튼 클릭 핸들러. projectKey 를 받아 확인 시 선택된 프로젝트 키 전달. */
  onConfirm: (projectKey?: string) => void
  /** 거부 버튼 클릭 핸들러. */
  onReject: () => void
  /** 뮤테이션 진행 중(버튼 비활성화용). */
  busy?: boolean
}

/**
 * 채팅 L3 위임 확인 카드. AI 가 올린 이슈 생성 제안.
 * 위임자(currentUserId === proposedByUserId)이고 PENDING 일 때만 프로젝트 드롭다운 + 승인/거부 버튼 활성,
 * 그 외엔 상태 표시(대기/생성됨/거부됨).
 */
export function ProposalCard({
  proposal,
  currentUserId,
  onConfirm,
  onReject,
  busy,
}: ProposalCardProps) {
  // 위임자 여부 — 이 사람만 승인/거부 가능.
  const isDelegator = currentUserId === proposal.proposedByUserId
  const isPending = proposal.status === 'PENDING'

  // 위임자 PENDING 상태에서 선택된 프로젝트 키 — 초기값은 proposal.projectKey 또는 첫 후보.
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | undefined>(
    proposal.projectKey ?? proposal.candidates[0]?.key,
  )

  return (
    <div
      data-testid={`proposal-card-${proposal.id}`}
      className="rounded-md border bg-card p-3 text-sm"
    >
      {/* 카드 헤더 */}
      <div className="mb-1 font-medium text-foreground">💡 AI가 이슈 생성을 제안했어요</div>

      {/* 이슈 제목 */}
      {proposal.title && (
        <div className="text-foreground">{proposal.title}</div>
      )}

      {/* 메타 정보(프로젝트·우선순위·담당 AI 배지) */}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {/* 위임자 + PENDING: 프로젝트 드롭다운(후보 변경 가능). 그 외: 정적 텍스트. */}
        {isPending && isDelegator ? (
          proposal.candidates.length > 0 ? (
            <Select value={selectedProjectKey} onValueChange={setSelectedProjectKey}>
              <SelectTrigger
                data-testid={`proposal-project-${proposal.id}`}
                className="h-7 w-auto text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {proposal.candidates.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            proposal.projectName && <span>프로젝트: {proposal.projectName}</span>
          )
        ) : (
          proposal.projectName && <span>프로젝트: {proposal.projectName}</span>
        )}
        {proposal.priority && <span>우선순위: {proposal.priority}</span>}
        <span className="rounded bg-primary/15 px-1 font-medium text-primary">담당: AI 🤖</span>
      </div>

      {/* PENDING + 위임자: 승인/거부 버튼 */}
      {isPending && isDelegator && (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            data-testid={`proposal-confirm-${proposal.id}`}
            disabled={busy}
            onClick={() => onConfirm(selectedProjectKey)}
          >
            승인
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid={`proposal-reject-${proposal.id}`}
            disabled={busy}
            onClick={onReject}
          >
            거부
          </Button>
        </div>
      )}

      {/* PENDING + 비위임자: 대기 표시 */}
      {isPending && !isDelegator && (
        <div
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`proposal-pending-${proposal.id}`}
        >
          확인 대기 중
        </div>
      )}

      {/* CONFIRMED: 생성된 이슈 키 */}
      {proposal.status === 'CONFIRMED' && (
        <div
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`proposal-confirmed-${proposal.id}`}
        >
          ✅ 생성됨 {proposal.resultIssueKey}
        </div>
      )}

      {/* REJECTED: 거부됨 표시 */}
      {proposal.status === 'REJECTED' && (
        <div
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`proposal-rejected-${proposal.id}`}
        >
          거부됨
        </div>
      )}
    </div>
  )
}
