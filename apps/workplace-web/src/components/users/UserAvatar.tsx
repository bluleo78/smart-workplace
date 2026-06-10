// 사용자 이니셜 아바타 — 이름/유저명에서 첫 글자 1자를 뽑아 배경색으로 식별.
// 색상은 이름 해시 기반 결정적 매핑이라 같은 사용자는 항상 같은 색이 나온다.

import { Bot } from 'lucide-react';

import type { UserSummary } from '../../types/user';

// kind 정보 없이도 호출 가능하도록 식별/표기 필드만 요구하는 좁은 타입.
type AvatarUser = Pick<UserSummary, 'id' | 'username' | 'name'>;

// 사이즈별 Tailwind 클래스 묶음.
const SIZE_CLASS: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
};

// 색상 팔레트 — 12색. 다크/라이트 모두 가독성 OK 한 -400 채도.
const PALETTE = [
  'bg-red-400',
  'bg-orange-400',
  'bg-amber-400',
  'bg-yellow-400',
  'bg-green-400',
  'bg-teal-400',
  'bg-cyan-400',
  'bg-blue-400',
  'bg-indigo-400',
  'bg-purple-400',
  'bg-pink-400',
  'bg-rose-400',
];

// 이름 → 팔레트 인덱스. 단순 djb2 변형 해시.
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function UserAvatar({
  user,
  size = 'sm',
  ring = false,
  agent = false,
}: {
  user: AvatarUser;
  size?: 'xs' | 'sm' | 'md';
  // 보드 카드처럼 겹쳐 보일 때 배경색과 경계를 줄 때만 켠다.
  ring?: boolean;
  // AGENT(AI) 담당자 식별 표식. 보드 카드처럼 텍스트 배지(AgentBadge)가 들어갈 공간이
  // 없는 좁은 곳에서 사람과 구분하기 위해 보라색 ring + 우하단 Bot 마커를 덧붙인다.
  // accessible name 에도 "(AGENT)" 를 붙여 스크린리더에 AI 여부를 전달한다.
  agent?: boolean;
}) {
  const seed = user.name || user.username || '?';
  const initial = seed.charAt(0).toUpperCase();
  // AGENT 면 aria-label/title 에 AGENT 표기를 덧붙여 사람 담당자와 구분되게 한다.
  const label = agent ? `${user.name} (AGENT)` : user.name;
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
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full text-white font-medium ${SIZE_CLASS[size]} ${colorFor(seed)} ${ringClass}`}
      title={label}
      aria-label={label}
      data-testid={`user-avatar-${user.id}`}
      data-agent={agent ? 'true' : undefined}
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
