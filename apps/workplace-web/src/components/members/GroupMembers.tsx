// 부서 행의 구성원 펼침(WP-1052) — 노트·드라이브 공간 멤버 창(SpaceMemberDialog)·프로젝트 멤버 관리(WP-1057)의 부서 행과
// 노트 공유 창의 지정한 부서(WP-1048)가 같이 쓴다. 공유 창용 사본(ShareGroupMembers)만 긴 소속 경로 말줄임을 고쳐(WP-1068) 멤버 창은
// 이름이 한두 글자로 줄어든 채 남았다(WP-1094) — 한 컴포넌트로 합쳐 어느 창에서나 같은 줄 모양을 쓴다.
import { useGroupAllMembers } from '@/hooks/queries/useGroupMemberSearch'
import { cn } from '@/lib/utils'

/** 펼침 목록이 놓이는 부서 행 모양 — 「member-row」는 멤버 창·프로젝트 멤버 표(펼침 버튼 + 아이콘 뒤 이름 자리, 아래 행과 띄움),
 * 「share-row」는 노트 공유 창의 지정한 부서(아이콘 뒤 이름 자리, 부서 행 바로 아래). */
type GroupMembersInset = 'member-row' | 'share-row'

const INSETS: Record<GroupMembersInset, string> = {
  'member-row': 'mb-1 ml-14',
  'share-row': 'mt-1 ml-8',
}

/**
 * 부서 행의 구성원 펼침(WP-1052) — 그 부서와 하위 부서의 지금 사람 구성원(그 부서로 들어오는 사람). 펼칠 때만 받는다.
 * 하위 부서 사람은 소속 경로를 함께 보인다(서버 경로는 펼친 부서 자신부터라 첫 이름은 뺀다). 외부 연락처는 멤버로 들어올 수 없어 뺀다.
 * inset 은 놓이는 부서 행 모양에 맞춘 들여쓰기·여백이다 — 창마다 부서 행 모양이 달라 이름 자리가 다르다.
 * 바깥에서 className 으로 기본 여백을 덮어쓰면 기본값을 바꿀 때 조용히 어긋나서(WP-1142) 모양을 이름으로 고른다.
 */
export function GroupMembers({ groupId, testId, inset = 'member-row' }: { groupId: number; testId: string; inset?: GroupMembersInset }) {
  const members = useGroupAllMembers(groupId)
  const people = (members.data ?? []).filter((m) => m.targetType === 'MEMBER')
  return (
    <div className={cn('space-y-0.5 text-xs', INSETS[inset])} data-testid={testId}>
      {members.isPending ? (
        <p className="text-muted-foreground">구성원을 불러오는 중…</p>
      ) : members.isError ? (
        <p className="text-destructive">구성원을 불러오지 못했습니다</p>
      ) : people.length === 0 ? (
        <p className="text-muted-foreground">지금 구성원이 없습니다</p>
      ) : (
        <ul className="space-y-0.5">
          {people.map((m) => (
            <li key={m.targetId} className="flex min-w-0 items-center gap-1.5">
              {/* 이름이 먼저 — 긴 소속 경로가 이름을 한두 글자로 줄이지 않게 경로가 붙는 줄은 이름이 줄 폭의 60% 까지 지키고 경로가 먼저 줄어든다(WP-1068).
                  경로가 없는 직속 사람은 줄 전체를 이름이 쓴다. */}
              <span className={cn('truncate', m.groupPath.length > 1 && 'max-w-[60%] shrink-0')}>{m.name}</span>
              {m.groupPath.length > 1 && <span className="min-w-0 truncate text-muted-foreground">{m.groupPath.slice(1).join(' › ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
