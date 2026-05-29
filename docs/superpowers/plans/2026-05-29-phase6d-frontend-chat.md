# Phase 6d — 프론트 chat panel (REST 폴링 MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 상세 페이지 본문 아래 inline chat section 을 추가, REST + visible-only 5초 폴링 기반으로 thread 조회·메시지 작성/수정/삭제·@mention typeahead·mark-as-read 를 구현한다.

**Architecture:** 6a 백엔드의 7개 REST endpoint 를 axios client + TanStack Query 로 연결. Optimistic update 로 작성 UX 보장. `IntersectionObserver` + `document.visibilityState` 로 폴링/mark-read 게이팅. 컴포넌트는 `src/pages/projects/components/chat/` 하위에 6개 파일로 분할. E2E 5케이스 `page.route()` 모킹.

**Tech Stack:** React 19 + TypeScript, TanStack Query v5 (useQuery / useInfiniteQuery / useMutation), shadcn/ui (Card, ScrollArea, Popover, Textarea, Button, Avatar, Badge), `sonner` toast, lucide-react 아이콘, Playwright E2E

**Spec:** `docs/superpowers/specs/2026-05-29-phase6d-frontend-chat-design.md`

---

## File Structure

### 새로 만들 파일
- `apps/workplace-web/src/types/chat.ts` — 백엔드 DTO 와 1:1 매칭 TS 타입
- `apps/workplace-web/src/api/chat.ts` — axios 기반 7개 endpoint 함수
- `apps/workplace-web/src/hooks/queries/chatKeys.ts` — TanStack Query key 헬퍼
- `apps/workplace-web/src/hooks/queries/useChatThread.ts` — thread getter (lazy)
- `apps/workplace-web/src/hooks/queries/useChatMessages.ts` — 메시지 페이징 + visible 폴링
- `apps/workplace-web/src/hooks/queries/useCreateChatMessage.ts` — 작성 (optimistic)
- `apps/workplace-web/src/hooks/queries/useUpdateChatMessage.ts` — 수정
- `apps/workplace-web/src/hooks/queries/useDeleteChatMessage.ts` — 삭제 (soft)
- `apps/workplace-web/src/hooks/queries/useMarkChatRead.ts` — 읽음 표시 (debounce)
- `apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx` — section 컨테이너
- `apps/workplace-web/src/pages/projects/components/chat/ChatMessageList.tsx` — 메시지 리스트 + 스크롤
- `apps/workplace-web/src/pages/projects/components/chat/ChatMessageRow.tsx` — 메시지 1건
- `apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx` — 인라인 수정 에디터
- `apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx` — 작성 폼
- `apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx` — @ typeahead popover
- `apps/workplace-web/src/pages/projects/components/chat/detectMention.ts` — 순수 함수 (mention 검출)
- `apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts` — vitest
- `apps/workplace-web/e2e/factories/chat.factory.ts` — E2E factory
- `apps/workplace-web/e2e/pages/projects/chat.spec.ts` — E2E 스펙

### 수정 파일
- `apps/workplace-web/src/pages/projects/IssueDetailPage.tsx` — `<IssueChatSection>` 추가

---

## Task 1: Chat 타입 정의 + E2E factory

**Files:**
- Create: `apps/workplace-web/src/types/chat.ts`
- Create: `apps/workplace-web/e2e/factories/chat.factory.ts`

- [ ] **Step 1: 타입 파일 작성**

`apps/workplace-web/src/types/chat.ts` 새로 작성:

```ts
// 6a 백엔드 ChatThread/Message/Member/Mention DTO 와 1:1 매칭.
// 모든 시간 필드는 ISO 8601 string. nullable 은 `... | null`.

export type UserKind = 'HUMAN' | 'AGENT';

export interface ChatMentionResponse {
  id: number;
  username: string;
  name: string;
  kind: UserKind;
}

export interface ChatMemberResponse {
  userId: number;
  username: string;
  name: string;
  kind: UserKind;
  lastReadMessageId: number | null;
  joinedAt: string;
}

export interface ChatMessageResponse {
  id: number;
  threadId: number;
  authorId: number;
  authorName: string;
  authorKind: UserKind;
  body: string;
  mentions: ChatMentionResponse[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ChatThreadResponse {
  threadId: number;
  issueId: number;
  archivedAt: string | null;
  members: ChatMemberResponse[];
  recentMessages: ChatMessageResponse[];
}

export interface ChatMessagePage {
  items: ChatMessageResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateChatMessageRequest {
  body: string;
}

export interface UpdateChatMessageRequest {
  body: string;
}

export interface MarkChatReadRequest {
  uptoMessageId: number;
}

export interface AddChatMemberRequest {
  userId: number;
}

// optimistic UI 용 — 음수 id 로 식별, 'pending' 동안에는 toolbar 미노출.
export interface OptimisticChatMessage extends ChatMessageResponse {
  status: 'pending' | 'sent' | 'error';
}
```

- [ ] **Step 2: E2E factory 작성**

`apps/workplace-web/e2e/factories/chat.factory.ts` 새로 작성:

```ts
// chat E2E 테스트용 factory.
// 단일 사용 패턴: createChatThread() / createChatMessage() 호출 시 sensible defaults + spread overrides.

import type {
  ChatMemberResponse,
  ChatMentionResponse,
  ChatMessagePage,
  ChatMessageResponse,
  ChatThreadResponse,
} from '../../src/types/chat';

const now = () => new Date().toISOString();

export function createChatMember(
  overrides: Partial<ChatMemberResponse> = {},
): ChatMemberResponse {
  return {
    userId: 1,
    username: 'testuser',
    name: '테스트 사용자',
    kind: 'HUMAN',
    lastReadMessageId: null,
    joinedAt: now(),
    ...overrides,
  };
}

export function createChatMention(
  overrides: Partial<ChatMentionResponse> = {},
): ChatMentionResponse {
  return {
    id: 1,
    username: 'testuser',
    name: '테스트 사용자',
    kind: 'HUMAN',
    ...overrides,
  };
}

export function createChatMessage(
  overrides: Partial<ChatMessageResponse> = {},
): ChatMessageResponse {
  return {
    id: 1,
    threadId: 100,
    authorId: 1,
    authorName: '테스트 사용자',
    authorKind: 'HUMAN',
    body: '안녕하세요',
    mentions: [],
    createdAt: now(),
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

export function createChatThread(
  overrides: Partial<ChatThreadResponse> = {},
): ChatThreadResponse {
  return {
    threadId: 100,
    issueId: 1,
    archivedAt: null,
    members: [createChatMember()],
    recentMessages: [],
    ...overrides,
  };
}

export function createChatMessagePage(
  items: ChatMessageResponse[] = [],
  nextCursor: string | null = null,
): ChatMessagePage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS (새 파일이 unused 이므로 통과해야 함)

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/types/chat.ts apps/workplace-web/e2e/factories/chat.factory.ts
git commit -m "feat(web): chat 타입 + E2E factory 추가 — #39 phase6d"
```

---

## Task 2: API client (`api/chat.ts`)

**Files:**
- Create: `apps/workplace-web/src/api/chat.ts`

- [ ] **Step 1: API 함수 작성**

`apps/workplace-web/src/api/chat.ts` 새로 작성. 기존 `api/issues.ts` 패턴(axios envelope 반환) 그대로:

```ts
// chat REST API client.
// 모든 함수는 axios envelope(AxiosResponse) 반환 — 호출처(query 훅)에서 .data unwrap.

import { client } from './client';
import type {
  AddChatMemberRequest,
  ChatMemberResponse,
  ChatMessagePage,
  ChatMessageResponse,
  ChatThreadResponse,
  CreateChatMessageRequest,
  MarkChatReadRequest,
  UpdateChatMessageRequest,
} from '../types/chat';

export const chatApi = {
  // 이슈에 묶인 thread getter — 백엔드가 lazy create.
  getThread: (projectKey: string, issueNumber: number) =>
    client.get<ChatThreadResponse>(
      `/projects/${projectKey}/issues/${issueNumber}/chat/thread`,
    ),

  // cursor 페이징 — cursor 없으면 최신부터 50건.
  getMessages: (threadId: number, cursor?: string, limit: number = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<ChatMessagePage>(
      `/chat/threads/${threadId}/messages?${params.toString()}`,
    );
  },

  createMessage: (threadId: number, payload: CreateChatMessageRequest) =>
    client.post<ChatMessageResponse>(
      `/chat/threads/${threadId}/messages`,
      payload,
    ),

  updateMessage: (messageId: number, payload: UpdateChatMessageRequest) =>
    client.patch<ChatMessageResponse>(
      `/chat/messages/${messageId}`,
      payload,
    ),

  deleteMessage: (messageId: number) =>
    client.delete<void>(`/chat/messages/${messageId}`),

  markRead: (threadId: number, payload: MarkChatReadRequest) =>
    client.post<void>(`/chat/threads/${threadId}/read`, payload),

  addMember: (threadId: number, payload: AddChatMemberRequest) =>
    client.post<ChatMemberResponse>(
      `/chat/threads/${threadId}/members`,
      payload,
    ),
};
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/api/chat.ts
git commit -m "feat(web): chat axios client 7 endpoints — #39 phase6d"
```

---

## Task 3: Query 키 헬퍼 + `useChatThread`

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/chatKeys.ts`
- Create: `apps/workplace-web/src/hooks/queries/useChatThread.ts`

- [ ] **Step 1: 키 헬퍼 작성**

`apps/workplace-web/src/hooks/queries/chatKeys.ts` 새로 작성:

```ts
// TanStack Query 키 네임스페이스.
// thread 는 issue 좌표(projectKey, issueNumber) 로 식별,
// messages 는 threadId 로 식별 (thread 응답을 받은 뒤에야 키가 결정됨).

export const chatKeys = {
  all: ['chat'] as const,
  thread: (projectKey: string, issueNumber: number) =>
    [...chatKeys.all, 'thread', projectKey, issueNumber] as const,
  messages: (threadId: number) =>
    [...chatKeys.all, 'messages', threadId] as const,
};
```

- [ ] **Step 2: `useChatThread` 작성**

`apps/workplace-web/src/hooks/queries/useChatThread.ts` 새로 작성:

```ts
// 이슈 chat thread getter.
// 백엔드가 thread 가 없으면 자동 생성하므로 GET 한 번으로 끝남.
// staleTime 30s — thread 자체는 거의 안 변하지만 멤버 변경(자동 add)이 있을 수 있어 적당히 짧게.

import { useQuery } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import { chatKeys } from './chatKeys';

export function useChatThread(projectKey: string, issueNumber: number) {
  return useQuery({
    queryKey: chatKeys.thread(projectKey, issueNumber),
    queryFn: () => chatApi.getThread(projectKey, issueNumber).then((r) => r.data),
    enabled: !!projectKey && Number.isFinite(issueNumber),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/hooks/queries/chatKeys.ts apps/workplace-web/src/hooks/queries/useChatThread.ts
git commit -m "feat(web): chat 쿼리 키 헬퍼 + useChatThread — #39 phase6d"
```

---

## Task 4: `useChatMessages` — infinite query + visible 폴링

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useChatMessages.ts`

- [ ] **Step 1: hook 작성**

`apps/workplace-web/src/hooks/queries/useChatMessages.ts` 새로 작성:

```ts
// chat 메시지 cursor 페이징 + 5초 visible 폴링.
// 폴링은 visible 조건이 모두 충족될 때만 enabled.
// initialData 는 ChatThread 응답의 recentMessages 로 호출처에서 seeded.

import { useInfiniteQuery } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type { ChatMessagePage } from '../../types/chat';
import { chatKeys } from './chatKeys';

interface UseChatMessagesOptions {
  threadId: number | undefined;
  // section in viewport AND document.visible 일 때 true.
  pollingEnabled: boolean;
  // 초기 시드. 첫 페이지를 thread 응답의 recentMessages 로 채울 때 사용.
  initialFirstPage?: ChatMessagePage;
}

export function useChatMessages({
  threadId,
  pollingEnabled,
  initialFirstPage,
}: UseChatMessagesOptions) {
  return useInfiniteQuery<ChatMessagePage>({
    queryKey: threadId ? chatKeys.messages(threadId) : ['chat', 'messages', 'idle'],
    enabled: Number.isFinite(threadId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      chatApi.getMessages(threadId!, pageParam as string | undefined).then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: pollingEnabled ? 5_000 : false,
    refetchIntervalInBackground: false,
    // 폴링이 켜질 때 백그라운드에서도 refetch — 화면 활성 직후 즉시 갱신.
    refetchOnWindowFocus: false,
    initialData: initialFirstPage
      ? { pages: [initialFirstPage], pageParams: [undefined] }
      : undefined,
  });
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/hooks/queries/useChatMessages.ts
git commit -m "feat(web): useChatMessages — infinite + visible 폴링 — #39 phase6d"
```

---

## Task 5: Mutation 훅 4종 (create/update/delete/markRead)

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/useCreateChatMessage.ts`
- Create: `apps/workplace-web/src/hooks/queries/useUpdateChatMessage.ts`
- Create: `apps/workplace-web/src/hooks/queries/useDeleteChatMessage.ts`
- Create: `apps/workplace-web/src/hooks/queries/useMarkChatRead.ts`

- [ ] **Step 1: `useCreateChatMessage` (optimistic) 작성**

`apps/workplace-web/src/hooks/queries/useCreateChatMessage.ts` 새로 작성:

```ts
// 메시지 작성 mutation + optimistic UI.
// 임시 메시지 id 는 음수 (UI 키로만 쓰임) — onSuccess 시 서버 응답 id 로 replace.
// onError 시 snapshot 복원 + toast.

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { chatApi } from '../../api/chat';
import type {
  ChatMessagePage,
  ChatMessageResponse,
  CreateChatMessageRequest,
  UserKind,
} from '../../types/chat';
import { handleApiError } from '../../lib/api-error';
import { chatKeys } from './chatKeys';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateChatMessage(threadId: number, me: MeContext) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateChatMessageRequest) =>
      chatApi.createMessage(threadId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = chatKeys.messages(threadId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<InfiniteData<ChatMessagePage>>(key);

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: ChatMessageResponse = {
        id: tempId,
        threadId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        mentions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const [first, ...rest] = old.pages;
        return {
          ...old,
          pages: [{ ...first, items: [...first.items, optimistic] }, ...rest],
        };
      });

      return { snapshot, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === ctx?.tempId ? saved : m)),
          })),
        };
      });
    },

    onError: (err, _payload, ctx) => {
      const key = chatKeys.messages(threadId);
      if (ctx?.snapshot) qc.setQueryData(key, ctx.snapshot);
      handleApiError(err, '메시지 전송에 실패했어요');
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(threadId) });
    },
  });
}
```

- [ ] **Step 2: `useUpdateChatMessage` 작성**

`apps/workplace-web/src/hooks/queries/useUpdateChatMessage.ts` 새로 작성:

```ts
// 메시지 수정 mutation. 성공 시 첫 페이지(또는 해당 페이지) 의 메시지를 직접 replace.
// 실패 시 toast — 캐시는 그대로 둔다 (사용자가 다시 시도 가능).

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type { ChatMessagePage, UpdateChatMessageRequest } from '../../types/chat';
import { handleApiError } from '../../lib/api-error';
import { chatKeys } from './chatKeys';

export function useUpdateChatMessage(threadId: number) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId, payload }: { messageId: number; payload: UpdateChatMessageRequest }) =>
      chatApi.updateMessage(messageId, payload).then((r) => r.data),

    onSuccess: (saved) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === saved.id ? saved : m)),
          })),
        };
      });
    },

    onError: (err) => {
      handleApiError(err, '메시지 수정에 실패했어요');
    },
  });
}
```

- [ ] **Step 3: `useDeleteChatMessage` 작성**

`apps/workplace-web/src/hooks/queries/useDeleteChatMessage.ts` 새로 작성:

```ts
// 메시지 soft-delete mutation. 성공 시 캐시의 해당 메시지 deleted=true, body='(삭제됨)' 처리.

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type { ChatMessagePage } from '../../types/chat';
import { handleApiError } from '../../lib/api-error';
import { chatKeys } from './chatKeys';

export function useDeleteChatMessage(threadId: number) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (messageId: number) => chatApi.deleteMessage(messageId).then(() => messageId),

    onSuccess: (messageId) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) =>
              m.id === messageId ? { ...m, deleted: true, body: '(삭제됨)' } : m,
            ),
          })),
        };
      });
    },

    onError: (err) => {
      handleApiError(err, '메시지 삭제에 실패했어요');
    },
  });
}
```

- [ ] **Step 4: `useMarkChatRead` 작성**

`apps/workplace-web/src/hooks/queries/useMarkChatRead.ts` 새로 작성:

```ts
// 읽음 표시 mutation. 호출처에서 useDebounceValue + IntersectionObserver 로 발화 제어.
// 응답 무시, 실패 시 silent — 다음 intersection 에서 재시도.

import { useMutation } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type { MarkChatReadRequest } from '../../types/chat';

export function useMarkChatRead(threadId: number) {
  return useMutation({
    mutationFn: (payload: MarkChatReadRequest) =>
      chatApi.markRead(threadId, payload).then(() => undefined),
  });
}
```

- [ ] **Step 5: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/src/hooks/queries/useCreateChatMessage.ts \
        apps/workplace-web/src/hooks/queries/useUpdateChatMessage.ts \
        apps/workplace-web/src/hooks/queries/useDeleteChatMessage.ts \
        apps/workplace-web/src/hooks/queries/useMarkChatRead.ts
git commit -m "feat(web): chat mutation 훅 4종 (create/update/delete/mark-read) — #39 phase6d"
```

---

## Task 6: `ChatMessageRow` — 메시지 1건 (정적 렌더)

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageRow.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`apps/workplace-web/src/pages/projects/components/chat/ChatMessageRow.tsx` 새로 작성:

```tsx
// chat 메시지 1건.
// AGENT 행은 좌측 보더(보라) + Bot 아이콘 + AgentBadge.
// 본인 메시지(canEdit) hover 시 toolbar 노출 — 실제 핸들러는 부모 ChatMessageList 에서 prop 으로 주입.
// deleted=true 면 body 가 '(삭제됨)' 으로 마스킹돼 들어옴.

import { Bot, Pencil, Trash2, User } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMessageResponse } from '../../../../types/chat';
import { formatChatTimestamp } from './formatChatTimestamp';

interface ChatMessageRowProps {
  message: ChatMessageResponse;
  canEdit: boolean;
  isPending?: boolean;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
}

export function ChatMessageRow({
  message,
  canEdit,
  isPending = false,
  onEdit,
  onDelete,
}: ChatMessageRowProps) {
  const isAgent = message.authorKind === 'AGENT';
  const showToolbar = canEdit && !message.deleted && !isPending;

  return (
    <li
      role="article"
      aria-label={`${message.authorName}: ${message.body.slice(0, 40)}`}
      data-testid={`chat-message-${message.id}`}
      data-agent={isAgent ? 'true' : undefined}
      data-pending={isPending ? 'true' : undefined}
      className={`group relative flex gap-2 px-3 py-2 ${
        isAgent ? 'border-l-2 border-purple-400' : ''
      } ${isPending ? 'opacity-60' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {isAgent ? (
          <Bot className="h-5 w-5 text-purple-600" aria-hidden />
        ) : (
          <User className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{message.authorName}</span>
          {isAgent && <AgentBadge size="xs" />}
          <span className="text-muted-foreground">
            {formatChatTimestamp(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-muted-foreground" aria-label="수정됨">
              (수정됨)
            </span>
          )}
        </div>
        <div
          className={`text-sm whitespace-pre-wrap break-words ${
            message.deleted ? 'italic text-muted-foreground' : ''
          }`}
          data-testid={`chat-message-body-${message.id}`}
        >
          {message.body}
        </div>
      </div>

      {showToolbar && (
        <div className="absolute right-2 top-1 hidden group-hover:flex gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="수정"
            data-testid={`chat-message-edit-${message.id}`}
            onClick={() => onEdit?.(message.id)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="삭제"
            data-testid={`chat-message-delete-${message.id}`}
            onClick={() => onDelete?.(message.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: 시간 포맷터 작성**

`apps/workplace-web/src/pages/projects/components/chat/formatChatTimestamp.ts` 새로 작성:

```ts
// chat 메시지 시간 표시: 오늘이면 HH:mm, 어제면 '어제 HH:mm', 그 외는 'M월 D일'.
// 시각 검증용으로만 사용 — 정확한 표시는 후속 polish 영역.

export function formatChatTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) {
    return `어제 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/
git commit -m "feat(web): ChatMessageRow + formatChatTimestamp — #39 phase6d"
```

---

## Task 7: `ChatMessageList` — 리스트 + 페이징 + mark-read 트리거

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`apps/workplace-web/src/pages/projects/components/chat/ChatMessageList.tsx` 새로 작성:

```tsx
// chat 메시지 스크롤 리스트.
// 최신이 아래(Slack 스타일). 위로 스크롤 시 fetchNextPage.
// 마지막 메시지가 viewport 진입하면 onMarkRead(lastId) 호출 — debounce 는 부모에서 처리.

import { useEffect, useMemo, useRef } from 'react';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { Button } from '../../../../components/ui/button';
import type { ChatMessageResponse } from '../../../../types/chat';
import { ChatMessageRow } from './ChatMessageRow';

interface ChatMessageListProps {
  messages: ChatMessageResponse[];
  currentUserId: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onMarkRead: (lastMessageId: number) => void;
  editingMessageId: number | null;
  renderEditor: (message: ChatMessageResponse) => React.ReactNode;
}

export function ChatMessageList({
  messages,
  currentUserId,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onEdit,
  onDelete,
  onMarkRead,
  editingMessageId,
  renderEditor,
}: ChatMessageListProps) {
  const lastRef = useRef<HTMLLIElement | null>(null);

  // 메시지가 createdAt 기준 오름차순이 되도록 한 번 정렬.
  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const lastId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;

  // 마지막 메시지 IO — viewport 진입 시 mark-read.
  useEffect(() => {
    const el = lastRef.current;
    if (!el || lastId === null || lastId < 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onMarkRead(lastId);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lastId, onMarkRead]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex h-32 items-center justify-center text-sm text-muted-foreground"
        data-testid="chat-empty"
      >
        아직 대화가 없어요. 첫 메시지를 남겨보세요.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[min(60vh,480px)] pr-2" data-testid="chat-message-list">
      <div className="flex flex-col">
        {hasMore && (
          <div className="flex justify-center py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onLoadMore}
              disabled={isFetchingMore}
              data-testid="chat-load-more"
            >
              {isFetchingMore ? '불러오는 중...' : '이전 메시지 더 보기'}
            </Button>
          </div>
        )}
        <ul>
          {sorted.map((m, idx) => {
            const isLast = idx === sorted.length - 1;
            const isEditing = editingMessageId === m.id;
            const isPending = m.id < 0;
            const canEdit = m.authorId === currentUserId;

            if (isEditing) {
              return (
                <li
                  key={m.id}
                  ref={isLast ? lastRef : undefined}
                  data-testid={`chat-message-${m.id}`}
                >
                  {renderEditor(m)}
                </li>
              );
            }
            return (
              <div key={m.id} ref={isLast ? (lastRef as unknown as React.Ref<HTMLDivElement>) : undefined}>
                <ChatMessageRow
                  message={m}
                  canEdit={canEdit}
                  isPending={isPending}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
        </ul>
      </div>
    </ScrollArea>
  );
}
```

(주의: 위 코드에서 `lastRef` 의 ref 분기 처리가 조금 거친데, `IssueChatSection` 통합 시 정리. 일단 IO 타깃이 마지막 행이면 충분.)

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/ChatMessageList.tsx
git commit -m "feat(web): ChatMessageList — 페이징 + mark-read IO — #39 phase6d"
```

---

## Task 8: `detectMention` 순수 함수 + vitest

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/detectMention.ts`
- Create: `apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts` 새로 작성:

```ts
import { describe, expect, it } from 'vitest';
import { detectMention } from '../detectMention';

describe('detectMention', () => {
  it('caret 직전 @abc 를 검출한다', () => {
    expect(detectMention('hello @abc')).toEqual({ query: 'abc', anchor: 6 });
  });

  it('문장 시작의 @ 도 검출한다', () => {
    expect(detectMention('@foo')).toEqual({ query: 'foo', anchor: 0 });
  });

  it('빈 query (@ 만 입력) 도 검출한다 — 전체 멤버 표시', () => {
    expect(detectMention('hi @')).toEqual({ query: '', anchor: 3 });
  });

  it('영문/숫자/.-_ 외 문자는 mention 토큰을 끊는다', () => {
    expect(detectMention('hi @foo bar')).toBeNull();
  });

  it('@ 앞이 글자면 mention 으로 보지 않는다 (email 등 오인 방지)', () => {
    expect(detectMention('a@bc')).toBeNull();
  });

  it('@ 가 전혀 없으면 null', () => {
    expect(detectMention('hello world')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter workplace-web vitest run src/pages/projects/components/chat/__tests__/detectMention.test.ts`
Expected: FAIL — `Cannot find module '../detectMention'`

- [ ] **Step 3: 함수 작성**

`apps/workplace-web/src/pages/projects/components/chat/detectMention.ts` 새로 작성:

```ts
// caret 직전 텍스트에서 마지막 @mention 토큰을 찾는다.
// 정규식: 문장 시작 또는 공백 뒤의 @ + [\w._-]{0,20}.
// 매치 끝이 입력 끝과 일치할 때만 active mention (사용자가 아직 타이핑 중).

export interface MentionDetection {
  query: string;
  anchor: number; // textBeforeCaret 안에서 '@' 의 인덱스
}

export function detectMention(textBeforeCaret: string): MentionDetection | null {
  const match = textBeforeCaret.match(/(?:^|\s)@([\w._-]{0,20})$/);
  if (!match) return null;
  const query = match[1];
  // 매치 전체는 prefix(공백) + '@' + query — '@' 위치는 끝에서 query.length + 1 만큼 앞.
  const anchor = textBeforeCaret.length - query.length - 1;
  return { query, anchor };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter workplace-web vitest run src/pages/projects/components/chat/__tests__/detectMention.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/detectMention.ts \
        apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts
git commit -m "feat(web): detectMention 순수 함수 + vitest — #39 phase6d"
```

---

## Task 9: `ChatMentionPopover` + `ChatComposer` (작성 + mention typeahead)

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx`
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx`

- [ ] **Step 1: `ChatMentionPopover` 작성**

`apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx` 새로 작성:

```tsx
// @mention typeahead 옵션 리스트.
// 키보드 이벤트는 부모(ChatComposer)에서 textarea onKeyDown 으로 처리,
// 여기서는 옵션 시각화 + 마우스 클릭만 담당.

import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMemberResponse } from '../../../../types/chat';

interface ChatMentionPopoverProps {
  members: ChatMemberResponse[];
  selectedIndex: number;
  onSelect: (member: ChatMemberResponse) => void;
  onHoverIndex: (idx: number) => void;
}

export function ChatMentionPopover({
  members,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: ChatMentionPopoverProps) {
  if (members.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="멘션 후보"
      className="absolute bottom-full left-0 mb-1 w-72 rounded-md border bg-popover shadow-md max-h-64 overflow-auto z-50"
      data-testid="chat-mention-popover"
    >
      {members.map((m, idx) => (
        <button
          type="button"
          key={m.userId}
          role="option"
          aria-selected={idx === selectedIndex}
          data-testid={`chat-mention-option-${m.userId}`}
          data-agent={m.kind === 'AGENT' ? 'true' : undefined}
          onMouseDown={(e) => {
            // mousedown 으로 처리 — click 은 textarea blur 가 먼저 발생해 popover 가 사라지는 경우 있음.
            e.preventDefault();
            onSelect(m);
          }}
          onMouseEnter={() => onHoverIndex(idx)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
            idx === selectedIndex ? 'bg-accent' : ''
          }`}
        >
          <span className="font-medium">{m.name}</span>
          <span className="text-muted-foreground">@{m.username}</span>
          {m.kind === 'AGENT' && <AgentBadge size="xs" />}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `ChatComposer` 작성**

`apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx` 새로 작성:

```tsx
// chat 메시지 작성 폼.
// Enter = 전송, Shift+Enter = 줄바꿈.
// '@' 입력 시 ChatMentionPopover 열림, ↑↓ Enter Tab 으로 선택.
// 전송은 onSubmit(body) 호출 — optimistic 처리는 부모(useCreateChatMessage)가 담당.

import { useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import type { ChatMemberResponse } from '../../../../types/chat';
import { ChatMentionPopover } from './ChatMentionPopover';
import { detectMention } from './detectMention';

interface ChatComposerProps {
  members: ChatMemberResponse[];
  onSubmit: (body: string) => void;
  disabled?: boolean;
}

export function ChatComposer({ members, onSubmit, disabled = false }: ChatComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filteredMembers = (() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    if (q === '') return members.slice(0, 8);
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q),
      )
      .slice(0, 8);
  })();

  function refreshMention() {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const det = detectMention(before);
    setMentionQuery(det?.query ?? null);
    setSelectedIdx(0);
  }

  function applyMention(member: ChatMemberResponse) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const det = detectMention(before);
    if (!det) return;
    const insertion = `@${member.username} `;
    const newBefore = before.slice(0, det.anchor) + insertion;
    const after = ta.value.slice(caret);
    const newValue = newBefore + after;
    setBody(newValue);
    setMentionQuery(null);
    // caret 위치 보정.
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = newBefore.length;
      taRef.current.setSelectionRange(pos, pos);
      taRef.current.focus();
    });
  }

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || disabled) return;
    onSubmit(trimmed);
    setBody('');
    setMentionQuery(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const popoverOpen = mentionQuery !== null && filteredMembers.length > 0;
    if (popoverOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(filteredMembers[selectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative flex gap-2 border-t p-3" data-testid="chat-composer">
      <Textarea
        ref={taRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          // change 가 먼저 발생하고 selection 이 그 직후 갱신되므로 RAF 후 검사.
          requestAnimationFrame(refreshMention);
        }}
        onKeyUp={refreshMention}
        onClick={refreshMention}
        onKeyDown={onKeyDown}
        placeholder="메시지 입력 (Shift+Enter 로 줄바꿈)"
        aria-label="채팅 메시지 작성"
        data-testid="chat-composer-input"
        rows={2}
        disabled={disabled}
        className="resize-none"
      />
      {mentionQuery !== null && (
        <ChatMentionPopover
          members={filteredMembers}
          selectedIndex={selectedIdx}
          onSelect={applyMention}
          onHoverIndex={setSelectedIdx}
        />
      )}
      <Button
        type="button"
        onClick={submit}
        disabled={disabled || body.trim().length === 0}
        data-testid="chat-composer-submit"
      >
        보내기
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx \
        apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx
git commit -m "feat(web): ChatComposer + ChatMentionPopover (Slack 스타일 @mention) — #39 phase6d"
```

---

## Task 10: `ChatMessageEditor` — 인라인 수정

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx` 새로 작성:

```tsx
// 본인 메시지 수정용 인라인 에디터.
// Enter = 저장, Esc = 취소, Shift+Enter = 줄바꿈.

import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';

interface ChatMessageEditorProps {
  initialBody: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}

export function ChatMessageEditor({ initialBody, onSave, onCancel }: ChatMessageEditorProps) {
  const [body, setBody] = useState(initialBody);

  function save() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || trimmed === initialBody.trim()) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2" data-testid="chat-message-editor">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label="메시지 수정"
        data-testid="chat-message-editor-input"
      />
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          data-testid="chat-message-editor-cancel"
        >
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          data-testid="chat-message-editor-save"
        >
          저장
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx
git commit -m "feat(web): ChatMessageEditor (인라인 수정) — #39 phase6d"
```

---

## Task 11: `IssueChatSection` — 컨테이너 + 폴링 게이팅 + mark-read 통합

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageList.tsx` (마지막 행 ref 정리)

- [ ] **Step 1: 폴링 게이트 훅 작성 (인라인)**

`IssueChatSection.tsx` 내부에 helper 훅 2개:

```tsx
// document.visibilityState 변화를 React state 로 노출.
function useIsPageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

// section root 가 viewport 안에 있는지 IntersectionObserver 로 추적.
function useInViewport(ref: React.RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}
```

- [ ] **Step 2: `IssueChatSection` 전체 작성**

`apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx` 새로 작성:

```tsx
// 이슈 상세 inline chat section.
// thread lazy fetch → messages infinite query (recentMessages seed) → polling/mark-read 게이팅.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useChatThread } from '../../../../hooks/queries/useChatThread';
import { useChatMessages } from '../../../../hooks/queries/useChatMessages';
import { useCreateChatMessage } from '../../../../hooks/queries/useCreateChatMessage';
import { useUpdateChatMessage } from '../../../../hooks/queries/useUpdateChatMessage';
import { useDeleteChatMessage } from '../../../../hooks/queries/useDeleteChatMessage';
import { useMarkChatRead } from '../../../../hooks/queries/useMarkChatRead';
import { useDebounceValue } from '../../../../hooks/useDebounceValue';
import { useAuth } from '../../../../hooks/useAuth';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ChatMessageEditor } from './ChatMessageEditor';

interface IssueChatSectionProps {
  projectKey: string;
  issueNumber: number;
}

function useIsPageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function useInViewport(ref: React.RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export function IssueChatSection({ projectKey, issueNumber }: IssueChatSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isPageVisible = useIsPageVisible();
  const isInView = useInViewport(rootRef);
  const auth = useAuth();
  const me = auth.user;

  const threadQ = useChatThread(projectKey, issueNumber);

  const initialFirstPage = useMemo(
    () =>
      threadQ.data
        ? { items: threadQ.data.recentMessages, nextCursor: null, hasMore: false }
        : undefined,
    [threadQ.data],
  );

  const messagesQ = useChatMessages({
    threadId: threadQ.data?.threadId,
    pollingEnabled: !!threadQ.data && isPageVisible && isInView,
    initialFirstPage,
  });

  const messages = useMemo(
    () => (messagesQ.data?.pages ?? []).flatMap((p) => p.items),
    [messagesQ.data],
  );

  const threadId = threadQ.data?.threadId ?? 0;
  const createMutation = useCreateChatMessage(threadId, {
    id: me?.id ?? 0,
    name: me?.name ?? me?.username ?? '나',
    kind: 'HUMAN',
  });
  const updateMutation = useUpdateChatMessage(threadId);
  const deleteMutation = useDeleteChatMessage(threadId);
  const markReadMutation = useMarkChatRead(threadId);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingReadId, setPendingReadId] = useState<number | null>(null);
  const debouncedReadId = useDebounceValue(pendingReadId, 1000);

  useEffect(() => {
    if (debouncedReadId !== null && threadId > 0) {
      markReadMutation.mutate({ uptoMessageId: debouncedReadId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedReadId, threadId]);

  if (threadQ.isLoading) {
    return (
      <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
        <CardHeader>
          <CardTitle className="text-base">이슈 채팅</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (threadQ.isError || !threadQ.data) {
    return (
      <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
        <CardHeader>
          <CardTitle className="text-base">이슈 채팅</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>채팅을 불러오지 못했어요.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => threadQ.refetch()}
            data-testid="chat-thread-retry"
          >
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  const thread = threadQ.data;

  return (
    <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          이슈 채팅
          <span className="text-xs text-muted-foreground">
            멤버 {thread.members.length}명
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ChatMessageList
          messages={messages}
          currentUserId={me?.id ?? 0}
          hasMore={messagesQ.hasNextPage ?? false}
          isFetchingMore={messagesQ.isFetchingNextPage}
          onLoadMore={() => messagesQ.fetchNextPage()}
          onEdit={(id) => setEditingId(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onMarkRead={(id) => setPendingReadId(id)}
          editingMessageId={editingId}
          renderEditor={(m) => (
            <ChatMessageEditor
              initialBody={m.body}
              onSave={(body) => {
                updateMutation.mutate(
                  { messageId: m.id, payload: { body } },
                  { onSettled: () => setEditingId(null) },
                );
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        />
        <ChatComposer
          members={thread.members}
          disabled={createMutation.isPending}
          onSubmit={(body) => createMutation.mutate({ body })}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS — `useAuth` 가 `{ user: { id, username, name } }` 를 반환한다고 가정. (만약 시그니처 다르면 import 한 곳에서 빠르게 수정)

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx
git commit -m "feat(web): IssueChatSection — 폴링 게이트 + mark-read 통합 — #39 phase6d"
```

---

## Task 12: `IssueDetailPage` 통합

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/IssueDetailPage.tsx`

- [ ] **Step 1: 현재 파일 확인**

Read: `apps/workplace-web/src/pages/projects/IssueDetailPage.tsx`
관심 라인: `<IssueCommentList ... />` 가 호출되는 부분 (요약 발췌상 130줄 근처).

- [ ] **Step 2: import 추가 + 컴포넌트 삽입**

`IssueCommentList` import 바로 아래에 추가:

```tsx
import { IssueChatSection } from './components/chat/IssueChatSection';
```

`<IssueCommentList .../>` 바로 아래에 추가 (좌측 메인 컬럼 안):

```tsx
<IssueChatSection projectKey={key} issueNumber={issueNumber} />
```

- [ ] **Step 3: 타입체크 + lint**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint --max-warnings 0` (lint 는 기존 미해결 23 problems 제외 — 새 코드만 깨끗하면 통과로 간주)

Expected: 새로 추가한 chat 관련 코드에서 lint 에러 없음. 기존 IssueCreateDialog/ProjectCreateDialog/IssueFilterBar baseline 오류는 그대로.

- [ ] **Step 4: 개발 서버 기동 + 수동 시각 검증**

Run: `pnpm db:up` (이미 떠 있으면 skip), 그리고 백그라운드로 `pnpm --filter workplace-api dev` + `pnpm --filter workplace-web dev`.

브라우저로 `http://localhost:6173`, 로그인 후 임의 이슈 진입 — 본문/코멘트 아래에 "이슈 채팅" Card 노출, 빈 상태 메시지 ("아직 대화가 없어요...") 보임.
메시지 1건 작성 → 즉시 노출 (optimistic) → 네트워크 응답 후 행 유지. 탭을 비활성화 (다른 탭으로 이동) → 5초 후 Network 패널에 GET `/chat/threads/{id}/messages` 가 떠 있지 않은지 확인.

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/pages/projects/IssueDetailPage.tsx
git commit -m "feat(web): IssueDetailPage 에 IssueChatSection 통합 — #39 phase6d"
```

---

## Task 13: E2E 스펙 (5 케이스)

**Files:**
- Create: `apps/workplace-web/e2e/pages/projects/chat.spec.ts`

- [ ] **Step 1: 스펙 작성**

`apps/workplace-web/e2e/pages/projects/chat.spec.ts` 새로 작성:

```ts
// Phase 6d — chat panel E2E.
// page.route 로 7 endpoint 모킹. 5 케이스: happy path / mention typeahead / AGENT 시각 / 수정·삭제 / mark-read.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import {
  createChatMember,
  createChatMessage,
  createChatThread,
  createChatMessagePage,
} from '../../factories/chat.factory';
import type { ChatMessageResponse } from '../../../src/types/chat';
import type { IssueDetailResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;

async function setupCommonStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: IssueDetailResponse },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailRef.current),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

interface ChatStubs {
  thread: ReturnType<typeof createChatThread>;
  messages: ChatMessageResponse[];
  createPayloads: { body: string }[];
  patchPayloads: { id: number; body: string }[];
  deleteIds: number[];
  markReadPayloads: { uptoMessageId: number }[];
}

async function setupChatStubs(page: import('@playwright/test').Page, stubs: ChatStubs) {
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubs.thread),
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createChatMessagePage(stubs.messages)),
      });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON() as { body: string };
      stubs.createPayloads.push(payload);
      const saved = createChatMessage({
        id: 1000 + stubs.createPayloads.length,
        threadId: THREAD_ID,
        authorId: ME_ID,
        authorName: '테스트 사용자',
        authorKind: 'HUMAN',
        body: payload.body,
      });
      stubs.messages = [...stubs.messages, saved];
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(saved),
      });
    },
  );
  await page.route(
    (url) => /\/api\/v1\/chat\/messages\/\d+$/.test(url.pathname),
    (route) => {
      const id = Number(url.pathname.split('/').pop());
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON() as { body: string };
        stubs.patchPayloads.push({ id, body: payload.body });
        stubs.messages = stubs.messages.map((m) =>
          m.id === id ? { ...m, body: payload.body, editedAt: new Date().toISOString() } : m,
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(stubs.messages.find((m) => m.id === id)),
        });
      }
      if (route.request().method() === 'DELETE') {
        stubs.deleteIds.push(id);
        stubs.messages = stubs.messages.map((m) =>
          m.id === id ? { ...m, deleted: true, body: '(삭제됨)' } : m,
        );
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON() as { uptoMessageId: number };
      stubs.markReadPayloads.push(payload);
      return route.fulfill({ status: 204 });
    },
  );
}

function freshStubs(): ChatStubs {
  return {
    thread: createChatThread({
      threadId: THREAD_ID,
      issueId: 1,
      members: [
        createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
        createChatMember({
          userId: 99,
          username: 'ai-agent',
          name: 'AI Agent',
          kind: 'AGENT',
        }),
      ],
      recentMessages: [],
    }),
    messages: [],
    createPayloads: [],
    patchPayloads: [],
    deleteIds: [],
    markReadPayloads: [],
  };
}

test.describe('이슈 chat panel', () => {
  test(
    'happy path: chat section 노출 → 메시지 작성 → optimistic + 서버 확정',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const detailRef = {
        current: createIssueDetail({
          summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'chat 테스트' }),
        }),
      };
      await setupCommonStubs(page, detailRef);
      const stubs = freshStubs();
      await setupChatStubs(page, stubs);

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      await expect(page.getByTestId('chat-section')).toBeVisible();
      await expect(page.getByTestId('chat-empty')).toBeVisible();

      await page.getByTestId('chat-composer-input').fill('안녕하세요');
      await page.getByTestId('chat-composer-submit').click();

      // optimistic 즉시 노출 — pending 마커.
      await expect(
        page.locator('[data-testid^=chat-message-][data-pending="true"]'),
      ).toContainText('안녕하세요');

      // 서버 확정 — pending 사라지고 영구 id 의 row 가 보임.
      await expect.poll(() => stubs.createPayloads).toEqual([{ body: '안녕하세요' }]);
      await expect(page.getByTestId(`chat-message-${1001}`)).toBeVisible();
    },
  );

  test('@mention typeahead — 멤버 선택 → textarea 치환', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'mention 테스트' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const ta = page.getByTestId('chat-composer-input');
    await ta.fill('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await expect(page.getByTestId('chat-mention-option-99')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    await expect(ta).toHaveValue('hi @ai-agent ');

    await page.getByTestId('chat-composer-submit').click();
    await expect.poll(() => stubs.createPayloads).toEqual([{ body: 'hi @ai-agent' }]);
  });

  test('AGENT 메시지 시각 구분', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'AGENT 시각' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 500,
          threadId: THREAD_ID,
          authorId: 99,
          authorName: 'AI Agent',
          authorKind: 'AGENT',
          body: 'AI 응답입니다',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const row = page.getByTestId('chat-message-500');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-agent', 'true');
    await expect(row.getByTestId('agent-badge')).toBeVisible();
  });

  test('본인 메시지 수정 + 삭제', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '수정삭제' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 600,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '원본',
        }),
        createChatMessage({
          id: 601,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '지울 것',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 수정.
    const row600 = page.getByTestId('chat-message-600');
    await row600.hover();
    await page.getByTestId('chat-message-edit-600').click();
    await page.getByTestId('chat-message-editor-input').fill('수정본');
    await page.getByTestId('chat-message-editor-save').click();

    await expect.poll(() => stubs.patchPayloads).toEqual([{ id: 600, body: '수정본' }]);
    await expect(page.getByTestId('chat-message-body-600')).toHaveText('수정본');

    // 삭제.
    const row601 = page.getByTestId('chat-message-601');
    await row601.hover();
    await page.getByTestId('chat-message-delete-601').click();

    await expect.poll(() => stubs.deleteIds).toEqual([601]);
    await expect(page.getByTestId('chat-message-body-601')).toContainText('(삭제됨)');
  });

  test('mark-as-read — 마지막 메시지 viewport 진입 시 POST /read', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'read' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 700,
          threadId: THREAD_ID,
          authorId: 99,
          authorName: 'AI Agent',
          authorKind: 'AGENT',
          body: '마지막 메시지',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 마지막 행이 viewport 안에 있어야 함 (section 전체가 보임).
    await page.getByTestId('chat-message-700').scrollIntoViewIfNeeded();

    await expect
      .poll(() => stubs.markReadPayloads, { timeout: 3000 })
      .toEqual([{ uptoMessageId: 700 }]);
  });
});
```

- [ ] **Step 2: E2E 실행**

Run: `pnpm --filter workplace-web exec playwright test e2e/pages/projects/chat.spec.ts --reporter=line`
Expected: 5 tests PASS

- [ ] **Step 3: 스모크 태그 별도 실행 (옵션)**

Run: `pnpm --filter workplace-web exec playwright test --grep "@smoke" --reporter=line`
Expected: 기존 @smoke + 새 chat @smoke 1건 모두 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/e2e/pages/projects/chat.spec.ts
git commit -m "test(web): chat panel E2E 5 케이스 — #39 phase6d"
```

---

## Task 14: 최종 검증 (lint + typecheck + E2E 전체)

- [ ] **Step 1: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 2: lint (회귀 없음 확인)**

Run: `pnpm --filter workplace-web lint`
Expected: 기존 23 problems 만 유지, 새로 추가된 chat 관련 코드에서 추가 에러 없음.

- [ ] **Step 3: vitest 단위 테스트**

Run: `pnpm --filter workplace-web vitest run`
Expected: 기존 PASS + detectMention 6 tests PASS

- [ ] **Step 4: E2E 전체**

Run: `pnpm --filter workplace-web exec playwright test --reporter=line`
Expected: 기존 spec 전부 PASS + 신규 chat.spec.ts 5 tests PASS

- [ ] **Step 5: 브라우저 골든 패스 시각 검증**

`pnpm dev` 실행 후 다음 시나리오 확인:
1. 이슈 상세 진입 → chat section 노출
2. 메시지 작성 → 즉시 표시 → 잠시 후 영구 row
3. `@` 입력 → typeahead popover → 멤버 선택 → 치환
4. AGENT 메시지가 있다면 보라 좌측 보더 + AgentBadge
5. 본인 메시지 hover → 편집/삭제 아이콘 → 동작
6. 다른 탭으로 전환 → 5초 후 Network 패널에 messages GET 안 보임 → 다시 탭 복귀 → GET 발생

- [ ] **Step 6: 최종 commit (없으면 skip)**

남은 변경이 있으면 `git status` 확인 후 부분 commit. 없으면 skip.

---

## Self-Review

### Spec coverage 체크 (spec 섹션별)
- ✅ §2 컴포넌트·파일 구조 — Task 1, 2, 3, 5, 6, 7, 9, 10, 11 에서 17개 새 파일 모두 생성
- ✅ §3.1 lazy 로드 — Task 3 `useChatThread` GET
- ✅ §3.2 폴링 (visible + in-viewport + 5초) — Task 4 + Task 11 useInViewport/useIsPageVisible
- ✅ §3.3 optimistic 작성 — Task 5 `useCreateChatMessage`
- ✅ §3.4 수정/삭제 — Task 5 + Task 10 + Task 11 (편집 모드 swap)
- ✅ §3.5 mark-as-read (IntersectionObserver + 1s debounce) — Task 7 + Task 11 (useDebounceValue)
- ✅ §4 @mention typeahead — Task 8 (`detectMention` + 단위테스트) + Task 9 (popover + composer 키보드)
- ✅ §5.2 AGENT 시각 구분 — Task 6 `ChatMessageRow` 보라 보더 + AgentBadge
- ✅ §5.3 빈 상태 — Task 7 `chat-empty`
- ✅ §5.4 에러 처리 — Task 5 toast, Task 11 retry 버튼
- ✅ §5.5 접근성 — Task 6/7/9 의 aria-*
- ✅ §6 API 클라이언트 7 함수 — Task 2
- ✅ §7.1 E2E 5 케이스 — Task 13
- ✅ §7.2 단위 — Task 8 (detectMention)
- ✅ §7.3 시각 검증 — Task 12, 14

### Placeholder 스캔
- 모든 step 에 실제 코드/명령 포함, "TBD"/"적절한" 패턴 없음 확인
- "(주의: 위 코드에서 lastRef 의 ref 분기 처리가 조금 거친데, IssueChatSection 통합 시 정리. 일단 IO 타깃이 마지막 행이면 충분.)" — 이건 후속 task 11 에서 다루는 인지 가능한 코드 스멜 안내, placeholder 아님

### 타입/네이밍 일관성
- `threadId: number`, `messageId: number`, `userId: number` — 전 task 일치
- `authorKind: 'HUMAN' | 'AGENT'` — types/chat.ts, ChatMessageRow, factory 일치
- mutation 훅: `useCreateChatMessage(threadId, me)` / `useUpdateChatMessage(threadId)` / `useDeleteChatMessage(threadId)` / `useMarkChatRead(threadId)` — Task 5 정의 + Task 11 사용 일치
- `chatKeys.thread(projectKey, issueNumber)` / `chatKeys.messages(threadId)` — Task 3 정의 + Task 3/4/5 사용 일치
- E2E testid: `chat-section`, `chat-empty`, `chat-message-list`, `chat-message-{id}`, `chat-message-body-{id}`, `chat-message-edit-{id}`, `chat-message-delete-{id}`, `chat-message-editor`, `chat-message-editor-input`, `chat-message-editor-save/cancel`, `chat-composer`, `chat-composer-input`, `chat-composer-submit`, `chat-mention-popover`, `chat-mention-option-{id}`, `chat-thread-retry`, `chat-load-more`, `agent-badge` — 컴포넌트 정의(Task 6/7/9/10/11) ↔ E2E spec(Task 13) 매칭 확인

### 의존성 검증
- `useAuth` hook (`apps/workplace-web/src/hooks/useAuth.ts`) — 실제 시그니처 검증은 Task 11 step 3 typecheck 단계에서. 만약 `user.id`/`user.name` 가 다른 이름이면 그 시점에 수정 (현재 코드는 `auth.user?.id`/`auth.user?.name`/`auth.user?.username` 가정)
- `useDebounceValue` — 사전 조사로 `src/hooks/useDebounceValue.ts` 존재 확인됨
- `handleApiError` — 사전 조사로 `src/lib/api-error.ts` 존재 확인됨
- shadcn primitives (Card, ScrollArea, Popover, Textarea, Button, Skeleton) — 사전 조사로 모두 존재 확인

---

## 실행 안내

Plan complete and saved to `docs/superpowers/plans/2026-05-29-phase6d-frontend-chat.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
