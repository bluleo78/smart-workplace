# Chat @mention ID 토큰 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅 @mention 을 본문 내 `<@{userId}>` 토큰으로 저장·파싱하고, 화면에는 이름 칩으로 표시하며, 입력은 TipTap mention 칩 에디터로 처리한다.

**Architecture:** 백엔드는 정규식을 username 기반 `@([a-zA-Z0-9._-]+)` 에서 id 기반 `<@(\d+)>` 로 바꾸고, 본문 파싱 결과를 user id 로 검증한다. 응답 DTO(`mentions[]`)는 불변. 프론트는 textarea + 수동 typeahead 를 TipTap(`@tiptap/extension-mention`) 기반 공용 `ChatRichInput` 으로 교체하고, 직렬화/세그먼트 분리는 DOM 비의존 순수 함수로 단위 테스트한다.

**Tech Stack:** Java 21 + Spring + jOOQ (workplace-api), React 19 + TypeScript + TipTap 2 + tippy.js + Vitest + Playwright (workplace-web)

**Spec:** `docs/superpowers/specs/2026-05-29-chat-mention-id-token-design.md` (이슈 #42)

---

## File Structure

### 백엔드 (apps/workplace-api)
- Modify: `src/main/java/com/workplace/chat/service/ChatMentionParser.java` — 정규식 `<@(\d+)>`, 반환 `List<Long>`
- Modify: `src/test/java/com/workplace/chat/service/ChatMentionParserTest.java` — id 토큰 케이스
- Modify: `src/main/java/com/workplace/chat/service/ChatUserHydrator.java` — `filterExistingUserIds` 추가, `resolveUsernamesToIds` 제거
- Modify: `src/main/java/com/workplace/chat/service/ChatMessageService.java` — create/update 가 새 파서+필터 사용

### 프론트 (apps/workplace-web)
- Modify: `package.json` — TipTap + tippy 의존성
- Create: `src/pages/projects/components/chat/mentionSerialize.ts` — TipTap JSON ↔ `<@id>` 본문 (순수)
- Create: `src/pages/projects/components/chat/__tests__/mentionSerialize.test.ts` — vitest
- Create: `src/pages/projects/components/chat/parseMessageSegments.ts` — 본문 → 세그먼트 배열 (순수)
- Create: `src/pages/projects/components/chat/__tests__/parseMessageSegments.test.ts` — vitest
- Create: `src/pages/projects/components/chat/MentionList.tsx` — TipTap suggestion 팝업 리스트
- Create: `src/pages/projects/components/chat/ChatRichInput.tsx` — TipTap 에디터 공용 래퍼
- Modify: `src/pages/projects/components/chat/ChatMessageRow.tsx` — 세그먼트 렌더(이름 칩)
- Modify: `src/pages/projects/components/chat/ChatComposer.tsx` — `ChatRichInput` 사용으로 축소
- Modify: `src/pages/projects/components/chat/ChatMessageEditor.tsx` — `ChatRichInput` 사용으로 축소
- Delete: `src/pages/projects/components/chat/detectMention.ts`, `__tests__/detectMention.test.ts`, `ChatMentionPopover.tsx`
- Modify: `e2e/pages/projects/chat.spec.ts` — mention/표시 케이스 갱신, 셀렉터(contenteditable)

---

## Task 1: 백엔드 파서 — `<@id>` 토큰

**Files:**
- Modify: `apps/workplace-api/src/test/java/com/workplace/chat/service/ChatMentionParserTest.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMentionParser.java`

- [ ] **Step 1: 테스트를 새 포맷으로 교체 (실패 유도)**

`ChatMentionParserTest.java` 전체를 아래로 교체:

```java
package com.workplace.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** <@id> 토큰 파서. 중복 제거(첫 등장 순서), 비토큰 무시. */
class ChatMentionParserTest {

  @Test
  void parse_singleToken_returnsId() {
    assertThat(ChatMentionParser.parse("안녕 <@42>")).containsExactly(42L);
  }

  @Test
  void parse_multipleTokens_deduplicatedInOrder() {
    assertThat(ChatMentionParser.parse("<@42> <@7> <@42> 처리")).containsExactly(42L, 7L);
  }

  @Test
  void parse_noToken_returnsEmpty() {
    assertThat(ChatMentionParser.parse("그냥 메시지입니다")).isEmpty();
  }

  @Test
  void parse_plainAtText_isIgnored() {
    // 옛 @username / 이메일 텍스트는 토큰이 아니므로 무시.
    assertThat(ChatMentionParser.parse("@alice foo@bar.com")).isEmpty();
  }

  @Test
  void parse_malformedToken_isIgnored() {
    assertThat(ChatMentionParser.parse("<@> <@abc> <@1a>")).isEmpty();
  }
}
```

- [ ] **Step 2: 테스트 실행 — 컴파일 실패/실패 확인**

Run: `./gradlew :apps:workplace-api:test --tests '*ChatMentionParserTest*'`
Expected: FAIL (현재 파서는 `List<String>` 반환 → 컴파일 또는 단언 실패)

- [ ] **Step 3: 파서 구현 교체**

`ChatMentionParser.java` 전체를 아래로 교체:

```java
package com.workplace.chat.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * chat 메시지 본문에서 <@{userId}> 멘션 토큰을 추출한다. 중복은 첫 등장 순서를 유지한 채 제거. 표시이름/username 자유텍스트는 파싱하지
 * 않으며, 토큰의 유효성(존재하는 user)은 서비스 단(ChatUserHydrator)에서 검증한다.
 */
public final class ChatMentionParser {
  private ChatMentionParser() {}

  private static final Pattern P = Pattern.compile("<@(\\d+)>");

  public static List<Long> parse(String body) {
    if (body == null || body.isEmpty()) return List.of();
    Matcher m = P.matcher(body);
    LinkedHashSet<Long> seen = new LinkedHashSet<>();
    while (m.find()) {
      seen.add(Long.parseLong(m.group(1)));
    }
    return new ArrayList<>(seen);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `./gradlew :apps:workplace-api:test --tests '*ChatMentionParserTest*'`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMentionParser.java \
        apps/workplace-api/src/test/java/com/workplace/chat/service/ChatMentionParserTest.java
git commit -m "feat(api): chat mention 파서 <@id> 토큰 방식으로 전환 — #42"
```

---

## Task 2: 백엔드 hydrator 필터 + 서비스 배선

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/chat/service/ChatUserHydrator.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMessageService.java`

- [ ] **Step 1: hydrator 에 id 필터 추가, username resolve 제거**

`ChatUserHydrator.java` 에서 `resolveUsernamesToIds` 메서드(주석 포함)를 삭제하고, 그 자리에 아래 메서드를 추가:

```java
  /** mention id 후보 중 실제 존재하는 user.id 만 통과 (중복 제거, 입력 순서 보존). */
  public List<Long> filterExistingUserIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    java.util.Set<Long> existing =
        dsl.select(USER.ID).from(USER).where(USER.ID.in(ids)).fetchSet(USER.ID);
    return ids.stream().filter(existing::contains).distinct().toList();
  }
```

- [ ] **Step 2: 서비스 create/update 배선 변경**

`ChatMessageService.java` 의 `create` 에서:

```java
    List<String> usernames = ChatMentionParser.parse(req.body());
    List<Long> mentionUserIds = hydrator.resolveUsernamesToIds(usernames);
```
를 아래로 교체:
```java
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));
```

같은 파일 `update` 에서:
```java
    List<Long> mentionUserIds = hydrator.resolveUsernamesToIds(ChatMentionParser.parse(req.body()));
```
를 아래로 교체:
```java
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));
```

- [ ] **Step 3: 기존 멘션 관련 테스트가 옛 @username 을 쓰면 갱신**

Run: `grep -rn "@alice\|@bob\|resolveUsernamesToIds\|@ai-agent" apps/workplace-api/src/test`
각 매치에서 mention 을 검증하는 테스트라면 본문 문자열의 `@username` 을 해당 user 의 `<@{id}>` 로 바꾼다(테스트가 만든 user 의 id 사용). 멘션과 무관한 매치는 그대로 둔다.

- [ ] **Step 4: chat 모듈 테스트 전체 실행**

Run: `./gradlew :apps:workplace-api:test --tests 'com.workplace.chat.*'`
Expected: PASS (그린). 실패가 옛 username 멘션 가정 때문이면 Step 3 로 돌아가 본문을 `<@id>` 로 수정.

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/service/ChatUserHydrator.java \
        apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMessageService.java \
        apps/workplace-api/src/test
git commit -m "feat(api): chat mention 을 id 검증 기반으로 resolve — #42"
```

---

## Task 3: 프론트 TipTap 의존성 추가

**Files:**
- Modify: `apps/workplace-web/package.json`

- [ ] **Step 1: 의존성 설치**

Run:
```bash
pnpm --filter workplace-web add \
  @tiptap/react@^2 @tiptap/core@^2 @tiptap/pm@^2 \
  @tiptap/extension-document@^2 @tiptap/extension-paragraph@^2 @tiptap/extension-text@^2 \
  @tiptap/extension-mention@^2 @tiptap/suggestion@^2 tippy.js@^6
```
Expected: `package.json` dependencies 에 위 패키지 추가, lockfile 갱신.

- [ ] **Step 2: 타입체크 (설치 확인)**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS (아직 사용처 없음)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/package.json pnpm-lock.yaml
git commit -m "chore(web): TipTap + tippy 의존성 추가 (chat mention) — #42"
```

---

## Task 4: 직렬화 순수 함수 + vitest

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/__tests__/mentionSerialize.test.ts`
- Create: `apps/workplace-web/src/pages/projects/components/chat/mentionSerialize.ts`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/mentionSerialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ChatMentionResponse } from '../../../../../types/chat';
import { bodyToDoc, serializeToBody } from '../mentionSerialize';

const AI: ChatMentionResponse = { id: 99, username: 'ai-agent', name: 'AI Agent', kind: 'AGENT' };

describe('serializeToBody', () => {
  it('텍스트 + mention 노드를 <@id> 본문으로 직렬화', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 99, label: 'AI Agent' } },
            { type: 'text', text: ' 확인' },
          ],
        },
      ],
    };
    expect(serializeToBody(doc)).toBe('hi <@99> 확인');
  });

  it('여러 문단은 줄바꿈으로 합친다', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    expect(serializeToBody(doc)).toBe('a\nb');
  });

  it('빈 문서는 빈 문자열', () => {
    expect(serializeToBody({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });
});

describe('bodyToDoc', () => {
  it('<@id> 를 mention 노드(label=이름)로 복원', () => {
    const doc = bodyToDoc('hi <@99> 확인', [AI]);
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 99, label: 'AI Agent' } },
            { type: 'text', text: ' 확인' },
          ],
        },
      ],
    });
  });

  it('mentions 에 없는 id 는 label "알 수 없음"', () => {
    const doc = bodyToDoc('<@5>', []);
    expect(doc.content?.[0].content?.[0]).toEqual({
      type: 'mention',
      attrs: { id: 5, label: '알 수 없음' },
    });
  });

  it('직렬화 라운드트립', () => {
    const body = 'a <@99> b';
    expect(serializeToBody(bodyToDoc(body, [AI]))).toBe(body);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-web exec vitest run src/pages/projects/components/chat/__tests__/mentionSerialize.test.ts`
Expected: FAIL — `Cannot find module '../mentionSerialize'`

- [ ] **Step 3: 구현 작성**

`mentionSerialize.ts`:

```ts
// TipTap JSON 도큐먼트 ↔ chat 본문(<@id> 토큰) 변환. 에디터/DOM 비의존 순수 함수.

import type { JSONContent } from '@tiptap/core';

import type { ChatMentionResponse } from '../../../../types/chat';

// TipTap JSON(doc) → 본문 문자열. mention 노드는 <@id>, 문단 경계는 \n.
export function serializeToBody(doc: JSONContent): string {
  const paragraphs = (doc.content ?? []).map((para) => {
    const inline = (para.content ?? [])
      .map((node) => {
        if (node.type === 'mention') return `<@${node.attrs?.id}>`;
        return node.text ?? '';
      })
      .join('');
    return inline;
  });
  return paragraphs.join('\n');
}

// 본문 문자열 → TipTap JSON(doc). <@id> 는 mention 노드(label=이름)로 복원.
export function bodyToDoc(body: string, mentions: ChatMentionResponse[]): JSONContent {
  const nameById = new Map(mentions.map((m) => [m.id, m.name]));
  const lines = body.split('\n');
  const content: JSONContent[] = lines.map((line) => {
    const inline: JSONContent[] = [];
    const re = /<@(\d+)>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) inline.push({ type: 'text', text: line.slice(last, m.index) });
      const id = Number(m[1]);
      inline.push({ type: 'mention', attrs: { id, label: nameById.get(id) ?? '알 수 없음' } });
      last = m.index + m[0].length;
    }
    if (last < line.length) inline.push({ type: 'text', text: line.slice(last) });
    return inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return { type: 'doc', content };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter workplace-web exec vitest run src/pages/projects/components/chat/__tests__/mentionSerialize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/mentionSerialize.ts \
        apps/workplace-web/src/pages/projects/components/chat/__tests__/mentionSerialize.test.ts
git commit -m "feat(web): mention 직렬화(JSON↔<@id>) 순수함수 + vitest — #42"
```

---

## Task 5: 본문 세그먼트 분리 + 표시 렌더

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/__tests__/parseMessageSegments.test.ts`
- Create: `apps/workplace-web/src/pages/projects/components/chat/parseMessageSegments.ts`
- Modify: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageRow.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/parseMessageSegments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ChatMentionResponse } from '../../../../../types/chat';
import { parseMessageSegments } from '../parseMessageSegments';

const AI: ChatMentionResponse = { id: 99, username: 'ai-agent', name: 'AI Agent', kind: 'AGENT' };

describe('parseMessageSegments', () => {
  it('텍스트 + mention 토큰을 세그먼트로 분리', () => {
    expect(parseMessageSegments('hi <@99> 확인', [AI])).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', id: 99, name: 'AI Agent', kind: 'AGENT' },
      { type: 'text', value: ' 확인' },
    ]);
  });

  it('mentions 에 없는 id 는 이름 "알 수 없음", kind HUMAN', () => {
    expect(parseMessageSegments('<@5>', [])).toEqual([
      { type: 'mention', id: 5, name: '알 수 없음', kind: 'HUMAN' },
    ]);
  });

  it('토큰 없으면 단일 텍스트 세그먼트', () => {
    expect(parseMessageSegments('그냥 텍스트', [])).toEqual([
      { type: 'text', value: '그냥 텍스트' },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-web exec vitest run src/pages/projects/components/chat/__tests__/parseMessageSegments.test.ts`
Expected: FAIL — module 없음

- [ ] **Step 3: 구현 작성**

`parseMessageSegments.ts`:

```ts
// 채팅 본문을 <@id> 토큰 기준으로 표시 세그먼트 배열로 분리. 에디터/DOM 비의존 순수 함수.

import type { ChatMentionResponse, UserKind } from '../../../../types/chat';

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; id: number; name: string; kind: UserKind };

export function parseMessageSegments(
  body: string,
  mentions: ChatMentionResponse[],
): MentionSegment[] {
  const byId = new Map(mentions.map((m) => [m.id, m]));
  const segments: MentionSegment[] = [];
  const re = /<@(\d+)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: body.slice(last, m.index) });
    const id = Number(m[1]);
    const hit = byId.get(id);
    segments.push({
      type: 'mention',
      id,
      name: hit?.name ?? '알 수 없음',
      kind: hit?.kind ?? 'HUMAN',
    });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', value: body.slice(last) });
  return segments;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter workplace-web exec vitest run src/pages/projects/components/chat/__tests__/parseMessageSegments.test.ts`
Expected: PASS

- [ ] **Step 5: ChatMessageRow 가 세그먼트를 렌더하도록 수정**

`ChatMessageRow.tsx` 에서 본문 렌더 블록:

```tsx
        <div
          className={`text-sm whitespace-pre-wrap break-words ${
            message.deleted ? 'italic text-muted-foreground' : ''
          }`}
          data-testid={`chat-message-body-${message.id}`}
        >
          {message.body}
        </div>
```
를 아래로 교체:

```tsx
        <div
          className={`text-sm whitespace-pre-wrap break-words ${
            message.deleted ? 'italic text-muted-foreground' : ''
          }`}
          data-testid={`chat-message-body-${message.id}`}
        >
          {message.deleted
            ? message.body
            : parseMessageSegments(message.body, message.mentions).map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i}>{seg.value}</span>
                ) : (
                  <span
                    key={i}
                    data-testid={`chat-mention-chip-${seg.id}`}
                    className={`rounded px-1 font-medium ${
                      seg.kind === 'AGENT'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    @{seg.name}
                  </span>
                ),
              )}
        </div>
```

그리고 파일 상단 import 에 추가:
```tsx
import { parseMessageSegments } from './parseMessageSegments';
```

- [ ] **Step 6: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/parseMessageSegments.ts \
        apps/workplace-web/src/pages/projects/components/chat/__tests__/parseMessageSegments.test.ts \
        apps/workplace-web/src/pages/projects/components/chat/ChatMessageRow.tsx
git commit -m "feat(web): 메시지 본문 <@id> → 이름 칩 렌더 + vitest — #42"
```

---

## Task 6: TipTap suggestion 팝업 리스트 `MentionList`

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/MentionList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`MentionList.tsx`:

```tsx
// TipTap mention suggestion 팝업의 옵션 리스트.
// 키보드 네비(↑↓ Enter)는 forwardRef 의 onKeyDown 으로 노출 — suggestion render 가 위임 호출.

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { AgentBadge } from '../../../../components/users/AgentBadge';
import type { ChatMemberResponse } from '../../../../types/chat';

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: ChatMemberResponse[];
  command: (item: { id: number; label: string }) => void;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    function select(index: number) {
      const item = items[index];
      if (item) command({ id: item.userId, label: item.name });
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelected((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div
        role="listbox"
        aria-label="멘션 후보"
        className="w-72 overflow-auto rounded-md border bg-popover shadow-md"
        data-testid="chat-mention-popover"
      >
        {items.map((m, idx) => (
          <button
            type="button"
            key={m.userId}
            role="option"
            aria-selected={idx === selected}
            data-testid={`chat-mention-option-${m.userId}`}
            data-agent={m.kind === 'AGENT' ? 'true' : undefined}
            onMouseEnter={() => setSelected(idx)}
            onClick={() => select(idx)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
              idx === selected ? 'bg-accent' : ''
            }`}
          >
            <span className="font-medium">{m.name}</span>
            {m.kind === 'AGENT' && <AgentBadge size="xs" />}
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = 'MentionList';
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/MentionList.tsx
git commit -m "feat(web): TipTap mention suggestion 팝업 리스트 — #42"
```

---

## Task 7: 공용 `ChatRichInput` (TipTap 에디터)

**Files:**
- Create: `apps/workplace-web/src/pages/projects/components/chat/ChatRichInput.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`ChatRichInput.tsx`:

```tsx
// TipTap 기반 chat 입력 공용 컴포넌트 (composer/editor 공용).
// mention 칩 + @ suggestion. Enter=onSubmit, Shift+Enter=줄바꿈, Esc=onCancel.
// IME(한글 조합)는 ProseMirror 가 처리. 전송 후 clearOnSubmit 이면 비우고 포커스 유지.

import './chat-rich-input.css';

import Document from '@tiptap/extension-document';
import Mention from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { ReactRenderer, useEditor } from '@tiptap/react';
import { EditorContent } from '@tiptap/react';
import { useRef } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { Button } from '../../../../components/ui/button';
import type { ChatMemberResponse, ChatMentionResponse } from '../../../../types/chat';
import { bodyToDoc, serializeToBody } from './mentionSerialize';
import { MentionList, type MentionListHandle } from './MentionList';

interface ChatRichInputProps {
  members: ChatMemberResponse[];
  initialBody?: string;
  initialMentions?: ChatMentionResponse[];
  placeholder?: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
  clearOnSubmit?: boolean;
  autoFocus?: boolean;
  inputTestId: string;
  submitTestId: string;
  cancelTestId?: string;
}

export function ChatRichInput({
  members,
  initialBody = '',
  initialMentions = [],
  placeholder = '메시지 입력 (Shift+Enter 로 줄바꿈)',
  onSubmit,
  onCancel,
  submitLabel = '보내기',
  clearOnSubmit = false,
  autoFocus = false,
  inputTestId,
  submitTestId,
  cancelTestId,
}: ChatRichInputProps) {
  // members 최신값을 suggestion 콜백에서 참조하기 위한 ref.
  const membersRef = useRef(members);
  membersRef.current = members;

  const editor = useEditor({
    autofocus: autoFocus,
    extensions: [
      Document,
      Paragraph,
      Text,
      Mention.configure({
        HTMLAttributes: { class: 'chat-mention' },
        renderText: ({ node }) => `@${node.attrs.label}`,
        suggestion: {
          char: '@',
          items: ({ query }) => {
            const q = query.toLowerCase();
            return membersRef.current
              .filter(
                (m) =>
                  q === '' ||
                  m.name.toLowerCase().includes(q) ||
                  m.username.toLowerCase().includes(q),
              )
              .slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer<MentionListHandle> | null = null;
            let popup: TippyInstance | null = null;
            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });
                popup = tippy(document.body, {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },
              onUpdate: (props) => {
                component?.updateProps(props);
                popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.destroy();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: initialBody ? bodyToDoc(initialBody, initialMentions) : undefined,
    editorProps: {
      attributes: {
        'data-testid': inputTestId,
        'aria-label': '채팅 메시지 작성',
        class:
          'min-h-[44px] max-h-40 overflow-auto rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      },
      handleKeyDown: (_view, event) => {
        // suggestion 팝업이 열려있으면 Enter 는 mention 플러그인이 먼저 처리(키 위임)하므로 여기선 무시.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          // 팝업 활성 여부는 DOM 으로 확인 (열려있으면 mention 처리에 양보).
          if (document.querySelector('[data-testid="chat-mention-popover"]')) return false;
          event.preventDefault();
          submit();
          return true;
        }
        if (event.key === 'Escape' && onCancel) {
          event.preventDefault();
          onCancel();
          return true;
        }
        return false;
      },
    },
  });

  function submit() {
    if (!editor) return;
    const body = serializeToBody(editor.getJSON()).trim();
    if (body.length === 0) return;
    onSubmit(body);
    if (clearOnSubmit) {
      editor.commands.clearContent();
      editor.commands.focus();
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`${inputTestId}-wrap`}>
      <div className="relative" data-placeholder={placeholder}>
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid={cancelTestId}>
            취소
          </Button>
        )}
        <Button type="button" size="sm" onClick={submit} data-testid={submitTestId}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: mention 칩/placeholder 스타일 CSS**

`apps/workplace-web/src/pages/projects/components/chat/chat-rich-input.css` 작성:

```css
/* TipTap mention 칩 + 빈 에디터 placeholder. */
.chat-mention {
  border-radius: 0.25rem;
  padding: 0 0.25rem;
  background-color: rgb(219 234 254); /* blue-100 */
  color: rgb(29 78 216); /* blue-700 */
  font-weight: 500;
}
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: rgb(148 163 184); /* slate-400 */
  float: left;
  height: 0;
  pointer-events: none;
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/ChatRichInput.tsx \
        apps/workplace-web/src/pages/projects/components/chat/chat-rich-input.css
git commit -m "feat(web): TipTap 기반 ChatRichInput 공용 입력 컴포넌트 — #42"
```

---

## Task 8: `ChatComposer` / `ChatMessageEditor` 를 `ChatRichInput` 으로 교체

**Files:**
- Modify: `apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx`
- Modify: `apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx`
- Delete: `apps/workplace-web/src/pages/projects/components/chat/detectMention.ts`
- Delete: `apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts`
- Delete: `apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx`

- [ ] **Step 1: ChatComposer 전체 교체**

`ChatComposer.tsx` 전체를 아래로 교체:

```tsx
// chat 메시지 작성 폼 — TipTap 기반 ChatRichInput 래퍼.
// Enter=전송, Shift+Enter=줄바꿈, @=멘션. 전송 후 비우고 포커스 유지.

import type { ChatMemberResponse } from '../../../../types/chat';
import { ChatRichInput } from './ChatRichInput';

interface ChatComposerProps {
  members: ChatMemberResponse[];
  onSubmit: (body: string) => void;
}

export function ChatComposer({ members, onSubmit }: ChatComposerProps) {
  return (
    <div className="border-t p-3" data-testid="chat-composer">
      <ChatRichInput
        members={members}
        onSubmit={onSubmit}
        clearOnSubmit
        submitLabel="보내기"
        inputTestId="chat-composer-input"
        submitTestId="chat-composer-submit"
      />
    </div>
  );
}
```

(주의: `disabled` prop 제거됨 — pending 동안 입력 막지 않음. 호출처 IssueChatSection 의 `disabled={createMutation.isPending}` 전달 라인도 제거해야 함 → Step 3.)

- [ ] **Step 2: ChatMessageEditor 전체 교체**

`ChatMessageEditor.tsx` 전체를 아래로 교체:

```tsx
// 본인 메시지 인라인 수정 — ChatRichInput 재사용. Enter=저장, Esc=취소.

import type { ChatMemberResponse, ChatMentionResponse } from '../../../../types/chat';
import { ChatRichInput } from './ChatRichInput';

interface ChatMessageEditorProps {
  initialBody: string;
  initialMentions: ChatMentionResponse[];
  members: ChatMemberResponse[];
  onSave: (body: string) => void;
  onCancel: () => void;
}

export function ChatMessageEditor({
  initialBody,
  initialMentions,
  members,
  onSave,
  onCancel,
}: ChatMessageEditorProps) {
  return (
    <div className="px-3 py-2" data-testid="chat-message-editor">
      <ChatRichInput
        members={members}
        initialBody={initialBody}
        initialMentions={initialMentions}
        onSubmit={onSave}
        onCancel={onCancel}
        submitLabel="저장"
        autoFocus
        inputTestId="chat-message-editor-input"
        submitTestId="chat-message-editor-save"
        cancelTestId="chat-message-editor-cancel"
      />
    </div>
  );
}
```

- [ ] **Step 3: IssueChatSection 호출부 갱신**

`apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx` 에서:

`ChatComposer` 호출:
```tsx
        <ChatComposer
          members={thread.members}
          disabled={createMutation.isPending}
          onSubmit={(body) => createMutation.mutate({ body })}
        />
```
를 아래로 교체(`disabled` 제거):
```tsx
        <ChatComposer
          members={thread.members}
          onSubmit={(body) => createMutation.mutate({ body })}
        />
```

`renderEditor` 의 `ChatMessageEditor` 호출:
```tsx
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
```
를 아래로 교체(`initialMentions`, `members` 추가):
```tsx
          renderEditor={(m) => (
            <ChatMessageEditor
              initialBody={m.body}
              initialMentions={m.mentions}
              members={thread.members}
              onSave={(body) => {
                updateMutation.mutate(
                  { messageId: m.id, payload: { body } },
                  { onSettled: () => setEditingId(null) },
                );
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
```

- [ ] **Step 4: 옛 typeahead 파일 삭제**

Run:
```bash
git rm apps/workplace-web/src/pages/projects/components/chat/detectMention.ts \
       apps/workplace-web/src/pages/projects/components/chat/__tests__/detectMention.test.ts \
       apps/workplace-web/src/pages/projects/components/chat/ChatMentionPopover.tsx
```

- [ ] **Step 5: 타입체크 + lint + vitest**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web exec eslint src/pages/projects/components/chat && pnpm --filter workplace-web exec vitest run`
Expected: typecheck PASS, lint 새 코드 무에러, vitest PASS (mentionSerialize + parseMessageSegments; detectMention 테스트는 삭제됨)

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/src/pages/projects/components/chat/ChatComposer.tsx \
        apps/workplace-web/src/pages/projects/components/chat/ChatMessageEditor.tsx \
        apps/workplace-web/src/pages/projects/components/chat/IssueChatSection.tsx
git commit -m "feat(web): chat composer/editor 를 TipTap ChatRichInput 으로 교체 — #42"
```

---

## Task 9: E2E 갱신 (contenteditable + 칩 + `<@id>`)

**Files:**
- Modify: `apps/workplace-web/e2e/pages/projects/chat.spec.ts`

- [ ] **Step 1: `@mention typeahead` 케이스 교체**

`chat.spec.ts` 의 `test('@mention typeahead — 멤버 선택 → textarea 치환', ...)` 블록 전체를 아래로 교체:

```ts
  test('@mention — 멤버 선택 → 칩 → <@id> 전송 + 이름 칩 렌더', async ({
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

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    // 입력창에 멘션 칩(이름) 표시.
    await expect(input).toContainText('@AI Agent');

    await page.getByTestId('chat-composer-submit').click();

    // 전송 본문은 <@id> 토큰.
    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['hi <@99>']);

    // 서버 확정 메시지에 이름 칩 렌더.
    await expect(page.getByTestId('chat-mention-chip-99')).toHaveText('@AI Agent');
  });
```

- [ ] **Step 2: 수정/삭제 케이스의 입력 셀렉터 보정**

`chat.spec.ts` 의 `test('본인 메시지 수정 + 삭제', ...)` 안에서:
```ts
    await page.getByTestId('chat-message-editor-input').fill('수정본');
```
를 아래로 교체(contenteditable 은 fill 불가):
```ts
    const editor = page.getByTestId('chat-message-editor-input');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('수정본');
```

- [ ] **Step 3: IME/포커스 회귀 케이스 갱신**

`chat.spec.ts` 의 `test('한글 IME 조합 중 Enter 는 전송하지 않는다 — 중복 메시지 방지', ...)` 와 `test('전송 후 입력창 포커스가 유지된다 — 연속 입력 가능', ...)` 두 블록을 삭제하고, 그 자리에 아래 한 블록 추가(ProseMirror 가 IME/포커스를 처리하므로 동작 기준으로 검증):

```ts
  // 전송 후에도 입력창에 포커스가 남아 마우스 클릭 없이 연속 입력 가능 (ProseMirror).
  test('전송 후 입력창 포커스 유지 — 연속 입력', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'focus' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('첫 메시지');
    await page.keyboard.press('Enter');

    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['첫 메시지']);
    await expect(input).toBeFocused();

    await page.keyboard.type('이어서');
    await expect(input).toContainText('이어서');
  });
```

- [ ] **Step 4: happy path 케이스의 입력 셀렉터 보정**

`chat.spec.ts` 의 happy path 테스트에서:
```ts
      await page.getByTestId('chat-composer-input').fill('안녕하세요');
      await page.getByTestId('chat-composer-submit').click();
```
를 아래로 교체:
```ts
      await page.getByTestId('chat-composer-input').click();
      await page.keyboard.type('안녕하세요');
      await page.getByTestId('chat-composer-submit').click();
```

- [ ] **Step 5: E2E 실행**

Run: `pnpm --filter workplace-web exec playwright test e2e/pages/projects/chat.spec.ts --reporter=line`
Expected: 전 케이스 PASS (happy path / mention / AGENT 시각 / 수정·삭제 / mark-read / 스크롤 / 포커스)

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-web/e2e/pages/projects/chat.spec.ts
git commit -m "test(web): chat E2E 를 TipTap 칩/<@id> 기준으로 갱신 — #42"
```

---

## Task 10: 최종 검증

- [ ] **Step 1: 백엔드 chat 테스트**

Run: `./gradlew :apps:workplace-api:test --tests 'com.workplace.chat.*'`
Expected: PASS

- [ ] **Step 2: 프론트 typecheck + lint + vitest**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint && pnpm --filter workplace-web exec vitest run`
Expected: typecheck PASS, lint 기존 baseline 만(새 chat 코드 무에러), vitest PASS

- [ ] **Step 3: 프론트 E2E 전체**

Run: `pnpm --filter workplace-web exec playwright test --reporter=line`
Expected: 기존 spec + chat.spec PASS (ECONNREFUSED flake 시 재시도)

- [ ] **Step 4: 브라우저 골든 패스 시각 검증**

`pnpm dev` 후: 이슈 상세 → `@` 입력 → suggestion → 멤버 선택(칩) → 전송 → 메시지에 `@이름` 칩(AGENT 보라/HUMAN 파랑). 에이전트 멘션 시 에이전트 동작 트리거 확인. 한글 입력+Enter 단일 전송, 전송 후 포커스 유지.

- [ ] **Step 5: 잔여 변경 commit (없으면 skip)**

---

## Self-Review

### Spec coverage
- ✅ §4.1 저장 포맷/백엔드 — Task 1(파서), Task 2(필터+서비스)
- ✅ §4.2 ChatRichInput/TipTap/직렬화 — Task 3(deps), Task 4(직렬화), Task 6(MentionList), Task 7(ChatRichInput)
- ✅ §4.3 표시 이름 칩 — Task 5
- ✅ §4.4 수정 — Task 8(editor) + Task 7
- ✅ §6 하위호환 — parseMessageSegments/bodyToDoc 폴백("알 수 없음"), 마이그레이션 없음
- ✅ §7 테스트 — Task 1/4/5(단위), Task 9(E2E)
- ✅ §8 #40-2 스크롤 유지 — Task 9 에서 스크롤 케이스 보존

### Placeholder scan
- 모든 코드 스텝에 실제 코드 포함. Task 2 Step 3 은 grep 명령 + 구체 치환 규칙(@username→<@id>) 제공 — 플레이스홀더 아님.

### Type/네이밍 일관성
- 파서 `parse(): List<Long>` (Task 1) ↔ `filterExistingUserIds(List<Long>)` (Task 2) 일치
- `serializeToBody(JSONContent)`, `bodyToDoc(body, mentions): JSONContent` (Task 4) ↔ ChatRichInput 사용 (Task 7) 일치
- `MentionSegment` / `parseMessageSegments` (Task 5) ↔ ChatMessageRow (Task 5 Step 5) 일치
- `ChatRichInput` props(inputTestId/submitTestId/cancelTestId/clearOnSubmit/initialMentions) (Task 7) ↔ composer/editor 사용 (Task 8) 일치
- testid: `chat-composer-input/submit`, `chat-message-editor-input/save/cancel`, `chat-mention-popover`, `chat-mention-option-{id}`, `chat-mention-chip-{id}` — 컴포넌트(Task 5/6/7/8) ↔ E2E(Task 9) 일치
- `ChatMessageEditor` 시그니처 변경(initialMentions/members 추가) → IssueChatSection 호출부 갱신(Task 8 Step 3) 반영
```
