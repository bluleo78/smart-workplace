// 인라인 "새 메시지" compose — 모달 대신 대화 영역 전체를 차지(Slack 패턴).
// 상단 "받는 사람:" 칩 + 검색 팝오버(본인 제외), 하단 MessageComposer.
// 첫 전송 시 find-or-create DM → 그 DM 으로 메시지 전송 → /chat/dms/{id} 이동.
import { X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { messagingApi } from '@/api/messaging'
import { MessageComposer } from '@/components/chat/MessageComposer'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { AgentBadge } from '@/components/users/AgentBadge'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { useAuth } from '@/hooks/useAuth'
import { handleApiError } from '@/lib/api-error'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { UserResponse } from '@/types/auth'

// 본인 포함 최대 8명 → 타겟 최대 7명.
const MAX_TARGETS = 7

export default function NewMessagePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id ?? 0
  const createDm = useCreateDm()
  const [selected, setSelected] = useState<UserResponse[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const selectedIds = new Set(selected.map((u) => u.id))
  // @멘션 후보 — 선택된 수신자들을 채널 멤버로 전달
  const members: MentionCandidate[] = selected.map((u) => ({
    userId: u.id,
    username: u.username,
    name: u.name,
    kind: u.kind,
  }))

  const addRecipient = (u: UserResponse) => {
    if (selectedIds.has(u.id) || selected.length >= MAX_TARGETS) return
    setSelected((prev) => [...prev, u])
  }
  const removeRecipient = (id: number) => setSelected((prev) => prev.filter((u) => u.id !== id))

  // 첫 전송: DM find-or-create → 메시지 전송 → DM 페이지로 이동
  const handleSend = async (body: string, fileIds: number[]) => {
    if (selected.length === 0 || sending) return
    setSending(true)
    // DM find-or-create — 실패 시 useCreateDm.onError 가 토스트하므로 여기선 조용히 중단.
    let dm
    try {
      dm = await createDm.mutateAsync(selected.map((u) => u.id))
    } catch {
      setSending(false)
      return
    }
    // 첫 메시지 전송 — 이 호출은 hook-level onError 가 없으므로 여기서 처리.
    try {
      await messagingApi.createMessage(dm.id, { body, fileIds: fileIds.length ? fileIds : undefined })
      navigate(`/chat/dms/${dm.id}`)
    } catch (err) {
      handleApiError(err, '메시지를 보낼 수 없습니다')
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="new-message-page">
      <header className="border-b px-4 py-2">
        <div className="text-sm font-semibold">새 메시지</div>
        <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="new-message-recipients">
          <span className="text-xs text-muted-foreground">받는 사람:</span>
          {selected.map((u) => (
            <span
              key={u.id}
              data-testid={`recipient-chip-${u.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-sm"
            >
              {u.name}
              {/* AGENT 수신자면 보라색 봇 배지 표시 */}
              {u.kind === 'AGENT' && <AgentBadge size="xs" />}
              {/* hover 피드백 + 클릭 영역 확보 (p-0.5 → 최소 16×16px, rounded-full + transition) */}
              <button
                type="button"
                aria-label={`${u.name} 제거`}
                onClick={() => removeRecipient(u.id)}
                className="rounded-full p-0.5 hover:bg-accent-foreground/10 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <MemberSearchPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            existingMemberIds={selectedIds}
            excludeUserIds={new Set([myId])}
            onSelect={addRecipient}
            trigger={
              <Button
                size="sm"
                variant="ghost"
                data-testid="new-message-add-recipient"
                disabled={selected.length >= MAX_TARGETS}
              >
                추가
              </Button>
            }
          />
        </div>
      </header>

      {/* 수신자 없으면 안내 문구, 있으면 첫 메시지 작성 안내 */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        {selected.length === 0
          ? '받는 사람을 추가하면 대화를 시작할 수 있어요.'
          : '첫 메시지를 입력해 대화를 시작하세요.'}
      </div>

      {/* channelId=0: 첨부 사전 업로드는 /chat/new 스코프 밖(Phase B). 텍스트 전송엔 안전. */}
      <MessageComposer
        channelId={0}
        members={members}
        disabled={selected.length === 0 || sending}
        onSend={handleSend}
      />
    </div>
  )
}
