// 채팅 일정 생성 확인 카드(편집 가능). AI 가 대화에서 추출한 일정 제안.
// 위임자(currentUserId === proposedByUserId) + PENDING 일 때만 제목·시간·장소 편집 + 승인/거부.
// 충돌이 있으면 AiSignalBadge(action)로 "충돌 N건" 경고. 참석자 편집은 이번 슬라이스 범위 밖.

import { CalendarPlus, CircleCheck } from 'lucide-react'
import { useState } from 'react'

import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { MessageProposal } from '@/types/messaging'

interface EventProposalCardProps {
  proposal: MessageProposal
  currentUserId: number
  /** 편집된 override(미수정 필드는 생략) 를 받아 승인. */
  onConfirm: (overrides: {
    title?: string
    startsAt?: string
    endsAt?: string
    location?: string
  }) => void
  onReject: () => void
  busy?: boolean
}

// datetime-local 입력은 'YYYY-MM-DDTHH:mm'(초·오프셋 없음). 서버가 준 ISO 문자열 ↔ datetime-local 변환.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  // 'YYYY-MM-DDTHH:mm' 까지만 사용(앞 16자).
  return iso.slice(0, 16)
}

// ⚠️ datetime-local 값(오프셋 없음)을 서버 OffsetDateTime 으로 보내려면 오프셋이 있는 ISO 로 변환해야 한다.
// 오프셋 없는 'YYYY-MM-DDTHH:mm' 를 그대로 보내면 백엔드 OffsetDateTime.parse 가 실패한다(라이브에서만 터지는 버그).
// new Date(local) 은 datetime-local 을 브라우저 로컬 시각으로 해석 → toISOString() 은 UTC 오프셋(Z) 포함 ISO 반환.
function toOffsetIso(local: string): string | undefined {
  if (!local) return undefined
  return new Date(local).toISOString()
}

export function EventProposalCard({
  proposal,
  currentUserId,
  onConfirm,
  onReject,
  busy,
}: EventProposalCardProps) {
  const isDelegator = currentUserId === proposal.proposedByUserId
  const isPending = proposal.status === 'PENDING'

  const [title, setTitle] = useState(proposal.title ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInput(proposal.startsAt))
  const [endsAt, setEndsAt] = useState(toLocalInput(proposal.endsAt))
  const [location, setLocation] = useState(proposal.location ?? '')

  const conflictCount = proposal.conflicts?.length ?? 0

  return (
    <div
      data-testid={`event-proposal-card-${proposal.id}`}
      className="rounded-md border bg-card p-3 text-sm"
    >
      <AiContent label="AI 제안">
        <div className="flex items-center gap-1 font-medium text-foreground">
          <CalendarPlus className="h-4 w-4 text-ai-accent" aria-hidden />
          AI가 일정 생성을 제안했어요
        </div>
      </AiContent>

      {/* 충돌 경고 — 결정적 계산 결과(서버) 노출. */}
      {conflictCount > 0 && (
        <div className="mt-2" data-testid={`event-proposal-conflicts-${proposal.id}`}>
          <AiSignalBadge variant="action">충돌 {conflictCount}건</AiSignalBadge>
          <ul className="mt-1 text-xs text-muted-foreground">
            {proposal.conflicts!.map((c) => (
              <li key={c.id}>· {c.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3-way: PENDING+위임자=편집 폼 / PENDING+비위임자=읽기+대기표시 / 확정or거부=읽기 */}
      {isPending && isDelegator ? (
        // 위임자만 제목·시간·장소 편집 + 승인/거부 버튼
        <div className="mt-2 space-y-2">
          <Input
            data-testid={`event-proposal-title-${proposal.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
          />
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              data-testid={`event-proposal-starts-${proposal.id}`}
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <Input
              type="datetime-local"
              data-testid={`event-proposal-ends-${proposal.id}`}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <Input
            data-testid={`event-proposal-location-${proposal.id}`}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="장소(선택)"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid={`event-proposal-confirm-${proposal.id}`}
              disabled={busy}
              onClick={() =>
                onConfirm({
                  title,
                  // datetime-local → 오프셋 포함 ISO 로 변환해 전달(서버 OffsetDateTime 파싱 가능).
                  startsAt: toOffsetIso(startsAt),
                  endsAt: toOffsetIso(endsAt),
                  location: location || undefined,
                })
              }
            >
              승인
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid={`event-proposal-reject-${proposal.id}`}
              disabled={busy}
              onClick={onReject}
            >
              거부
            </Button>
          </div>
        </div>
      ) : isPending ? (
        // 비위임자: 제안 내용(읽기) + "확인 대기 중" 한 블록으로 통합
        <div
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`event-proposal-pending-${proposal.id}`}
        >
          <div>{proposal.title}</div>
          {proposal.startsAt && (
            <div>
              {proposal.startsAt.slice(0, 16).replace('T', ' ')}
              {proposal.endsAt ? ` ~ ${proposal.endsAt.slice(11, 16)}` : ''}
            </div>
          )}
          {proposal.location && <div>장소: {proposal.location}</div>}
          <div className="mt-1 font-medium">확인 대기 중</div>
        </div>
      ) : (
        // CONFIRMED / REJECTED: 읽기 전용 요약
        <div className="mt-2 text-xs text-muted-foreground">
          <div>{proposal.title}</div>
          {proposal.startsAt && (
            <div>
              {proposal.startsAt.slice(0, 16).replace('T', ' ')}
              {proposal.endsAt ? ` ~ ${proposal.endsAt.slice(11, 16)}` : ''}
            </div>
          )}
          {proposal.location && <div>장소: {proposal.location}</div>}
        </div>
      )}

      {/* CONFIRMED: 일정 보기 링크(result_issue_key="event:{id}"). */}
      {proposal.status === 'CONFIRMED' && proposal.resultIssueKey?.startsWith('event:') && (
        <div
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"
          data-testid={`event-proposal-confirmed-${proposal.id}`}
        >
          <CircleCheck className="h-3.5 w-3.5 text-ai-accent" />
          <a
            className="underline"
            href={`/calendar?event=${proposal.resultIssueKey.slice('event:'.length)}`}
          >
            일정 보기
          </a>
        </div>
      )}

      {proposal.status === 'REJECTED' && (
        <div
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`event-proposal-rejected-${proposal.id}`}
        >
          거부됨
        </div>
      )}
    </div>
  )
}
