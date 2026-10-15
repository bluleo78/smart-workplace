// 채널 멤버 역할 선택지 — 멤버 패널의 역할 select 가 쓰는 순수 규칙(WP-412 에서 컴포넌트 밖으로 분리).
import type { ChannelRole, UserKind } from '@/types/messaging'

// 역할 옵션 목록 — select 에 노출할 순서.
const ROLES: ChannelRole[] = ['OWNER', 'ADMIN', 'MEMBER']

/**
 * 멤버 종류별로 지정 가능한 역할 목록.
 * AGENT(AI 봇)는 채널 OWNER 가 될 수 없다(사람 전용 권한, #598) — 옵션 자체를 빼서 시도를 UX 상에서 차단한다(서버도 409 로 거부).
 */
export function assignableChannelRoles(kind: UserKind): ChannelRole[] {
  return kind === 'AGENT' ? ROLES.filter((r) => r !== 'OWNER') : ROLES
}
