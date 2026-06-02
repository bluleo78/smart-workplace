# Messaging Phase 2b — 프론트엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2a 백엔드(비공개 채널·채널 CRUD·탐색·멤버 역할)에 대응하는 프론트엔드를 구현한다 — 내 채널 사이드바, 생성/탐색 모달, 채널 헤더(이름변경·아카이브·삭제), 멤버 패널(역할·소유권이전·나가기).

**Architecture:** foundation(타입→API 클라이언트→TanStack Query 훅)을 먼저 깔고, 그 위에 기능별 **수직 슬라이스**(컴포넌트 + 연결 훅 + Playwright E2E)를 쌓는다. 백엔드는 main(`2204f4d`)에 이미 머지됨. E2E는 백엔드 없이 `page.route()` 로 전부 모킹한다.

**Tech Stack:** Vite + React 19 + TS + TanStack Query + shadcn/ui + Playwright. 작업 디렉터리는 `apps/workplace-web`.

---

## 사전 컨텍스트 (전 태스크 공통)

**백엔드 API 계약** (`/api/v1/messaging`, main 반영 완료):

| Method | Path | Req body | Res | 권한 |
|---|---|---|---|---|
| GET | `/channels` | — | `ChannelResponse[]` (내 채널, 비아카이브) | 멤버 |
| GET | `/channels/discover?q=` | — | `ChannelResponse[]` (공개·비아카이브) | 로그인 |
| POST | `/channels` | `{name, visibility}` | `ChannelResponse` (201) | 로그인 |
| GET | `/channels/{id}` | — | `ChannelResponse` | 멤버(비공개 비멤버→404) |
| PATCH | `/channels/{id}` | `{name}` | `ChannelResponse` | OWNER/ADMIN |
| POST | `/channels/{id}/archive` | — | 204 | OWNER/ADMIN |
| POST | `/channels/{id}/unarchive` | — | 204 | OWNER/ADMIN |
| DELETE | `/channels/{id}` | — | 204 | 시스템 ADMIN |
| POST | `/channels/{id}/join` | — | 204 | 로그인(공개·비멤버) |
| GET | `/channels/{id}/members` | — | `ChannelMemberResponse[]` | 멤버 |
| POST | `/channels/{id}/members` | `{userId}` | 204 | OWNER/ADMIN |
| DELETE | `/channels/{id}/members/{userId}` | — | 204 | OWNER/ADMIN |
| PATCH | `/channels/{id}/members/{userId}` | `{role}` | 204 | OWNER |
| POST | `/channels/{id}/leave` | — | 204 | 멤버(OWNER는 이전 후) |

**예외 → HTTP**: 비멤버 접근 403/404, 권한부족 403, 아카이브 쓰기 409, OWNER 나가기 차단 409, 검증오류 400.

**기존 코드 패턴**:
- API 클라이언트 함수는 `AxiosResponse` 반환, 호출처(훅)에서 `.then(r => r.data)` unwrap. (`src/api/messaging.ts`)
- 쿼리 훅: `useQuery`(읽기, `enabled: !!deps`), `useMutation`(쓰기, `onSuccess`에서 `qc.invalidateQueries`, `onError`에서 `handleApiError(err, '한국어메시지')`). (`src/hooks/queries/useJoinChannel.ts`)
- 에러 토스트: `import { handleApiError } from '@/lib/api-error'` (sonner toast).
- Dialog 패턴: `src/pages/projects/components/IssueCreateDialog.tsx` 참고 (`Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter` from `@/components/ui/dialog`, `open`/`onOpenChange` 제어).
- **멤버 검색 재사용**: `src/pages/projects/components/MemberSearchPopover.tsx` 를 **그대로 import** 한다. props `{open, onOpenChange, existingMemberIds: Set<number>, onSelect: (user: UserResponse) => void|Promise, trigger: ReactNode}` 는 프로젝트 결합 없이 범용이다. 위치 이동(hoist) 하지 않는다.

**커밋 컨벤션**: `docs/COMMIT_CONVENTION.md`. 한국어 커밋 메시지, scope `web`. **커밋은 각 태스크 마지막 step에서만**.

**실행 명령** (모두 repo 루트에서):
- typecheck: `pnpm -C apps/workplace-web typecheck`
- lint: `pnpm -C apps/workplace-web lint`
- 단일 E2E: `pnpm -C apps/workplace-web test:e2e e2e/pages/<file>.spec.ts`

**한국어 주석 필수** — 모든 컴포넌트·훅·주요 로직에 무엇을·왜.

---

## File Structure

| File | 책임 | 태스크 |
|---|---|---|
| `src/types/messaging.ts` | DTO 타입 (확장) | T1 |
| `e2e/factories/messaging.factory.ts` | E2E 팩토리 (필드 추가 + 멤버 팩토리) | T1 |
| `src/api/messaging.ts` | REST 클라이언트 (11개 함수 추가) | T1 |
| `src/hooks/queries/messagingKeys.ts` | 쿼리 키 (discover/detail/members 추가) | T2 |
| `src/hooks/queries/useMyChannels.ts` | 내 채널 읽기 | T2 |
| `src/hooks/queries/useDiscoverChannels.ts` | 탐색 읽기 | T2 |
| `src/hooks/queries/useChannelDetail.ts` | 채널 상세 읽기 | T2 |
| `src/hooks/queries/useChannelMembers.ts` | 멤버 목록 읽기 | T2 |
| `src/hooks/queries/useChannelMutations.ts` | create/rename/archive/unarchive/delete/leave | T2 |
| `src/hooks/queries/useMemberMutations.ts` | addMember/removeMember/updateMemberRole | T2 |
| `src/components/chat/CreateChannelModal.tsx` | 채널 생성 모달 | T3 |
| `src/components/chat/ChannelSidebar.tsx` | 사이드바 개편 (modify) | T3 |
| `src/components/chat/ChannelBrowser.tsx` | 공개 채널 탐색 모달 | T4 |
| `src/components/chat/ChannelHeader.tsx` | 채널 헤더 + 설정 드롭다운 | T5 |
| `src/components/chat/RenameChannelModal.tsx` | 이름변경 모달 | T5 |
| `src/components/chat/MessageComposer.tsx` | 아카이브 비활성 (modify) | T5 |
| `src/pages/chat/ChannelPage.tsx` | 헤더 합성 + 404 + composer 비활성 (modify) | T5 |
| `src/components/chat/ChannelMembersPanel.tsx` | 멤버 패널 (역할·이전·나가기) | T6 |
| `e2e/pages/chat-channel-crud.spec.ts` | 생성·탐색·아카이브 E2E | T3,T4,T5 |
| `e2e/pages/chat-members.spec.ts` | 멤버·초대·역할·나가기 E2E | T6 |

---

## Task 1: Foundation — 타입 · 팩토리 · API 클라이언트

UI가 없으므로 red-green E2E 대신 **typecheck 컴파일**로 검증하는 foundation 태스크.

**Files:**
- Modify: `src/types/messaging.ts`
- Modify: `e2e/factories/messaging.factory.ts`
- Modify: `src/api/messaging.ts`

- [ ] **Step 1: 타입 확장**

`src/types/messaging.ts` 의 `ChannelResponse` 와 `CreateChannelRequest` 를 교체하고, 새 타입 4개를 추가한다. 파일 상단 주석 아래에 다음을 반영:

```ts
export type UserKind = 'HUMAN' | 'AGENT';
export type ChannelVisibility = 'PUBLIC' | 'PRIVATE';
export type ChannelRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface ChannelResponse {
  id: number;
  kind: string; // 'CHANNEL'
  name: string;
  visibility: ChannelVisibility;
  member: boolean; // caller 가 멤버인지
  role: ChannelRole | null; // 비멤버면 null
  archived: boolean;
  memberCount: number;
  createdAt: string;
}

export interface ChannelMemberResponse {
  userId: number;
  name: string;
  kind: UserKind;
  role: ChannelRole;
  joinedAt: string;
}
```

`MessageResponse`/`MessagePage`/`CreateMessageRequest` 는 그대로 둔다. `CreateChannelRequest` 교체 + 신규 request 타입 추가:

```ts
export interface CreateChannelRequest {
  name: string;
  visibility: ChannelVisibility;
}

export interface RenameChannelRequest {
  name: string;
}

export interface AddMemberRequest {
  userId: number;
}

export interface UpdateRoleRequest {
  role: ChannelRole;
}
```

- [ ] **Step 2: E2E 팩토리 갱신**

`e2e/factories/messaging.factory.ts` 의 `createChannel` 기본값에 신규 필드를 추가하고, `createChannelMember` 팩토리를 새로 추가:

```ts
import type {
  ChannelResponse,
  ChannelMemberResponse,
  MessageResponse,
} from '../../src/types/messaging';

export function createChannel(overrides: Partial<ChannelResponse> = {}): ChannelResponse {
  return {
    id: 1,
    kind: 'CHANNEL',
    name: '일반',
    visibility: 'PUBLIC',
    member: true,
    role: 'MEMBER',
    archived: false,
    memberCount: 1,
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

export function createChannelMember(
  overrides: Partial<ChannelMemberResponse> = {},
): ChannelMemberResponse {
  return {
    userId: 1,
    name: '테스트 사용자',
    kind: 'HUMAN',
    role: 'MEMBER',
    joinedAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}
```

`createMessage` 는 그대로 둔다.

- [ ] **Step 3: API 클라이언트 11개 함수 추가**

`src/api/messaging.ts` 의 import 와 `messagingApi` 객체를 확장. import 에 신규 타입 추가:

```ts
import type {
  ChannelResponse,
  ChannelMemberResponse,
  ChannelRole,
  CreateChannelRequest,
  CreateMessageRequest,
  MessagePage,
  MessageResponse,
} from '../types/messaging';
import { client } from './client';
```

`messagingApi` 객체에 기존 함수는 유지하고 다음을 추가 (단, `createChannel` 의 페이로드 타입은 이미 `CreateChannelRequest` 이므로 타입 변경만으로 `{name, visibility}` 수용):

```ts
  // 공개 채널 탐색. q 비면 전체 공개 채널.
  discoverChannels: (q?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const qs = params.toString();
    return client.get<ChannelResponse[]>(
      `/messaging/channels/discover${qs ? `?${qs}` : ''}`,
    );
  },

  getChannel: (channelId: number) =>
    client.get<ChannelResponse>(`/messaging/channels/${channelId}`),

  renameChannel: (channelId: number, name: string) =>
    client.patch<ChannelResponse>(`/messaging/channels/${channelId}`, { name }),

  archiveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/archive`),

  unarchiveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/unarchive`),

  deleteChannel: (channelId: number) =>
    client.delete<void>(`/messaging/channels/${channelId}`),

  listMembers: (channelId: number) =>
    client.get<ChannelMemberResponse[]>(`/messaging/channels/${channelId}/members`),

  addMember: (channelId: number, userId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/members`, { userId }),

  removeMember: (channelId: number, userId: number) =>
    client.delete<void>(`/messaging/channels/${channelId}/members/${userId}`),

  leaveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/leave`),

  updateMemberRole: (channelId: number, userId: number, role: ChannelRole) =>
    client.patch<void>(`/messaging/channels/${channelId}/members/${userId}`, { role }),
```

- [ ] **Step 4: typecheck 통과 확인**

Run: `pnpm -C apps/workplace-web typecheck`
Expected: PASS (에러 0). 만약 기존 `useChannels.ts`/`ChannelSidebar.tsx` 가 `ChannelResponse` 의 새 필드 때문에 깨지면 안 된다 — 필드는 **추가**만 되었고 `visibility` 타입이 `string`→`ChannelVisibility` 로 좁혀졌으므로, 기존 소비처(`c.visibility` 를 string 으로만 쓰는 곳)는 영향 없음. `CreateChannelRequest` 에 `visibility` 가 필수가 되었으므로 `createChannel` 호출처가 있으면 깨질 수 있는데, 현재 호출처는 없음(생성 UI 미존재). 깨지는 곳이 있으면 보고.

- [ ] **Step 5: lint 통과 확인**

Run: `pnpm -C apps/workplace-web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/src/types/messaging.ts \
        apps/workplace-web/src/api/messaging.ts \
        apps/workplace-web/e2e/factories/messaging.factory.ts
git commit -m "feat(web): messaging 채널 타입·API 클라이언트 Phase 2b 확장"
```

---

## Task 2: Foundation — TanStack Query 훅

UI 없음 → **typecheck** 로 검증. 모든 변경 뮤테이션은 관련 쿼리를 무효화한다.

**Files:**
- Modify: `src/hooks/queries/messagingKeys.ts`
- Create: `src/hooks/queries/useMyChannels.ts`
- Create: `src/hooks/queries/useDiscoverChannels.ts`
- Create: `src/hooks/queries/useChannelDetail.ts`
- Create: `src/hooks/queries/useChannelMembers.ts`
- Create: `src/hooks/queries/useChannelMutations.ts`
- Create: `src/hooks/queries/useMemberMutations.ts`

- [ ] **Step 1: 쿼리 키 확장**

`src/hooks/queries/messagingKeys.ts` 전체를 교체:

```ts
// messaging TanStack Query 키 네임스페이스.
export const messagingKeys = {
  all: ['messaging'] as const,
  channels: () => [...messagingKeys.all, 'channels'] as const,
  discover: (q: string) => [...messagingKeys.all, 'discover', q] as const,
  detail: (channelId: number) => [...messagingKeys.all, 'detail', channelId] as const,
  members: (channelId: number) => [...messagingKeys.all, 'members', channelId] as const,
  messages: (channelId: number) =>
    [...messagingKeys.all, 'messages', channelId] as const,
};
```

- [ ] **Step 2: 읽기 훅 4개 생성**

`src/hooks/queries/useMyChannels.ts`:

```ts
// 내 채널 목록(사이드바) — 멤버이고 비아카이브인 채널만.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useMyChannels() {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.channels(),
    queryFn: () => messagingApi.listChannels().then((r) => r.data),
    staleTime: 10_000,
  });
}
```

`src/hooks/queries/useDiscoverChannels.ts`:

```ts
// 공개 채널 탐색 — q ILIKE 검색. 모달 열림 동안에만 호출되도록 enabled 제어.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useDiscoverChannels(q: string, enabled = true) {
  return useQuery<ChannelResponse[]>({
    queryKey: messagingKeys.discover(q),
    queryFn: () => messagingApi.discoverChannels(q || undefined).then((r) => r.data),
    enabled,
    staleTime: 5_000,
  });
}
```

`src/hooks/queries/useChannelDetail.ts`:

```ts
// 채널 상세(헤더·권한 판정용). channelId 없으면 호출 안 함. 404 등 에러는 호출처에서 분기.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelDetail(channelId?: number) {
  return useQuery<ChannelResponse>({
    queryKey: messagingKeys.detail(channelId ?? 0),
    queryFn: () => messagingApi.getChannel(channelId as number).then((r) => r.data),
    enabled: Number.isFinite(channelId),
    retry: false, // 404(비공개 비멤버)를 즉시 노출 — 재시도 불필요
  });
}
```

`src/hooks/queries/useChannelMembers.ts`:

```ts
// 채널 멤버 목록. 멤버 패널 열림 동안에만 호출.
import { useQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ChannelMemberResponse } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useChannelMembers(channelId?: number, enabled = true) {
  return useQuery<ChannelMemberResponse[]>({
    queryKey: messagingKeys.members(channelId ?? 0),
    queryFn: () => messagingApi.listMembers(channelId as number).then((r) => r.data),
    enabled: Number.isFinite(channelId) && enabled,
  });
}
```

- [ ] **Step 3: 채널 뮤테이션 훅 생성**

`src/hooks/queries/useChannelMutations.ts` — 채널 단위 변경(생성/이름변경/아카이브/해제/삭제/나가기):

```ts
// 채널 단위 mutation 모음. 성공 시 채널 목록/상세 무효화, 실패 시 토스트.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { ChannelResponse, CreateChannelRequest } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

// 채널 생성 → 생성자 OWNER 합류. 성공 시 새 ChannelResponse 반환(호출처가 라우팅).
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation<ChannelResponse, unknown, CreateChannelRequest>({
    mutationFn: (payload) => messagingApi.createChannel(payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 생성에 실패했어요'),
  });
}

export function useRenameChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation<ChannelResponse, unknown, string>({
    mutationFn: (name) => messagingApi.renameChannel(channelId, name).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 이름 변경에 실패했어요'),
  });
}

export function useArchiveChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => messagingApi.archiveChannel(channelId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 보관에 실패했어요'),
  });
}

export function useUnarchiveChannel(channelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => messagingApi.unarchiveChannel(channelId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
    },
    onError: (err) => handleApiError(err, '채널 보관 해제에 실패했어요'),
  });
}

// 하드 삭제(시스템 ADMIN). 성공 시 목록 무효화 — 호출처가 /chat 로 라우팅.
export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.deleteChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) => handleApiError(err, '채널 삭제에 실패했어요'),
  });
}

// 채널 나가기. OWNER 가 멤버 남긴 채 호출하면 서버 409 → 토스트.
export function useLeaveChannel() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (channelId) => messagingApi.leaveChannel(channelId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.channels() }),
    onError: (err) =>
      handleApiError(err, '먼저 소유권을 다른 멤버에게 넘긴 뒤 나갈 수 있어요'),
  });
}
```

- [ ] **Step 4: 멤버 뮤테이션 훅 생성**

`src/hooks/queries/useMemberMutations.ts`:

```ts
// 멤버 단위 mutation 모음. 성공 시 멤버 목록·채널 상세(memberCount) 무효화.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { ChannelRole } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

export function useAddMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => messagingApi.addMember(channelId, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
    },
    onError: (err) => handleApiError(err, '멤버 추가에 실패했어요'),
  });
}

export function useRemoveMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) =>
      messagingApi.removeMember(channelId, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했어요'),
  });
}

// 역할 변경(OWNER 만). role:OWNER 지정 시 서버가 본인을 ADMIN 으로 강등(소유권 이전).
export function useUpdateMemberRole(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, { userId: number; role: ChannelRole }>({
    mutationFn: ({ userId, role }) =>
      messagingApi.updateMemberRole(channelId, userId, role).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) });
      qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) });
    },
    onError: (err) => handleApiError(err, '역할 변경에 실패했어요'),
  });
}
```

- [ ] **Step 5: typecheck + lint 통과 확인**

Run: `pnpm -C apps/workplace-web typecheck && pnpm -C apps/workplace-web lint`
Expected: PASS. (기존 `useChannels.ts` 는 아직 삭제하지 않음 — T3 에서 교체.)

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/src/hooks/queries/messagingKeys.ts \
        apps/workplace-web/src/hooks/queries/useMyChannels.ts \
        apps/workplace-web/src/hooks/queries/useDiscoverChannels.ts \
        apps/workplace-web/src/hooks/queries/useChannelDetail.ts \
        apps/workplace-web/src/hooks/queries/useChannelMembers.ts \
        apps/workplace-web/src/hooks/queries/useChannelMutations.ts \
        apps/workplace-web/src/hooks/queries/useMemberMutations.ts
git commit -m "feat(web): messaging 채널·멤버 query 훅 추가"
```

---

## Task 3: 사이드바 개편 + 채널 생성 (수직 슬라이스)

사이드바를 "내 채널만"으로 바꾸고, 상단에 `+ 채널`(생성 모달)·`탐색` 버튼을 둔다. 비공개 채널엔 자물쇠. `참여` 버튼은 사이드바에서 제거(→ 탐색 화면으로 이동, T4). **Phase 1 회귀**: `chat.spec.ts` 의 사이드바 stub/검증이 깨지므로 같이 갱신.

**Files:**
- Create: `src/components/chat/CreateChannelModal.tsx`
- Modify: `src/components/chat/ChannelSidebar.tsx`
- Delete: `src/hooks/queries/useChannels.ts` (→ `useMyChannels` 로 대체)
- Create: `e2e/pages/chat-channel-crud.spec.ts`
- Modify: `e2e/pages/chat.spec.ts` (회귀 — 사이드바 검증 갱신)

- [ ] **Step 1: 생성 E2E 작성 (실패 확인용)**

`e2e/pages/chat-channel-crud.spec.ts` 신규 작성. 첫 테스트는 공개 채널 생성:

```ts
// messaging 채널 CRUD/탐색 E2E — 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/auth.fixture';
import { createChannel } from '../factories/messaging.factory';

// 사이드바가 부르는 GET /channels(내 채널) + SSE stub. 메시지 GET 은 빈 목록.
async function stubSidebar(page: Page, channels: ReturnType<typeof createChannel>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channels),
      });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: ':\n\n',
      }),
  );
}

test.describe('messaging 채널 생성', () => {
  test('공개 채널 생성 → 새 채널로 이동', async ({ authenticatedPage: page }) => {
    await stubSidebar(page, []);

    // POST /channels — payload 검증 후 201 신규 채널.
    const created = createChannel({ id: 7, name: '신규채널', visibility: 'PUBLIC', role: 'OWNER' });
    const post = await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { name: string; visibility: string };
        expect(payload).toEqual({ name: '신규채널', visibility: 'PUBLIC' });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      },
    );
    void post;
    // 생성 후 이동할 채널의 메시지/상세 stub.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/7/messages',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/7',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(created),
            })
          : route.fallback(),
    );

    await page.goto('/chat');
    await page.getByTestId('channel-create-btn').click();
    await page.getByTestId('create-channel-name').fill('신규채널');
    await page.getByTestId('create-channel-submit').click();

    // 새 채널로 라우팅됨 → 헤더에 채널명.
    await expect(page).toHaveURL(/\/chat\/channels\/7$/);
  });

  test('비공개 토글 → visibility=PRIVATE 페이로드', async ({ authenticatedPage: page }) => {
    await stubSidebar(page, []);
    const created = createChannel({ id: 8, name: '비밀', visibility: 'PRIVATE', role: 'OWNER' });
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { name: string; visibility: string };
        expect(payload).toEqual({ name: '비밀', visibility: 'PRIVATE' });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      },
    );
    await page.route(
      (url) => /\/api\/v1\/messaging\/channels\/8(\/messages)?$/.test(url.pathname),
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: url => url, // placeholder replaced below
            })
          : route.fallback(),
    );

    await page.goto('/chat');
    await page.getByTestId('channel-create-btn').click();
    await page.getByTestId('create-channel-name').fill('비밀');
    await page.getByTestId('create-channel-visibility-private').click();
    await page.getByTestId('create-channel-submit').click();
    await expect(page).toHaveURL(/\/chat\/channels\/8$/);
  });

  test('비공개 채널은 사이드바에 자물쇠로 표시', async ({ authenticatedPage: page }) => {
    const priv = createChannel({ id: 9, name: '비공개방', visibility: 'PRIVATE', member: true });
    await stubSidebar(page, [priv]);
    await page.goto('/chat');
    await expect(page.getByTestId('channel-lock-9')).toBeVisible();
  });
});
```

> **주의**: 두 번째 테스트의 채널 8 stub 본문을 아래 Step 3 구현 후 실제 JSON 으로 교체한다(placeholder 금지). 구현 시 다음으로 대체:
> ```ts
> await page.route(
>   (url) => url.pathname === '/api/v1/messaging/channels/8',
>   (route) => route.request().method() === 'GET'
>     ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
>     : route.fallback(),
> );
> await page.route(
>   (url) => url.pathname === '/api/v1/messaging/channels/8/messages',
>   (route) => route.request().method() === 'GET'
>     ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
>     : route.fallback(),
> );
> ```

- [ ] **Step 2: E2E 실행 → 실패 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts`
Expected: FAIL (`channel-create-btn` 없음 — 타임아웃).

- [ ] **Step 3: CreateChannelModal 구현**

`src/components/chat/CreateChannelModal.tsx`:

```tsx
// 채널 생성 모달 — 이름 입력 + 공개/비공개 토글. 성공 시 새 채널로 라우팅.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateChannel } from '@/hooks/queries/useChannelMutations'
import type { ChannelVisibility } from '@/types/messaging'

export function CreateChannelModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const create = useCreateChannel()
  const navigate = useNavigate()

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const visibility: ChannelVisibility = isPrivate ? 'PRIVATE' : 'PUBLIC'
    const channel = await create.mutateAsync({ name: trimmed, visibility })
    onOpenChange(false)
    setName('')
    setIsPrivate(false)
    navigate(`/chat/channels/${channel.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-channel-modal">
        <DialogHeader>
          <DialogTitle>채널 만들기</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="create-channel-name">이름</Label>
            <Input
              id="create-channel-name"
              data-testid="create-channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 마케팅"
              maxLength={80}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="create-channel-visibility-private">비공개 채널</Label>
            <Switch
              id="create-channel-visibility-private"
              data-testid="create-channel-visibility-private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            비공개 채널은 탐색에 노출되지 않고 초대로만 참여할 수 있어요.
          </p>
        </div>
        <DialogFooter>
          <Button
            data-testid="create-channel-submit"
            disabled={!name.trim() || create.isPending}
            onClick={() => void submit()}
          >
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

> shadcn `Switch`/`Label` 컴포넌트가 `src/components/ui/` 에 있는지 확인. 없으면 `npx shadcn@latest add switch label` 로 추가 후 커밋 포함. (탐색 결과 Switch 는 코드베이스에서 사용 중.)

- [ ] **Step 4: ChannelSidebar 개편**

`src/components/chat/ChannelSidebar.tsx` 전체 교체:

```tsx
// 채널 사이드바 — 내 채널만 노출. 상단 "+ 채널"(생성), "탐색"(브라우저) 액션. 비공개엔 자물쇠.
import { Hash, Lock, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { cn } from '@/lib/utils'

import { ChannelBrowser } from './ChannelBrowser'
import { CreateChannelModal } from './CreateChannelModal'

export function ChannelSidebar() {
  const { id } = useParams()
  const activeId = id ? Number(id) : undefined
  const { data: channels, isLoading } = useMyChannels()
  const [createOpen, setCreateOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar p-2" data-testid="channel-sidebar">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-xs font-semibold text-muted-foreground">채널</span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            data-testid="channel-browse-btn"
            aria-label="채널 탐색"
            onClick={() => setBrowseOpen(true)}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            data-testid="channel-create-btn"
            aria-label="채널 만들기"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {isLoading && <div className="px-2 text-sm text-muted-foreground">불러오는 중…</div>}
      <nav className="space-y-1">
        {channels?.map((c) => (
          <Link
            key={c.id}
            to={`/chat/channels/${c.id}`}
            data-testid={`channel-link-${c.id}`}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              activeId === c.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            {c.visibility === 'PRIVATE' ? (
              <Lock className="h-4 w-4 shrink-0" data-testid={`channel-lock-${c.id}`} />
            ) : (
              <Hash className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{c.name}</span>
          </Link>
        ))}
      </nav>
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
      <ChannelBrowser open={browseOpen} onOpenChange={setBrowseOpen} />
    </aside>
  )
}
```

> `ChannelBrowser` 는 T4 에서 생성한다. T3 에서는 컴파일을 위해 **임시 스텁**을 먼저 만든다 (Step 5).

- [ ] **Step 5: ChannelBrowser 임시 스텁 생성 + useChannels 삭제**

`src/components/chat/ChannelBrowser.tsx` (T4 에서 본 구현으로 대체될 최소 스텁):

```tsx
// 공개 채널 탐색 모달 — T4 에서 구현. 현재는 컴파일용 스텁.
export function ChannelBrowser({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  void open
  void onOpenChange
  return null
}
```

기존 `src/hooks/queries/useChannels.ts` 삭제:

```bash
git rm apps/workplace-web/src/hooks/queries/useChannels.ts
```

다른 import 처가 없는지 확인:

Run: `grep -rn "useChannels\b" apps/workplace-web/src apps/workplace-web/e2e`
Expected: 결과 없음 (사이드바는 `useMyChannels` 로 교체됨).

- [ ] **Step 6: Phase 1 회귀 — chat.spec.ts 갱신**

`e2e/pages/chat.spec.ts` 는 `setupChannelStubs` 로 GET /channels 를 모킹하고 `channel-join-*` 같은 사이드바 join 버튼을 검증하지 않는다(확인 결과 join 검증 없음). 단, 사이드바가 이제 `useMyChannels`(동일 엔드포인트 GET /channels)를 부르므로 stub 은 그대로 유효하다. **검증 필요**: 기존 3개 테스트가 여전히 통과하는지.

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat.spec.ts`
Expected: 만약 통과하면 수정 불필요. FAIL 시(예: 채널 factory 의 신규 필수 필드 누락은 T1 에서 이미 해결됨), 실패 원인을 보고 stub/assertion 을 최소 수정. 변경이 없으면 이 step 은 "수정 없음 확인"으로 종료.

- [ ] **Step 7: 생성 E2E 통과 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts`
Expected: PASS (3개 — 공개생성/비공개페이로드/자물쇠).

- [ ] **Step 8: typecheck + lint**

Run: `pnpm -C apps/workplace-web typecheck && pnpm -C apps/workplace-web lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/workplace-web/src/components/chat/ChannelSidebar.tsx \
        apps/workplace-web/src/components/chat/CreateChannelModal.tsx \
        apps/workplace-web/src/components/chat/ChannelBrowser.tsx \
        apps/workplace-web/e2e/pages/chat-channel-crud.spec.ts \
        apps/workplace-web/e2e/pages/chat.spec.ts \
        apps/workplace-web/src/components/ui
git add -u apps/workplace-web/src/hooks/queries/
git commit -m "feat(web): 채널 사이드바 내 채널 개편 + 생성 모달"
```

---

## Task 4: 공개 채널 탐색·참여 (수직 슬라이스)

T3 의 `ChannelBrowser` 스텁을 본 구현으로 교체. 검색 입력 + 결과 목록, 비멤버에 "참여". 비공개는 서버가 미반환(클라이언트 추가 필터 불필요).

**Files:**
- Modify: `src/components/chat/ChannelBrowser.tsx`
- Modify: `e2e/pages/chat-channel-crud.spec.ts` (탐색 describe 추가)

- [ ] **Step 1: 탐색 E2E 작성**

`e2e/pages/chat-channel-crud.spec.ts` 하단에 describe 추가:

```ts
test.describe('messaging 채널 탐색·참여', () => {
  test('탐색 모달 → 검색 결과 → 참여 → 목록 무효화', async ({ authenticatedPage: page }) => {
    // 사이드바: 처음엔 내 채널 없음. 참여 후 GET /channels 가 새 채널 포함하도록 토글.
    let joined = false
    const target = createChannel({ id: 30, name: '공개방', visibility: 'PUBLIC', member: false, role: null })
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const body = joined ? [{ ...target, member: true, role: 'MEMBER' }] : []
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
    )
    // GET /channels/discover — 검색 결과.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/discover',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([target]) })
      },
    )
    // POST /channels/30/join — 204 + 이후 사이드바 반영 토글.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/30/join',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        joined = true
        return route.fulfill({ status: 204 })
      },
    )

    await page.goto('/chat')
    await page.getByTestId('channel-browse-btn').click()
    await expect(page.getByTestId('channel-browser')).toBeVisible()
    await page.getByTestId('channel-browser-join-30').click()
    // 참여 후 사이드바에 등장.
    await expect(page.getByTestId('channel-link-30')).toBeVisible()
  })
})
```

- [ ] **Step 2: E2E 실행 → 실패 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts -g "탐색"`
Expected: FAIL (`channel-browser` 안 보임 — 스텁이 null).

- [ ] **Step 3: ChannelBrowser 구현**

`src/components/chat/ChannelBrowser.tsx` 전체 교체:

```tsx
// 공개 채널 탐색 모달 — q 검색 + 결과 목록. 비멤버엔 "참여". 비공개는 서버 미반환.
import { Hash } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDiscoverChannels } from '@/hooks/queries/useDiscoverChannels'
import { useJoinChannel } from '@/hooks/queries/useJoinChannel'
import { useDebounceValue } from '@/hooks/useDebounceValue'

export function ChannelBrowser({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const debounced = useDebounceValue(query, 300)
  // 모달 열린 동안에만 검색 호출.
  const { data: channels, isLoading } = useDiscoverChannels(debounced, open)
  const join = useJoinChannel()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channel-browser">
        <DialogHeader>
          <DialogTitle>채널 탐색</DialogTitle>
        </DialogHeader>
        <Input
          data-testid="channel-browser-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="채널 이름으로 검색"
          aria-label="채널 검색"
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {isLoading && <div className="px-1 text-sm text-muted-foreground">불러오는 중…</div>}
          {channels?.length === 0 && (
            <div className="px-1 py-4 text-sm text-muted-foreground">공개 채널이 없어요.</div>
          )}
          {channels?.map((c) => (
            <div
              key={c.id}
              data-testid={`channel-browser-row-${c.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
            >
              <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.memberCount}명</span>
              {c.member ? (
                <span className="text-xs text-muted-foreground">참여 중</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`channel-browser-join-${c.id}`}
                  disabled={join.isPending}
                  onClick={() => join.mutate(c.id)}
                >
                  참여
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> `useDebounceValue` 는 `src/hooks/useDebounceValue.ts` 에 존재(MemberSearchPopover 가 사용). import 경로 확인.

- [ ] **Step 4: 탐색 E2E 통과 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts`
Expected: PASS (생성 3 + 탐색 1).

- [ ] **Step 5: typecheck + lint**

Run: `pnpm -C apps/workplace-web typecheck && pnpm -C apps/workplace-web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/src/components/chat/ChannelBrowser.tsx \
        apps/workplace-web/e2e/pages/chat-channel-crud.spec.ts
git commit -m "feat(web): 공개 채널 탐색 모달 + 참여"
```

---

## Task 5: 채널 헤더(이름변경·아카이브·삭제) + composer 아카이브 비활성 (수직 슬라이스)

`ChannelPage` 에 헤더를 합성하고, 비공개 비멤버 404 처리, 아카이브 시 composer 비활성을 구현한다.

**Files:**
- Create: `src/components/chat/ChannelHeader.tsx`
- Create: `src/components/chat/RenameChannelModal.tsx`
- Modify: `src/components/chat/MessageComposer.tsx`
- Modify: `src/pages/chat/ChannelPage.tsx`
- Modify: `e2e/pages/chat-channel-crud.spec.ts` (아카이브/404 describe 추가)

- [ ] **Step 1: 아카이브·404 E2E 작성**

`e2e/pages/chat-channel-crud.spec.ts` 하단에 추가. `me` 의 시스템 역할이 필요한 삭제는 `adminPage` fixture 사용:

```ts
async function stubChannelView(
  page: Page,
  channel: ReturnType<typeof createChannel>,
  status = 200,
) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return status === 200
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: '채널을 찾을 수 없습니다' }) })
    },
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test.describe('messaging 채널 헤더·아카이브', () => {
  test('아카이브 채널 → composer 비활성 + 안내', async ({ authenticatedPage: page }) => {
    const archived = createChannel({ id: 40, name: '보관됨', archived: true, role: 'OWNER', member: true })
    await stubChannelView(page, archived)
    await page.goto('/chat/channels/40')
    await expect(page.getByTestId('channel-archived-badge')).toBeVisible()
    await expect(page.getByTestId('message-composer-input')).toBeDisabled()
    await expect(page.getByText('이 채널은 보관되었습니다')).toBeVisible()
  })

  test('OWNER → 설정에서 이름 변경', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: 41, name: '구이름', role: 'OWNER', member: true })
    await stubChannelView(page, ch)
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/41',
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const payload = route.request().postDataJSON() as { name: string }
        expect(payload).toEqual({ name: '새이름' })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ch, name: '새이름' }) })
      },
    )
    await page.goto('/chat/channels/41')
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-rename-action').click()
    await page.getByTestId('rename-channel-name').fill('새이름')
    await page.getByTestId('rename-channel-submit').click()
    await expect(page.getByTestId('channel-header-name')).toHaveText('새이름')
  })

  test('MEMBER 에게는 설정 버튼 미노출', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: 42, name: '일반방', role: 'MEMBER', member: true })
    await stubChannelView(page, ch)
    await page.goto('/chat/channels/42')
    await expect(page.getByTestId('channel-header')).toBeVisible()
    await expect(page.getByTestId('channel-settings-btn')).toHaveCount(0)
  })

  test('비공개 비멤버 접근(404) → 채널 없음', async ({ authenticatedPage: page }) => {
    const ghost = createChannel({ id: 43, name: '비밀', visibility: 'PRIVATE' })
    await stubChannelView(page, ghost, 404)
    await page.goto('/chat/channels/43')
    await expect(page.getByTestId('channel-not-found')).toBeVisible()
  })

  test('시스템 ADMIN → 채널 삭제 → /chat 이동', async ({ adminPage: page }) => {
    const ch = createChannel({ id: 44, name: '삭제대상', role: 'MEMBER', member: true })
    await stubChannelView(page, ch)
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/44',
      (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 204 }) : route.fallback()),
    )
    await page.goto('/chat/channels/44')
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-delete-action').click()
    // DeleteConfirmDialog 확인 버튼 (실제 testid 는 구현에서 확정).
    await page.getByTestId('channel-delete-confirm').click()
    await expect(page).toHaveURL(/\/chat$/)
  })
})
```

> `adminPage` fixture 는 `auth.fixture.ts` 에 존재(ADMIN roles). 시스템 ADMIN 판정은 프론트에서 `useAuth().user.roles` 로 한다 — 구현 시 기존 ADMIN 판정 헬퍼(`AdminRoute` 가 쓰는 방식) 재사용.

- [ ] **Step 2: E2E 실행 → 실패 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts -g "헤더"`
Expected: FAIL.

- [ ] **Step 3: MessageComposer 에 disabled 추가**

`src/components/chat/MessageComposer.tsx` 교체:

```tsx
// 메시지 작성기 — Enter 전송(Shift+Enter 줄바꿈). 아카이브 채널이면 비활성 + 안내.
import { useState } from 'react'

import { Textarea } from '@/components/ui/textarea'

export function MessageComposer({
  onSend,
  disabled = false,
}: {
  onSend: (body: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')

  const submit = () => {
    const body = value.trim()
    if (!body) return
    onSend(body)
    setValue('')
  }

  if (disabled) {
    return (
      <div className="border-t p-3 text-center text-sm text-muted-foreground">
        이 채널은 보관되었습니다.
      </div>
    )
  }

  return (
    <div className="border-t p-3">
      <Textarea
        data-testid="message-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="메시지를 입력하세요"
        rows={2}
      />
    </div>
  )
}
```

> 주의: E2E 는 `message-composer-input` 이 **disabled** 인 걸 검증한다. 위 구현은 아카이브 시 textarea 를 아예 렌더하지 않으므로 `toBeDisabled()` 가 실패한다. **대신 textarea 를 렌더하되 `disabled` 속성을 주고 안내를 함께 노출**하도록 수정:

```tsx
  return (
    <div className="border-t p-3">
      {disabled && (
        <p className="mb-2 text-sm text-muted-foreground">이 채널은 보관되었습니다</p>
      )}
      <Textarea
        data-testid="message-composer-input"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={disabled ? '보관된 채널입니다' : '메시지를 입력하세요'}
        rows={2}
      />
    </div>
  )
```

위 블록을 최종 구현으로 사용하고, 앞의 `if (disabled) return` 분기는 **쓰지 않는다**.

- [ ] **Step 4: RenameChannelModal 구현**

`src/components/chat/RenameChannelModal.tsx`:

```tsx
// 채널 이름 변경 모달. 현재 이름을 기본값으로. 성공 시 닫힘(상세 무효화로 헤더 갱신).
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useRenameChannel } from '@/hooks/queries/useChannelMutations'

export function RenameChannelModal({
  channelId,
  currentName,
  open,
  onOpenChange,
}: {
  channelId: number
  currentName: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState(currentName)
  const rename = useRenameChannel(channelId)

  // 모달 열릴 때 현재 이름으로 초기화.
  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await rename.mutateAsync(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rename-channel-modal">
        <DialogHeader>
          <DialogTitle>채널 이름 변경</DialogTitle>
        </DialogHeader>
        <Input
          data-testid="rename-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <DialogFooter>
          <Button
            data-testid="rename-channel-submit"
            disabled={!name.trim() || rename.isPending}
            onClick={() => void submit()}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: ChannelHeader 구현**

먼저 시스템 ADMIN 판정 방식 확인:

Run: `grep -rn "roles\|ADMIN" apps/workplace-web/src/components/AdminRoute.tsx`
Expected: `user.roles?.some(r => r === 'ADMIN' ...)` 형태. 그 패턴을 그대로 사용.

`src/components/chat/ChannelHeader.tsx`:

```tsx
// 채널 헤더 — 이름·멤버수·아카이브 뱃지. 설정 드롭다운(OWNER/ADMIN: 이름변경·아카이브/해제),
// 멤버 버튼, 시스템 ADMIN: 삭제. 권한 없는 액션은 렌더하지 않는다(1차 방어).
import { ChevronDown, Lock, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useArchiveChannel,
  useDeleteChannel,
  useUnarchiveChannel,
} from '@/hooks/queries/useChannelMutations'
import { useAuth } from '@/hooks/useAuth'
import type { ChannelResponse } from '@/types/messaging'

export function ChannelHeader({
  channel,
  onOpenMembers,
  onOpenRename,
}: {
  channel: ChannelResponse
  onOpenMembers: () => void
  onOpenRename: () => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const archive = useArchiveChannel(channel.id)
  const unarchive = useUnarchiveChannel(channel.id)
  const del = useDeleteChannel()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const canManage = channel.role === 'OWNER' || channel.role === 'ADMIN'
  // 시스템 ADMIN — AdminRoute 와 동일 판정.
  const isSystemAdmin = (user?.roles ?? []).includes('ADMIN')

  return (
    <div
      className="flex items-center gap-2 border-b px-4 py-2.5"
      data-testid="channel-header"
    >
      {channel.visibility === 'PRIVATE' && <Lock className="h-4 w-4 text-muted-foreground" />}
      <span className="font-semibold" data-testid="channel-header-name">
        {channel.name}
      </span>
      {channel.archived && (
        <Badge variant="secondary" data-testid="channel-archived-badge">
          보관됨
        </Badge>
      )}
      <button
        type="button"
        className="ml-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="channel-members-btn"
        onClick={onOpenMembers}
      >
        <Users className="h-4 w-4" />
        <span data-testid="channel-header-membercount">{channel.memberCount}</span>
      </button>

      {(canManage || isSystemAdmin) && (
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" data-testid="channel-settings-btn">
                설정 <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && (
                <>
                  <DropdownMenuItem
                    data-testid="channel-rename-action"
                    onClick={onOpenRename}
                  >
                    이름 변경
                  </DropdownMenuItem>
                  {channel.archived ? (
                    <DropdownMenuItem
                      data-testid="channel-unarchive-action"
                      onClick={() => unarchive.mutate()}
                    >
                      보관 해제
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      data-testid="channel-archive-action"
                      onClick={() => archive.mutate()}
                    >
                      보관
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {isSystemAdmin && (
                <>
                  {canManage && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    data-testid="channel-delete-action"
                    className="text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    채널 삭제
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <DeleteConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="채널 삭제"
        description="채널과 모든 메시지가 영구 삭제됩니다. 되돌릴 수 없습니다."
        confirmTestId="channel-delete-confirm"
        onConfirm={async () => {
          await del.mutateAsync(channel.id)
          navigate('/chat')
        }}
      />
    </div>
  )
}
```

> **검증 필요**: `DeleteConfirmDialog` 의 실제 props 시그니처를 확인하고 맞춘다.
> Run: `sed -n '1,60p' apps/workplace-web/src/components/ui/delete-confirm-dialog.tsx`
> props 가 다르면(예: `confirmTestId` 미지원) 컴포넌트 호출을 실제 시그니처에 맞춰 수정하고, 확인 버튼의 testid 를 그 컴포넌트가 제공하는 것으로 E2E(`channel-delete-confirm`)도 일치시킨다.

- [ ] **Step 6: ChannelPage 합성 (헤더 + 404 + composer 비활성)**

`src/pages/chat/ChannelPage.tsx` 교체:

```tsx
// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { ChannelHeader } from '@/components/chat/ChannelHeader'
import { ChannelMembersPanel } from '@/components/chat/ChannelMembersPanel'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { RenameChannelModal } from '@/components/chat/RenameChannelModal'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useAuth } from '@/hooks/useAuth'
import type { UserKind } from '@/types/messaging'

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const detail = useChannelDetail(channelId)
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []
  const [membersOpen, setMembersOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(channelId ?? 0, me)

  // 비공개 비멤버 등 404 → 존재 은닉(채널 없음 안내).
  if (detail.isError) {
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        data-testid="channel-not-found"
      >
        채널을 찾을 수 없습니다.
      </div>
    )
  }

  if (!detail.data) {
    return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>
  }

  const channel = detail.data
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader
        channel={channel}
        onOpenMembers={() => setMembersOpen(true)}
        onOpenRename={() => setRenameOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <MessageComposer
        disabled={channel.archived}
        onSend={(body) => create.mutate({ body })}
      />
      <RenameChannelModal
        channelId={channel.id}
        currentName={channel.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ChannelMembersPanel
        channelId={channel.id}
        myRole={channel.role}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
    </div>
  )
}
```

> `ChannelMembersPanel` 은 T6 에서 구현. T5 컴파일을 위해 **임시 스텁**을 만든다 (Step 7).

- [ ] **Step 7: ChannelMembersPanel 임시 스텁**

`src/components/chat/ChannelMembersPanel.tsx`:

```tsx
// 채널 멤버 패널 — T6 에서 구현. 현재는 컴파일용 스텁.
import type { ChannelRole } from '@/types/messaging'

export function ChannelMembersPanel({
  channelId,
  myRole,
  open,
  onOpenChange,
}: {
  channelId: number
  myRole: ChannelRole | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  void channelId
  void myRole
  void open
  void onOpenChange
  return null
}
```

- [ ] **Step 8: 헤더/아카이브/404 E2E 통과 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-channel-crud.spec.ts`
Expected: PASS (전체).

만약 `me.roles` 형태가 달라 시스템 ADMIN 판정이 안 되면(삭제 테스트 실패), Step 5 의 `isSystemAdmin` 을 실제 형태로 수정.

- [ ] **Step 9: typecheck + lint**

Run: `pnpm -C apps/workplace-web typecheck && pnpm -C apps/workplace-web lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/workplace-web/src/components/chat/ChannelHeader.tsx \
        apps/workplace-web/src/components/chat/RenameChannelModal.tsx \
        apps/workplace-web/src/components/chat/MessageComposer.tsx \
        apps/workplace-web/src/components/chat/ChannelMembersPanel.tsx \
        apps/workplace-web/src/pages/chat/ChannelPage.tsx \
        apps/workplace-web/e2e/pages/chat-channel-crud.spec.ts
git commit -m "feat(web): 채널 헤더(이름변경·아카이브·삭제) + 아카이브 composer 비활성"
```

---

## Task 6: 멤버 패널 (역할·소유권이전·초대·나가기) (수직 슬라이스)

T5 의 `ChannelMembersPanel` 스텁을 본 구현으로 교체. `MemberSearchPopover` 재사용으로 추가, 제거, 역할 드롭다운(OWNER만, 소유권이전 포함), 나가기. 2-유저 비공개 초대는 mock 응답 교체로 검증.

**Files:**
- Modify: `src/components/chat/ChannelMembersPanel.tsx`
- Create: `e2e/pages/chat-members.spec.ts`

- [ ] **Step 1: 멤버 E2E 작성**

`e2e/pages/chat-members.spec.ts`:

```ts
// messaging 멤버 패널 E2E — 초대/역할/소유권이전/나가기. 백엔드 없이 mock.
// 2-유저 시나리오는 별도 page.route 응답 교체로 모사(실제 2세션 아님).
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { createChannel, createChannelMember } from '../factories/messaging.factory'

const CID = 50

async function stubBase(page: Page, channel: ReturnType<typeof createChannel>) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test.describe('messaging 멤버 패널', () => {
  test('OWNER → 멤버 목록 + 역할 뱃지', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true, memberCount: 2 })
    await stubBase(page, ch)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([
                createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
                createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' }),
              ]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await expect(page.getByTestId('channel-members-panel')).toBeVisible()
    await expect(page.getByTestId('member-row-2')).toContainText('동료')
    await expect(page.getByTestId('member-role-1')).toContainText('OWNER')
  })

  test('OWNER → 멤버 제거', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    await stubBase(page, ch)
    let removed = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const members = removed
          ? [createChannelMember({ userId: 1, name: '나', role: 'OWNER' })]
          : [
              createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
              createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' }),
            ]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
      },
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members/2`,
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback()
        removed = true
        return route.fulfill({ status: 204 })
      },
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await page.getByTestId('member-remove-2').click()
    await expect(page.getByTestId('member-row-2')).toHaveCount(0)
  })

  test('비공개 초대 — OWNER 가 검색해서 추가(POST payload 검증)', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, visibility: 'PRIVATE', role: 'OWNER', member: true })
    await stubBase(page, ch)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([createChannelMember({ userId: 1, name: '나', role: 'OWNER' })]) })
        }
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON() as { userId: number }
          expect(payload).toEqual({ userId: 2 })
          return route.fulfill({ status: 204 })
        }
        return route.fallback()
      },
    )
    // 멤버 검색 GET /users?search=
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ content: [{ id: 2, name: '동료', username: 'colleague', email: 'c@x.com', kind: 'HUMAN', roles: [] }], totalElements: 1, totalPages: 1, number: 0, size: 20 }),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await page.getByTestId('member-add-trigger').click()
    await page.getByLabel('멤버 검색').fill('동료')
    await page.getByTestId('member-search-row-2').click()
    // POST 가 호출되어 payload 검증을 통과하면 성공 (위 expect).
  })

  test('B(비초대 전) 재진입 후 채널 보임 — 초대 반영 모사', async ({ authenticatedPage: page }) => {
    // B 관점: 처음 GET /channels 빈 목록 → 페이지엔 사이드바만. 초대 반영본을 직접 stub.
    const ch = createChannel({ id: CID, visibility: 'PRIVATE', member: true, role: 'MEMBER' })
    await stubBase(page, ch)
    await page.goto('/chat')
    await expect(page.getByTestId('channel-link-50')).toBeVisible()
    await expect(page.getByTestId('channel-lock-50')).toBeVisible()
  })

  test('OWNER 소유권 이전 후 나가기', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    await stubBase(page, ch)
    let transferred = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const members = [
          createChannelMember({ userId: 1, name: '나', role: transferred ? 'ADMIN' : 'OWNER' }),
          createChannelMember({ userId: 2, name: '동료', role: transferred ? 'OWNER' : 'MEMBER' }),
        ]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
      },
    )
    // PATCH role:OWNER → 소유권 이전.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members/2`,
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const payload = route.request().postDataJSON() as { role: string }
        expect(payload).toEqual({ role: 'OWNER' })
        transferred = true
        return route.fulfill({ status: 204 })
      },
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/leave`,
      (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.fallback()),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    // 동료(2)를 OWNER 로 — 역할 select 사용.
    await page.getByTestId('member-role-select-2').selectOption('OWNER')
    await expect(page.getByTestId('member-role-2')).toContainText('OWNER')
    // 이제 나가기.
    await page.getByTestId('channel-leave-btn').click()
    await page.getByTestId('channel-leave-confirm').click()
    await expect(page).toHaveURL(/\/chat$/)
  })
})
```

> 역할 select 는 네이티브 `<select>` 로 구현해 `selectOption` 이 동작하도록 한다(shadcn Select 는 Radix 라 `selectOption` 미동작). 나가기 확인은 `DeleteConfirmDialog` 패턴 또는 간단 confirm 다이얼로그 — Step 3 에서 `channel-leave-confirm` testid 제공.

- [ ] **Step 2: E2E 실행 → 실패 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-members.spec.ts`
Expected: FAIL (`channel-members-panel` 없음).

- [ ] **Step 3: ChannelMembersPanel 구현**

`src/components/chat/ChannelMembersPanel.tsx` 전체 교체:

```tsx
// 채널 멤버 패널 — 멤버 목록(역할 뱃지), MemberSearchPopover 재사용 추가, 제거,
// 역할 변경(OWNER만, role:OWNER 지정 시 소유권 이전), 나가기.
// 권한별 액션 노출: OWNER = 전체, ADMIN = 추가/제거, MEMBER = 보기+나가기.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useLeaveChannel } from '@/hooks/queries/useChannelMutations'
import {
  useAddMember,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/hooks/queries/useMemberMutations'
import { useAuth } from '@/hooks/useAuth'
import { MemberSearchPopover } from '@/pages/projects/components/MemberSearchPopover'
import type { ChannelRole } from '@/types/messaging'

const ROLES: ChannelRole[] = ['OWNER', 'ADMIN', 'MEMBER']

export function ChannelMembersPanel({
  channelId,
  myRole,
  open,
  onOpenChange,
}: {
  channelId: number
  myRole: ChannelRole | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  // 패널 열린 동안에만 멤버 조회.
  const { data: members } = useChannelMembers(channelId, open)
  const addMember = useAddMember(channelId)
  const removeMember = useRemoveMember(channelId)
  const updateRole = useUpdateMemberRole(channelId)
  const leave = useLeaveChannel()
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const isOwner = myRole === 'OWNER'
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN'
  const existingIds = useMemo(
    () => new Set((members ?? []).map((m) => m.userId)),
    [members],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channel-members-panel">
        <DialogHeader>
          <DialogTitle>멤버</DialogTitle>
        </DialogHeader>

        {canManage && (
          <MemberSearchPopover
            open={searchOpen}
            onOpenChange={setSearchOpen}
            existingMemberIds={existingIds}
            onSelect={(u) => addMember.mutate(u.id)}
            trigger={
              <Button size="sm" variant="outline" data-testid="member-add-trigger">
                멤버 추가
              </Button>
            }
          />
        )}

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {members?.map((m) => {
            const isSelf = m.userId === user?.id
            return (
              <div
                key={m.userId}
                data-testid={`member-row-${m.userId}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="flex-1 truncate">{m.name}</span>
                {/* OWNER 는 역할 변경 가능(본인 제외 — 본인 강등은 소유권이전으로만). */}
                {isOwner && !isSelf ? (
                  <select
                    data-testid={`member-role-select-${m.userId}`}
                    value={m.role}
                    onChange={(e) =>
                      updateRole.mutate({
                        userId: m.userId,
                        role: e.target.value as ChannelRole,
                      })
                    }
                    className="rounded border bg-background px-1 py-0.5 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary" data-testid={`member-role-${m.userId}`}>
                    {m.role}
                  </Badge>
                )}
                {canManage && !isSelf && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`member-remove-${m.userId}`}
                    onClick={() => removeMember.mutate(m.userId)}
                  >
                    제거
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        <Button
          size="sm"
          variant="destructive"
          data-testid="channel-leave-btn"
          onClick={() => setConfirmLeave(true)}
        >
          채널 나가기
        </Button>

        <DeleteConfirmDialog
          open={confirmLeave}
          onOpenChange={setConfirmLeave}
          title="채널 나가기"
          description="이 채널에서 나갑니다. 비공개 채널은 다시 초대받아야 참여할 수 있어요."
          confirmTestId="channel-leave-confirm"
          onConfirm={async () => {
            await leave.mutateAsync(channelId)
            navigate('/chat')
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
```

> `DeleteConfirmDialog` props 는 T5 Step 5 에서 확인한 실제 시그니처에 맞춘다(`confirmTestId` 미지원이면 그 컴포넌트의 확인 버튼 testid 로 E2E 의 `channel-leave-confirm`/`channel-delete-confirm` 을 교체). `MemberSearchPopover` 의 `onSelect` 는 `UserResponse` 를 받으므로 `u.id` 사용 — props 그대로 호환.

- [ ] **Step 4: 멤버 E2E 통과 확인**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat-members.spec.ts`
Expected: PASS (5개).

소유권 이전 테스트에서 `member-role-2` 뱃지 검증이 실패하면: OWNER 가 본인을 ADMIN 으로 강등당한 뒤(transferred=true) 본인(userId 1)은 더 이상 OWNER 가 아니므로 select 가 사라지고, 동료(2)는 이제 OWNER 가 되어 본인이 아닌 OWNER → select 노출(뱃지 아님)일 수 있다. 이 경우 E2E 검증을 `member-role-select-2` 의 value 가 `OWNER` 인지로 조정하거나, 멤버 목록 재조회가 myRole(채널 상세) 무효화로 갱신되도록 `detail` 무효화가 select/뱃지 분기를 바꾸는 점을 반영. 구현·테스트를 일치시키되 **소유권 이전 PATCH payload `{role:'OWNER'}` 와 후속 leave 204 로 /chat 이동**이 핵심 검증임을 유지.

- [ ] **Step 5: typecheck + lint**

Run: `pnpm -C apps/workplace-web typecheck && pnpm -C apps/workplace-web lint`
Expected: PASS.

- [ ] **Step 6: 전체 messaging E2E 회귀**

Run: `pnpm -C apps/workplace-web test:e2e e2e/pages/chat.spec.ts e2e/pages/chat-channel-crud.spec.ts e2e/pages/chat-members.spec.ts`
Expected: PASS (전부).

- [ ] **Step 7: Commit**

```bash
git add apps/workplace-web/src/components/chat/ChannelMembersPanel.tsx \
        apps/workplace-web/e2e/pages/chat-members.spec.ts
git commit -m "feat(web): 채널 멤버 패널(역할·소유권이전·초대·나가기)"
```

---

## Self-Review (작성자 체크)

**1. Spec coverage** (스펙 프론트엔드 섹션 대비):
- 타입 확장 → T1 ✅
- API 11개 + createChannel 확장 → T1 ✅
- 훅 13개(useMyChannels~useUpdateMemberRole) → T2 ✅
- ChannelSidebar 개편(내 채널·생성·탐색·자물쇠) → T3 ✅
- CreateChannelModal → T3 ✅
- ChannelBrowser → T4 ✅
- ChannelHeader(이름·멤버수·설정·삭제·아카이브뱃지) → T5 ✅
- MessageComposer 아카이브 비활성 → T5 ✅
- ChannelMembersPanel(역할·이전·추가·제거·나가기) → T6 ✅
- 데이터 흐름(생성→라우팅, 탐색→참여, 비공개초대, 소유권이전→나가기, 아카이브→숨김) → T3~T6 ✅
- 에러처리(403 숨김+토스트, 409 아카이브, 409 OWNER나가기, 404 은닉) → 훅 onError(T2) + ChannelPage 404(T5) + composer 비활성(T5) ✅
- E2E(공개/비공개 생성, 탐색·참여, 2-유저 비공개, 아카이브 숨김+composer, 나가기) → T3,T4,T5,T6 ✅

**2. Placeholder scan**: T3 Step 1 두 번째 테스트에 임시 placeholder body 가 있으나 같은 step 의 인용 블록에서 실제 JSON 으로 교체하도록 명시함. 구현자는 반드시 교체할 것.

**3. Type consistency**: `ChannelRole`/`ChannelVisibility`/`ChannelResponse`(role/archived/memberCount)/`ChannelMemberResponse`(userId/name/kind/role/joinedAt) 가 T1 정의와 T5/T6 사용처에서 일치. 훅 시그니처(`useRenameChannel(id)→mutate(name)`, `useUpdateMemberRole(id)→mutate({userId,role})`, `useDeleteChannel()→mutate(id)`, `useLeaveChannel()→mutate(id)`)가 컴포넌트 호출과 일치.

**미해결 위험(구현 중 확인 필요, 플랜에 명시됨)**:
- `DeleteConfirmDialog` 실제 props (T5 Step5, T6 Step3 에서 확인·정합).
- 시스템 ADMIN 판정 `user.roles` 형태 (T5 Step5 에서 grep 확인).
- shadcn `Switch`/`Label` 존재 (T3 Step3).
- 소유권 이전 후 select/뱃지 분기 (T6 Step4 에서 구현·테스트 일치).
