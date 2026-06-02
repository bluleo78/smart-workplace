// 채널 멤버 패널 — T6 에서 구현. 현재는 컴파일용 스텁.
import type { ChannelRole } from '@/types/messaging'

export function ChannelMembersPanel({
  channelId,
  myRole,
  open,
  onOpenChange,
}: {
  channelId: number
  myRole: ChannelRole | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  void channelId
  void myRole
  void open
  void onOpenChange
  return null
}
