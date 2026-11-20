import { canManageChannel } from '@/lib/channelRoles'
import type { ChannelRole } from '@/types/messaging'

/**
 * 채팅 빈 상태(메시지가 없는 채널·DM)에서 보여 줄 다음 행동.
 * - 'invite': 멤버 초대 유도 (채널 관리자)
 * - 'compose': 첫 메시지 작성 유도
 * - null: 행동 버튼을 보이지 않음
 */
export type ChatEmptyAction = 'invite' | 'compose' | null

/**
 * 채널 빈 상태의 다음 행동을 정한다.
 * - 보관된 채널은 글을 올릴 수 없으므로 행동이 없다.
 * - 비멤버(role null)는 열람만 가능하므로 행동이 없다.
 * - OWNER·ADMIN 은 사람을 초대해 대화를 시작하는 것이 자연스러워 'invite' 를 준다.
 * - MEMBER 는 초대 권한이 없으므로 첫 메시지 작성을 준다.
 */
export function channelEmptyAction(channel: { archived: boolean; role: ChannelRole | null }): ChatEmptyAction {
  // 보관 채널은 쓰기가 막혀 있다
  if (channel.archived) return null
  // 멤버가 아니면 열람만 가능하다
  if (channel.role === null) return null
  // 관리자 권한이면 초대로 대화를 연다
  if (canManageChannel(channel.role)) return 'invite'
  return 'compose'
}

/**
 * DM 빈 상태의 다음 행동을 정한다.
 * 상대가 정지되지 않아 메시지를 보낼 수 있으면 첫 메시지 작성을 준다.
 * 상대가 정지된 경우에는 보낼 수 없으므로 행동이 없다.
 */
export function dmEmptyAction(dm: { blocked: boolean }): ChatEmptyAction {
  // 받는 사람이 모두 정지면 전송할 수 없다
  if (dm.blocked) return null
  return 'compose'
}
