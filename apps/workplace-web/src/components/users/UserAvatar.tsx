// 사용자 이니셜 아바타 — 이름/유저명에서 첫 글자 1자를 뽑아 배경색으로 식별.
// 색은 사람 색 토큰(bg-presence + presenceStyle, WP-318) — userId 기반 결정적 매핑이라
// 같은 사용자는 chat/user 아바타·노트 접속자 어디서나 같은 색이 나온다.

import { Bot } from 'lucide-react';

import { avatarInitials } from '@/lib/avatarColor';
import { presenceStyle } from '@/lib/collab/presence';
import { isInactiveUser, withInactiveSuffix } from '@/lib/userStatus';

import type { UserSummary } from '../../types/user';

// kind 정보 없이도 호출 가능하도록 식별/표기 필드만 요구하는 좁은 타입.
type AvatarUser = Pick<UserSummary, 'id' | 'username' | 'name'>;

// 사이즈별 Tailwind 클래스 묶음.
const SIZE_CLASS: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'h-5 w-5 text-xs',
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-9 w-9 text-sm',
};

export function UserAvatar({
  user,
  size = 'sm',
  ring = false,
  agent = false,
  inactive = false,
  title,
}: {
  user: AvatarUser;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  // 보드 카드처럼 겹쳐 보일 때 배경색과 경계를 줄 때만 켠다.
  ring?: boolean;
  // AGENT(AI) 담당자 식별 표식. 보드 카드처럼 텍스트 배지(AgentBadge)가 들어갈 공간이
  // 없는 좁은 곳에서 사람과 구분하기 위해 보라색 ring + 우하단 Bot 마커를 덧붙인다.
  // accessible name 에도 "(AGENT)" 를 붙여 스크린리더에 AI 여부를 전달한다.
  agent?: boolean;
  // 정지·비활성 계정(WP-1080) — 회색 바탕 + 접근 이름·툴팁 「(비활성)」. 호출부가 정한다(user.active 를 스스로 읽지 않음).
  inactive?: boolean;
  // 마우스 툴팁만 바꿀 때(accessible name 은 그대로) — 예: AI 위임 작업 표가 숨긴 에이전트 유형을 「이름 · 도구」로 보일 때(WP-917).
  title?: string;
}) {
  const seed = user.name || user.username || '?';
  const initial = avatarInitials(seed);
  // AGENT 면 aria-label/title 에 AGENT 표기를 덧붙여 사람 담당자와 구분되게 한다.
  const label = withInactiveSuffix(agent ? `${user.name} (에이전트)` : user.name, inactive);
  // 겹침(-space-x-1) 상황에서도 보이도록 ring 은 AI 강조색으로, 마커는 겹침의 윗면인
  // 우하단 모서리에 배치한다. ring 두께는 AGENT 강조를 위해 사람보다 한 단계 두껍게.
  // #208: raw purple → 시맨틱 토큰 ai-accent(라이트/다크 자동). AGENT 표식 색 통일.
  const ringClass = agent
    ? 'ring-2 ring-ai-accent'
    : ring
      ? 'ring-2 ring-background'
      : '';
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-medium ${SIZE_CLASS[size]} ${inactive ? 'bg-muted-foreground/15 text-muted-foreground' : 'bg-presence text-presence-foreground'} ${ringClass}`}
      // 흐림(opacity·grayscale) 대신 회색 바탕 — AGENT ring·Bot 마커를 지우지 않고 겹친 아바타가 비치지 않게
      // 비활성 바탕은 /15 — /30 이면 xs 이니셜 대비가 라이트 3.68:1 로 4.5:1 에 못 미쳤다(WP-1100 실측: /15 라이트 4.6·다크 5.68).
      style={inactive ? undefined : presenceStyle(user.id)}
      title={title ?? label}
      aria-label={label}
      data-testid={`user-avatar-${user.id}`}
      data-agent={agent ? 'true' : undefined}
      data-inactive={inactive ? 'true' : undefined}
    >
      {initial}
      {agent && (
        <span
          // 우하단 모서리 Bot 마커 — AgentBadge 와 동일한 ai-accent 토큰으로 색 일관성 유지(#208).
          className="absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-full bg-ai-accent text-ai-accent-foreground ring-1 ring-background"
          data-testid={`user-avatar-${user.id}-agent-marker`}
          aria-hidden="true"
        >
          <Bot className="h-2.5 w-2.5 p-px" />
        </span>
      )}
    </span>
  );
}

/**
 * 이슈 담당자 아바타 — 담당자 요약에서 AI 표식(kind)과 비활성(active, WP-1080)을 한 곳에서 정해 UserAvatar 에 넘긴다.
 * 목록·보드·모바일 행·담당자 칸·행 메뉴가 함께 써서, 새 담당자 화면이 표식을 빠뜨리지 않게 한다.
 */
export function AssigneeAvatar({
  user,
  ...rest
}: { user: UserSummary } & Omit<Parameters<typeof UserAvatar>[0], 'user' | 'agent' | 'inactive'>) {
  return <UserAvatar user={user} agent={user.kind === 'AGENT'} inactive={isInactiveUser(user)} {...rest} />;
}
