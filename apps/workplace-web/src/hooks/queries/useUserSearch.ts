// 구성원 검색 (멤버 picker 등) — 구성원 디렉터리 GET /api/v1/members (#833).
//
// 이전에는 계정 관리 API(GET /users, user:read = ADMIN 전용)를 썼다. 그래서 일반 구성원은 프로젝트
// 멤버 추가·DM 수신자 선택 같은 평범한 작업에서 403 을 받았다. 사람을 고르는 일은 계정 관리가 아니라
// 디렉터리 조회이므로 member:read 로 열린 /members 를 쓴다.
//
// 반환 항목은 MemberSummary 를 picker 가 쓰는 필드로만 좁힌 MemberPickerCandidate 다. UserResponse 로
// 단언(as)하면 createdAt·aiAvailable 이 런타임엔 undefined 인데 타입상 존재하는 거짓말이 된다.
// 팝오버 계약을 MemberSummary 로 바꾸는 정리는 호출부 6곳이 묶여 있어 별도 변경으로 분리했다.
//
// 검색어가 비어 있어도 조회한다(#734) — picker 를 열자마자 해당 kind 의 기본 후보 목록을 보여주기 위함.
// staleTime 30초로 연속 타이핑/필터 토글 중 재요청 억제.

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { flattenUniquePages } from '../../lib/offsetPaging';
import type { UserResponse } from '../../types/auth';
import type { PageResponse } from '../../types/common';
import type { MemberSummary } from '../../types/member';
import { memberKeys, useInfiniteMembers, useMembers } from './useMembers';

// kind 기본값 'HUMAN' — 기존 호출부(프로젝트 멤버 추가 등) 동작 유지. DM 수신자 검색처럼 에이전트가 필요한
// 호출부만 'ALL'/'AGENT' 를 명시적으로 넘긴다(#691 — 백엔드가 kind 를 실제로 필터링하므로 여기서 넘긴 값이
// 곧 검색 결과 범위를 결정한다).
/**
 * 멤버 picker 가 실제로 읽는 필드만 추린 후보 타입.
 *
 * 디렉터리(/members)는 createdAt·aiAvailable 을 주지 않으므로 UserResponse 로 단언하면 타입상 존재하는
 * 필드가 런타임엔 undefined 인 거짓말이 된다. picker 소비처는 id·username·name·email·isActive·kind 만
 * 읽으므로 그만큼만 노출한다.
 */
export type MemberPickerCandidate = {
  id: number;
  username: string;
  name: string;
  email: string | null;
  isActive: boolean;
  kind: UserResponse['kind'];
  /** 소속 부서(WP-1048) — 직접 속한 조직도 부서 하나. 같은 이름을 가르려고 이름 옆에 보인다. 없으면 null. */
  department: string | null;
};

export function useUserSearch(query: string, kind: 'HUMAN' | 'AGENT' | 'ALL' = 'HUMAN') {
  const trimmed = query.trim();
  // 디렉터리 조회는 useMembers 하나로 통일 — 같은 엔드포인트를 캐시 키만 달리해 두 번 치지 않는다.
  const q = useMembers({ search: trimmed, kind, size: 20 });
  const content: MemberPickerCandidate[] = (q.data?.content ?? []).map(toCandidate);
  return { ...q, data: q.data ? { ...q.data, content } : undefined };
}

/** 디렉터리 구성원(MemberSummary)을 picker 후보 모양으로 — 단일 페이지·이어 받기 훅이 같은 변환을 쓴다. */
function toCandidate(m: MemberSummary): MemberPickerCandidate {
  return {
    id: m.userId,
    username: m.username,
    name: m.name,
    email: m.email,
    isActive: m.active,
    kind: m.kind,
    department: m.department ?? null,
  };
}

/** 이어 받기 한 번에 받는 구성원 수 — 첫 화면은 예전 한 페이지(20명)와 같다. */
export const USER_SEARCH_PAGE_SIZE = 20;

/**
 * 구성원 검색 이어 받기(WP-1225) — 사람·조직 고르기 창(PeopleAndDepartmentPicker)이 목록 끝에 닿으면 다음 20명을 받는다.
 *
 * useUserSearch 는 한 페이지(20명)만 받아, 검색어 없이 스크롤하면 21번째부터의 구성원(다른 AI 개발자 등)에 닿을 수 없었다.
 * 다른 호출부(DM 수신자·사람 고르기 팝오버)는 한 페이지 동작을 그대로 두고, 고르기 창만 이 훅으로 이어 받는다.
 * 조회는 설정 > 구성원 목록과 같은 useInfiniteMembers(offset 페이지) — 'members' 접두 키라 구성원 변경 무효화도 함께 받는다.
 * candidates 는 페이지를 이어 붙이고 id 로 중복을 걷어 낸다(페이지 사이에 구성원이 늘면 경계 행이 다시 온다).
 */
export function useUserSearchInfinite(
  query: string,
  kind: 'HUMAN' | 'AGENT' | 'ALL' = 'HUMAN',
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const q = useInfiniteMembers({ search: query.trim(), kind }, USER_SEARCH_PAGE_SIZE, { ...options, scope: 'picker' });
  // 페이지를 이어 붙인 후보 — 렌더마다 다시 만들지 않게 받은 데이터가 바뀔 때만 계산한다.
  const candidates = useMemo(() => flattenUniquePages(q.data?.pages, (m) => m.userId).map(toCandidate), [q.data]);
  /**
   * 고르기 창 이어 받기 캐시를 모두 첫 페이지만 남긴다 — 창이 닫힐 때 부른다. 무한 조회는 다시 받을 때 받아 둔 페이지를 모두 차례로 다시 받으므로,
   * 끝까지 내려 본 뒤 다시 열거나 다른 화면에서 같은 창을 띄울 때 수십 번 요청하지 않게 한다(다시 열면 첫 20명부터 이어 받는다).
   * 지금 검색어의 키만이 아니라 창 전용 접두(pickerInfinite) 전체를 줄인다 — 닫기 전에 여러 검색어로 내려 본 캐시도 함께 줄이려고.
   * 설정 > 구성원 목록은 다른 키라 영향이 없다.
   */
  const trimPickerPages = useCallback(
    (): void => {
      queryClient.setQueriesData<InfiniteData<PageResponse<MemberSummary>, number>>(
        { queryKey: memberKeys.pickerInfinite },
        (d) => (d && d.pages.length > 1 ? { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } : d),
      );
    },
    [queryClient],
  );
  return { ...q, candidates, trimPickerPages };
}
