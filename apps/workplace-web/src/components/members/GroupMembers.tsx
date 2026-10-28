// 부서 행의 구성원 펼침(WP-1052) — 노트·드라이브 공간 멤버 창(SpaceMemberDialog)과 프로젝트 멤버 관리(WP-1057)의 부서 행이 같이 쓴다.
import { useGroupAllMembers } from '@/hooks/queries/useGroupMemberSearch'

/**
 * 부서 행의 구성원 펼침(WP-1052) — 그 부서와 하위 부서의 지금 사람 구성원(그 부서로 들어오는 사람). 펼칠 때만 받는다.
 * 하위 부서 사람은 소속 경로를 함께 보인다(서버 경로는 펼친 부서 자신부터라 첫 이름은 뺀다). 외부 연락처는 멤버로 들어올 수 없어 뺀다.
 */
export function GroupMembers({ groupId, testId }: { groupId: number; testId: string }) {
  const members = useGroupAllMembers(groupId)
  const people = (members.data ?? []).filter((m) => m.targetType === 'MEMBER')
  return (
    <div className="mb-1 ml-14 space-y-0.5 text-xs" data-testid={testId}>
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
              <span className="truncate">{m.name}</span>
              {m.groupPath.length > 1 && <span className="truncate text-muted-foreground">{m.groupPath.slice(1).join(' › ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
