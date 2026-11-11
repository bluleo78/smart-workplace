// DM 아이콘(WP-1466) — 1:1 은 상대 아바타, 그룹은 동그라미 하나를 세로로 반씩 나눠 앞의 두 상대를 넣는다(Teams 의 「avatar pie」 방식).
// 1:1 아바타와 같은 크기의 원 하나라 목록 줄이 맞고, 나뉜 모양으로 그룹인 것이, 두 사람의 색·첫 글자로 어느 방인지가 함께 보인다.
// 사람마다 색은 UserAvatar 와 같은 사람 색(presenceStyle)이고, 올린 프로필 이미지가 있으면 그 반쪽을 이미지로 덮는다.
import { AvatarPicture } from '@/components/users/AvatarPicture'
import { UserAvatar } from '@/components/users/UserAvatar'
import { avatarInitials } from '@/lib/avatarColor'
import { presenceStyle } from '@/lib/collab/presence'
import { cn } from '@/lib/utils'
import type { DmResponse } from '@/types/messaging'

type Person = DmResponse['participants'][number]

// 크기별 상자·반쪽 글자. 반쪽은 폭이 절반이라 1:1 아바타보다 글자를 한 단계 줄인다.
const SIZES = {
  xs: { box: 'h-5 w-5', text: 'text-[9px]', px: 20 },
  lg: { box: 'h-9 w-9', text: 'text-xs', px: 36 },
} as const

export function DmAvatar({ people, size }: { people: Person[]; size: keyof typeof SIZES }) {
  if (people.length < 2) {
    const one = people[0]
    return one ? <UserAvatar user={{ id: one.userId, username: '', name: one.name }} size={size} /> : null
  }
  const s = SIZES[size]
  const label = people.map((p) => p.name).join(', ')
  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-full font-medium', s.box, s.text)}
      role="img"
      aria-label={`${label} 그룹 대화`}
      title={label}
      data-testid="group-avatar"
      data-size={size}
    >
      {people.map((p, i) => (
        <span
          key={p.userId}
          // 반쪽 사이에 바탕색 줄을 그어 두 사람 경계를 보인다(색이 비슷해도 나뉜 모양이 보이게).
          className={cn(
            'relative inline-flex flex-1 items-center justify-center overflow-hidden bg-presence text-presence-foreground',
            i > 0 && 'border-l border-background',
          )}
          style={presenceStyle(p.userId)}
          data-testid={`group-avatar-part-${p.userId}`}
          aria-hidden="true"
        >
          <AvatarPicture userId={p.userId} name={p.name} px={s.px} className="rounded-none">
            {avatarInitials(p.name || '?')}
          </AvatarPicture>
        </span>
      ))}
    </span>
  )
}
