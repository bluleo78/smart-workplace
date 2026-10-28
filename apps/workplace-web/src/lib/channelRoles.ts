// 채널 멤버 역할 선택지 — 멤버 패널의 역할 select 가 쓰는 순수 규칙(WP-412 에서 컴포넌트 밖으로 분리).
import type { ChannelMemberResponse, ChannelRole } from '@/types/messaging'

// 역할 옵션 목록 — select 에 노출할 순서.
const ROLES: ChannelRole[] = ['OWNER', 'ADMIN', 'MEMBER']

/**
 * 멤버에게 보일 역할 선택지.
 * AGENT(AI 봇)는 채널 OWNER 가 될 수 없다(사람 전용 권한, #598) — 옵션 자체를 빼서 시도를 UX 상에서 차단한다(서버도 409 로 거부).
 * 정지된 사람(active=false)에게도 소유권을 넘기지 않는다(WP-1131) — 로그인할 수 없는 사람이 소유자가 되면 역할을 바꾸거나
 * 소유권을 되돌려 줄 사람이 없어진다. 멤버 행을 통째로 받아 정지 여부를 빠뜨리고 부를 수 없게 한다.
 * 지금 역할은 걸러지더라도 늘 남긴다 — 없으면 네이티브 select 가 첫 옵션을 지금 역할처럼 보인다(예: 정지된 소유자).
 */
export function assignableChannelRoles(member: Pick<ChannelMemberResponse, 'kind' | 'active' | 'role'>): ChannelRole[] {
  const ownerAllowed = member.kind !== 'AGENT' && member.active !== false
  return ROLES.filter((r) => r === member.role || r !== 'OWNER' || ownerAllowed)
}

// 역할의 화면 이름 — 영어 코드 대신 한국어로 보인다(노트·드라이브 멤버 창의 「소유자·편집자·보기 전용」과 같은 결, WP-1131).
const ROLE_LABEL: Record<ChannelRole, string> = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '멤버' }

/** 채널 역할의 화면 이름. */
export function channelRoleLabel(role: ChannelRole): string {
  // 모르는 역할(새 역할·낡은 웹)은 빈칸 대신 코드를 그대로 보인다.
  return ROLE_LABEL[role] ?? role
}
