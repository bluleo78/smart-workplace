// 연락처 화면 컨텍스트 builder(WP-54). 구성원은 username(get_member_contact 인자 — userId 아님),
// 외부는 externalId(get_external_contact 인자). 두 id 공간이 겹치므로 구분을 facts 로도 명시한다.
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

const TYPE_LABEL = { ALL: null, MEMBER: '구성원', EXTERNAL: '외부', FAVORITE: '즐겨찾기' } as const;

export interface ContactsContextInput {
  q: string;
  type: 'ALL' | 'MEMBER' | 'EXTERNAL' | 'FAVORITE';
  organization: string | null;
  title: string | null;
  groupId: number | null;
  groupName: string | null;
  /** 목록 건수 — 조회 전(또는 그룹 뷰라 통합 목록이 화면에 없을 때)이면 undefined: 미로드 값은 보내지 않는다. */
  count?: number;
  hasMore?: boolean;
  selected: {
    type: 'MEMBER' | 'EXTERNAL';
    id: number;
    name: string;
    username: string | null;
    organization: string | null;
    title: string | null;
    email: string | null;
  } | null;
}

/** 연락처 화면 — 필터/그룹 scope + (선택된 경우) 연락처 focus. */
export function buildContactsContext(input: ContactsContextInput): AiScreenContext {
  const scope: NonNullable<AiScreenContext['scope']> = { label: '연락처' };
  if (input.groupId != null) scope.refs = buildRefs({ groupId: input.groupId });
  const facts = buildFacts([
    ['검색어', input.q],
    ['유형', TYPE_LABEL[input.type]],
    ['소속', input.organization],
    ['직함', input.title],
    ['그룹', input.groupId != null ? (input.groupName ?? `#${input.groupId}`) : null],
  ]);
  if (facts) scope.facts = facts;
  if (input.count != null) scope.count = input.count;
  if (input.hasMore != null) scope.hasMore = input.hasMore;

  const ctx: AiScreenContext = { view: '연락처', scope };
  const s = input.selected;
  if (s) {
    ctx.focus = {
      type: '연락처',
      label: clip(s.name, LIMITS.label),
      refs: s.type === 'MEMBER' ? buildRefs({ username: s.username }) : buildRefs({ externalId: s.id }),
      facts: buildFacts([
        ['구분', s.type === 'MEMBER' ? '구성원' : '외부'],
        ['소속', s.organization],
        ['직함', s.title],
        ['이메일', s.email],
      ]),
    };
  }
  return ctx;
}
