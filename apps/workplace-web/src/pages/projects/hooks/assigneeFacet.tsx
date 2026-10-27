// 이슈 필터 바의 「담당자」 facet(WP-1020) — 데스크톱 칩 줄·모바일 칩 줄이 같은 정의를 쓴다.
// 맨 위에 「나」(로그인 사용자가 멤버일 때)와 「미지정」을 두고, 그 아래 나머지 멤버를 멤버 목록 순서로 둔다.
// 「미지정」은 facet 값 'none'(URL assignee 의 null 토큰)으로 담아 칩 요약·개수가 특별 처리 없이 맞게 한다 — 구성요소 「없음」과 같은 방식.

import type { FacetDef, FacetValue } from '@/components/filter';

import { UserAvatar } from '../../../components/users/UserAvatar';
import type { MemberResponse } from '../../../types/project';

/** 「미지정」 facet 값 — 담당자 id(숫자)와 겹치지 않는 글자. */
export const ASSIGNEE_NONE = 'none';

/** 아바타 + 이름 — 목록 행 담당자 아바타와 같은 색(사용자 id 기준)이라 고를 때 눈으로 찾기 쉽다. */
function withAvatar(m: Pick<MemberResponse, 'userId' | 'username' | 'name'>, label: string) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * 담당자 facet. meId 가 멤버 목록에 있으면 그 사람을 「나 (이름)」으로 맨 위에 올리고 아래 목록에선 뺀다 — 같은 값이 두 줄이면 안 된다.
 * @param members 프로젝트 멤버(서버 순서)
 * @param meId 로그인 사용자 id(없으면 「나」 없음)
 */
export function buildAssigneeFacet(members: readonly MemberResponse[], meId: number | null | undefined): FacetDef {
  const me = meId == null ? undefined : members.find((m) => m.userId === meId);
  const others = members.filter((m) => m !== me);
  return {
    key: 'assignee',
    label: '담당자',
    countUnit: '명',
    options: [
      ...(me ? [{ value: me.userId, label: `나 (${me.name})`, render: withAvatar(me, `나 (${me.name})`) }] : []),
      {
        value: ASSIGNEE_NONE,
        label: '미지정',
        render: (
          <span className="flex items-center gap-1.5">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground" aria-hidden>
              –
            </span>
            미지정
          </span>
        ),
      },
      ...others.map((m) => ({ value: m.userId, label: m.name, render: withAvatar(m, m.name) })),
    ],
  };
}

/** 필터 값(담당자 id + 미지정) → facet 선택값. */
export function assigneeFacetValue(assigneeIds: number[], includeUnassigned: boolean): FacetValue[] {
  return [...assigneeIds, ...(includeUnassigned ? [ASSIGNEE_NONE] : [])];
}

/** facet 선택값 → 필터 값. 숫자는 담당자 id, 'none' 은 「미지정」(URL assignee=null). */
export function assigneeFilterFromFacet(values: FacetValue[] | undefined): { assigneeIds: number[]; includeUnassigned: boolean } {
  const vs = values ?? [];
  return {
    assigneeIds: vs.filter((v): v is number => typeof v === 'number'),
    includeUnassigned: vs.includes(ASSIGNEE_NONE),
  };
}
