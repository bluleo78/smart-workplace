// 메시지 작성기 — RichInput(@멘션) 기반. Enter 전송·Shift+Enter 줄바꿈은 RichInput 이 처리.
// 아카이브 채널이면 입력기 미마운트 + 안내(보관 채널은 전송 불가).
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'

export function MessageComposer({
  members,
  onSend,
  disabled = false,
}: {
  // @멘션 후보 = 해당 채널/DM 의 구성원.
  members: MentionCandidate[]
  onSend: (body: string) => void
  disabled?: boolean
}) {
  // 보관된 채널은 입력기를 띄우지 않고 안내만 표시(전송 자체를 차단).
  if (disabled) {
    return (
      <div className="border-t p-3">
        <p className="text-sm text-muted-foreground">이 채널은 보관되었습니다</p>
      </div>
    )
  }

  return (
    <div className="border-t p-3" data-testid="message-composer">
      <RichInput
        members={members}
        onSubmit={onSend}
        clearOnSubmit
        placeholder="메시지를 입력하세요"
        submitLabel="보내기"
        inputTestId="message-composer-input"
        submitTestId="message-composer-submit"
      />
    </div>
  )
}
