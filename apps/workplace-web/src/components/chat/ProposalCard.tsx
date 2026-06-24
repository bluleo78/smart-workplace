// L3 위임 확인 카드 컴포넌트.
// actionType 으로 분기 — 이슈: 프로젝트 드롭다운 카드, 일정: EventProposalCard 위임.
// - PENDING + 위임자(currentUserId === proposedByUserId): 편집 폼 + 승인/거부 버튼 활성.
// - PENDING + 비위임자: "확인 대기 중" 표시만.
// - CONFIRMED: 생성된 이슈 키 / 일정 보기 링크 표시.
// - REJECTED: 거부됨 표시.

import { Bot, CircleCheck } from 'lucide-react'
import { useState } from 'react'

import { AiContent } from '@/components/ai/AiContent'
import { EventProposalCard } from '@/components/chat/EventProposalCard'
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
  /**
   * 승인 버튼 클릭 핸들러.
   * - 이슈: projectKey(string | undefined) 전달.
   * - 일정: 편집 override 객체({ title?, startsAt?, endsAt?, location? }) 전달.
   */
  onConfirm: (
    arg?: string | { title?: string; startsAt?: string; endsAt?: string; location?: string },
  ) => void
  /** 거부 버튼 클릭 핸들러. */
  onReject: () => void
  /** 뮤테이션 진행 중(버튼 비활성화용). */
  busy?: boolean
}

/**
 * 채팅 L3 위임 확인 카드. actionType 으로 분기해 이슈/일정 전용 카드를 렌더한다.
 * - calendar.create_event → EventProposalCard (편집 폼 + 충돌 배지)
 * - 그 외(CREATE_ISSUE) → 기존 프로젝트 드롭다운 카드
 */
export function ProposalCard(props: ProposalCardProps) {
  const { proposal, currentUserId, onConfirm, onReject, busy } = props

  // 위임자 PENDING 상태에서 선택된 프로젝트 키 — 초기값은 proposal.projectKey 또는 첫 후보.
  // Hook 은 조건부 return 전에 선언해야 한다(Rules of Hooks).
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | undefined>(
    proposal.projectKey ?? proposal.candidates[0]?.key,
  )

  // 일정 제안은 전용 편집 카드로 위임.
  if (proposal.actionType === 'calendar.create_event') {
    return (
      <EventProposalCard
        proposal={proposal}
        currentUserId={currentUserId}
        onConfirm={(overrides) => onConfirm(overrides)}
        onReject={onReject}
        busy={busy}
      />
    )
  }

  // 위임자 여부 — 이 사람만 승인/거부 가능.
  const isDelegator = currentUserId === proposal.proposedByUserId
  const isPending = proposal.status === 'PENDING'

  return (
    <div
      data-testid={`proposal-card-${proposal.id}`}
      className="rounded-md border bg-card p-3 text-sm"
    >
      {/* 카드 헤더 + 이슈 제목: AI 제안 생성물 — AiContent 아우라로 감쌈. 💡 장식 이모지 제거. */}
      <AiContent label="AI 제안">
        <div className="font-medium text-foreground">AI가 이슈 생성을 제안했어요</div>
        {proposal.title && (
          <div className="mt-1 text-foreground">{proposal.title}</div>
        )}
      </AiContent>

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
        {/* 담당: AI 배지 — primary 토큰에서 ai-accent 시맨틱 토큰으로 통일, 🤖 → Bot 아이콘. */}
        <span className="inline-flex items-center gap-0.5 rounded bg-ai-accent-subtle px-1 font-medium text-ai-accent">
          담당: AI <Bot className="h-3 w-3" aria-label="에이전트" />
        </span>
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
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"
          data-testid={`proposal-confirmed-${proposal.id}`}
        >
          {/* 장식 이모지(✅) 대신 lucide CircleCheck 사용(디자인 시스템 아이콘 단일 소스) */}
          <CircleCheck className="h-3.5 w-3.5 text-ai-accent" />
          생성됨 {proposal.resultIssueKey}
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
