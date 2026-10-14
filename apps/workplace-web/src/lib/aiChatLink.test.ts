import { describe, expect, it } from 'vitest';

import { chatLinkSessionId, isInternalHref, isSessionId } from './aiChatLink';

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
});
