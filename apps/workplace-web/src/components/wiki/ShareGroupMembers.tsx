// 노트 공유 창의 지정한 부서 구성원 펼침(WP-1048) — 「프론트엔드팀 · 3명」 줄의 ▾ 로 지금 링크를 열 수 있는 사람을 본다.
// 왜: 부서는 한 줄로만 보여 누가 들어 있는지 공유 창에서 알 수 없었다(VOC). 부서 자체를 대상으로 두는 규칙(WP-1023)은 그대로 —
//     펼쳐 보기만 하고 사람 단위로 풀지 않는다. 하위 부서 사람은 소속 경로를 함께 보인다. 외부 연락처는 링크를 열 수 없어 뺀다.
import { useGroupAllMembers } from '../../hooks/queries/useGroupMemberSearch'

export function ShareGroupMembers({ groupId }: { groupId: number }) {
  const members = useGroupAllMembers(groupId)
  const people = (members.data ?? []).filter((m) => m.targetType === 'MEMBER')
  return (
    <div className="mt-1 ml-8 space-y-0.5 text-xs" data-testid={`wiki-share-group-members-${groupId}`}>
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
              {/* 하위 부서 사람은 소속 경로 — 서버 경로는 펼친 부서 자신부터라(직속이면 빈 배열) 줄 위의 부서 이름은 빼고 그 아래만 보인다. */}
              {m.groupPath.length > 1 && <span className="truncate text-muted-foreground">{m.groupPath.slice(1).join(' › ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
