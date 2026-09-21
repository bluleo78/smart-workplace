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

import type { UserResponse } from '../../types/auth';
import { useMembers } from './useMembers';

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
};

export function useUserSearch(query: string, kind: 'HUMAN' | 'AGENT' | 'ALL' = 'HUMAN') {
  const trimmed = query.trim();
  // 디렉터리 조회는 useMembers 하나로 통일 — 같은 엔드포인트를 캐시 키만 달리해 두 번 치지 않는다.
  const q = useMembers({ search: trimmed, kind, size: 20 });
  const content: MemberPickerCandidate[] = (q.data?.content ?? []).map((m) => ({
    id: m.userId,
    username: m.username,
    name: m.name,
    email: m.email,
    isActive: m.active,
    kind: m.kind,
  }));
  return { ...q, data: q.data ? { ...q.data, content } : undefined };
}
