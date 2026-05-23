// 사용자 이니셜 아바타 — 이름/유저명에서 첫 글자 1자를 뽑아 배경색으로 식별.
// 색상은 이름 해시 기반 결정적 매핑이라 같은 사용자는 항상 같은 색이 나온다.

import type { UserSummary } from '../../types/user';

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
}: {
  user: UserSummary;
  size?: 'xs' | 'sm' | 'md';
  // 보드 카드처럼 겹쳐 보일 때 배경색과 경계를 줄 때만 켠다.
  ring?: boolean;
}) {
  const seed = user.name || user.username || '?';
  const initial = seed.charAt(0).toUpperCase();
  return (
    <span
      title={user.name}
      aria-label={user.name}
      className={`inline-flex items-center justify-center rounded-full text-white font-medium ${SIZE_CLASS[size]} ${colorFor(seed)} ${ring ? 'ring-2 ring-background' : ''}`}
      data-testid={`user-avatar-${user.id}`}
    >
      {initial}
    </span>
  );
}
