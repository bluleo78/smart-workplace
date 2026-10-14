import { describe, expect, it } from 'vitest';

import type { HomeMessage } from '@/types/home';

import {
  chatLinkSessionId,
  isInternalHref,
  isSessionId,
  LINKED_SESSION_FALLBACK_TITLE,
  linkedSessionSummary,
  withChatParam,
  withLinkedSession,
} from './aiChatLink';

const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';

describe('aiChatLink (WP-384)', () => {
  it('대화 id 는 UUID 모양만', () => {
    expect(isSessionId(ID)).toBe(true);
    expect(isSessionId(ID.toUpperCase())).toBe(true);
    expect(isSessionId('not-a-uuid')).toBe(false);
    expect(isSessionId(null)).toBe(false);
  });

  it('같은 출처 상대 경로만 내부 링크 — 프로토콜 상대(//)·역슬래시(/\\)·절대 URL 은 아니다', () => {
    expect(isInternalHref('/?chat=x')).toBe(true);
    expect(isInternalHref('/projects/WP/issues/12')).toBe(true);
    expect(isInternalHref('//evil.example/x')).toBe(false);
    expect(isInternalHref('/\\evil.example')).toBe(false);
    expect(isInternalHref('https://example.com')).toBe(false);
    expect(isInternalHref(undefined)).toBe(false);
  });

  it('대화 딥링크면 id, 아니면 null', () => {
    expect(chatLinkSessionId(`/?chat=${ID}`)).toBe(ID);
    expect(chatLinkSessionId(`/projects?chat=${ID}`)).toBeNull();
    expect(chatLinkSessionId('/?chat=bad')).toBeNull();
    expect(chatLinkSessionId(`https://x.example/?chat=${ID}`)).toBeNull();
  });

  it('대화 링크는 지금 쿼리에 chat 만 더하고 다른 파라미터는 그대로 둔다', () => {
    expect(withChatParam('', ID)).toBe(`?chat=${ID}`);
    expect(withChatParam('?issue=WP-1&tab=a', ID)).toBe(`?issue=WP-1&tab=a&chat=${ID}`);
    expect(withChatParam('?chat=old&x=1', ID)).toBe(`?chat=${ID}&x=1`);
  });

  const msg = (id: number, role: HomeMessage['role'], content: string | null, createdAt = '2026-10-10T00:00:00Z'): HomeMessage => ({
    id,
    role,
    content,
    widgets: null,
    toolCalls: null,
    createdAt,
  });

  it('링크로 연 대화 제목은 서버 규칙(첫 사용자 메시지, 앞뒤 공백 없이 40자) — 없으면 대체 이름', () => {
    const long = '  고양이 사진은 어디에 모아 두면 좋을까? 폴더 이름도 같이 정해 줘 그리고 정리 규칙도  ';
    const s = linkedSessionSummary(ID, [
      msg(1, 'USER', '   ', '2026-10-01T00:00:00Z'),
      msg(2, 'USER', long),
      msg(3, 'ASSISTANT', '답', '2026-10-02T00:00:00Z'),
    ]);
    expect(s).toEqual({ id: ID, title: long.trim().slice(0, 40), lastMessageAt: '2026-10-02T00:00:00Z', widgetCount: 0 });
    expect(linkedSessionSummary(ID, [msg(1, 'USER', null)]).title).toBe(LINKED_SESSION_FALLBACK_TITLE);
  });

  it('지금 대화가 목록에 없을 때만 끝에 붙인다', () => {
    const a = { id: 'a', title: 'A', lastMessageAt: '2026-10-10T00:00:00Z', widgetCount: 0 };
    const linked = { ...a, id: ID, title: '링크' };
    expect(withLinkedSession([a], undefined)).toEqual([a]);
    expect(withLinkedSession([a], linked)).toEqual([a, linked]);
    const list = [a, linked];
    expect(withLinkedSession(list, { ...linked, title: '다른 제목' })).toBe(list);
  });
});
