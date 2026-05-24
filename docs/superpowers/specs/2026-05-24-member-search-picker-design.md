# 프로젝트 멤버 추가 UX — 검색 기반 typeahead 설계

> issue: #31
> 작성일: 2026-05-24

## 배경

현재 `MemberManagement` 폼은 새 멤버 추가 시 **userId(숫자)** 를 직접 입력해야 한다.
운영자가 사용자 ID 를 알 방법이 사실상 없어 UX 가 매우 빈약하다.
Phase 5a 에서 AGENT 유저가 추가되면서 "AGENT 를 프로젝트 멤버로 어떻게 넣지?" 라는
실사용 시나리오가 즉시 부각되었다.

## 목표

username/email/name 부분 검색 → 후보 리스트 → 클릭 1회로 멤버 추가가 가능한
typeahead picker 로 교체한다. AGENT 도 함께 검색되며 배지로 구분 노출한다.

## 비목표 (YAGNI)

- 새로운 백엔드 검색 endpoint 신설 (기존 `GET /api/v1/users` 로 충분)
- 페이지네이션 / 무한 스크롤 (검색 결과 상위 20 건이면 충분)
- 다중 선택 추가 (한 번에 한 명씩, 연속 추가 UX 로 대응)
- 초대 기반 흐름 (이메일 발송 등) — 후속

## 아키텍처

- **백엔드 변경 없음.** 기존 `GET /api/v1/users?search=<q>&size=20` 재사용.
  - `UserResponse` 에 이미 `kind` (HUMAN | AGENT) 노출됨 (Phase 5a).
  - `user:read` 권한 필요 — 프로젝트 OWNER 가 멤버 관리 진입할 수 있다면 이미 보유.
- **프론트엔드.** `MemberManagement` 의 userId Input 을 신규 컴포넌트
  `MemberSearchPopover` 로 교체. 클라이언트 측에서 기존 멤버 제외/AGENT 필터 처리.

## 컴포넌트

### MemberSearchPopover (신규)

위치: `apps/workplace-web/src/pages/projects/components/MemberSearchPopover.tsx`

책임:
- 검색 Input (autofocus)
- 300ms debounce 후 `useUserSearch(query)` 로 검색
- 결과 리스트 — shadcn `Command` 컴포넌트로 키보드 네비게이션 (↑↓, Enter) 위임
- kind 필터 토글: `전체 | 사람 | AGENT` (chip)
- 각 row 구성:
  - 아바타 (이름 이니셜)
  - `name`
  - `@username` (muted)
  - AGENT 면 `AgentBadge size="xs"`
  - 이미 멤버이면 row disabled + 우측에 `(이미 멤버)` 라벨
- row 클릭 → `onSelect(user)` 콜백 — 부모가 mutation 호출
- 추가 성공 후 popover 는 **닫지 않고** 검색어만 비움 (연속 추가 UX)

Props:
```ts
interface MemberSearchPopoverProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  existingMemberIds: Set<number>;  // 이미 멤버인 userId 집합
  onSelect: (user: UserSummary) => void | Promise<void>;
  trigger: React.ReactNode;  // 외부에서 트리거 버튼 제공
}
```

### useUserSearch (신규 훅)

위치: `apps/workplace-web/src/hooks/queries/useUserSearch.ts`

```ts
export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ['users', 'search', query],
    queryFn: () => apiClient.get<PageResponse<UserSummary>>(
      `/api/v1/users?search=${encodeURIComponent(query)}&size=20`,
    ),
    enabled: query.trim().length >= 1,
    staleTime: 30_000,
  });
}
```

`UserSummary` 는 기존 타입 재사용 — `{ id, username, name, kind }`. 백엔드 응답
필드가 더 많으면 클라이언트에서 필요한 것만 사용.

### MemberManagement 변경

위치: `apps/workplace-web/src/pages/projects/components/MemberManagement.tsx`

변경:
- 기존 `<form>` 의 userId Input 제거
- 그 자리에 `<MemberSearchPopover trigger={<Button>+ 멤버 추가</Button>} ... />` + 옆에 role select 유지
- `onSelect` 콜백 내에서 `addMember.mutateAsync({ userId: user.id, role: newRole })`
- `existingMemberIds` 는 `useProjectMembers` 결과로 계산
- 에러는 기존 `handleApiError` 패턴 유지

## 데이터 흐름

```
User → 트리거 클릭 → Popover 열림
     → "te" 입력 → 300ms debounce → GET /api/v1/users?search=te&size=20
     → 결과 + 멤버 집합 + kind 필터 적용
     → row 클릭 → POST /api/v1/projects/{key}/members { userId, role }
     → 성공 토스트 + members 쿼리 invalidate + 검색어 비움 (popover 유지)
```

## 에러 처리

- 검색 API 실패: popover 내부에 "검색 실패" 메시지. 토스트는 띄우지 않음 (과도한 noise 방지)
- 추가 실패: 기존 `handleApiError` 가 토스트 처리
- 빈 검색어: 안내 텍스트 "이름/아이디/이메일로 검색하세요"
- 결과 0건: "결과가 없습니다"

## 테스트

E2E: `apps/workplace-web/e2e/pages/projects/member-search.spec.ts`

1. **@smoke** 검색 후 추가
   - 트리거 클릭 → popover 노출
   - "te" 입력 → debounce 후 GET `/api/v1/users?search=te` 호출 검증
   - 후보 row 클릭 → POST `/members` payload `{ userId: X, role: 'MEMBER' }` 검증
   - 토스트 + 테이블에 신규 멤버 노출
2. AGENT 필터 토글 → AGENT 만 노출 + `AgentBadge` 가시
3. 이미 멤버인 후보 → row disabled, `(이미 멤버)` 라벨, 클릭 시 mutation 미발생

기존 `auth.fixture.ts` + 기존 stub 패턴 (`assignees.spec.ts` 참고) 재사용.

## 영향 범위

- 추가: `MemberSearchPopover.tsx`, `useUserSearch.ts`, `member-search.spec.ts`
- 수정: `MemberManagement.tsx`
- 백엔드: 변경 없음
- 마이그레이션: 없음

## 커밋

단일 commit, 한국어 메시지:
```
feat(web): 프로젝트 멤버 추가 검색 picker — #31
```
