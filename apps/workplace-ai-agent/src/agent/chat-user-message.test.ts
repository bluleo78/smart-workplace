import { describe, it, expect } from 'vitest';

import { buildChatUserMessage } from './chat-user-message.js';
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { PresentedAttachments } from './attachment-presenter.js';

const NONE_PRESENTED: PresentedAttachments = { section: '첨부 없음', guidance: '' };

const payload: ChatMessagePostedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  threadId: 5,
  messageId: 9,
  actor: { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
  body: '@AI 첨부 요약해줘',
  mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
  occurredAt: '2026-05-30T12:00:00Z',
};
const recent: ChatMessageItem[] = [
  { id: 8, authorName: 'Alice', authorKind: 'HUMAN', body: '이전 메시지', createdAt: 't', deleted: false },
];

describe('buildChatUserMessage', () => {
  it('trigger·thread·이슈키·threadId 포함', () => {
    const msg = buildChatUserMessage(payload, recent, NONE_PRESENTED);
    expect(msg).toContain('WP-1');
    expect(msg).toContain('첨부 요약해줘');
    expect(msg).toContain('이전 메시지');
    expect(msg).toContain('5'); // threadId
  });

  it('presenter 결과(section·guidance)를 첨부 섹션과 지시문에 넣는다', () => {
    const msg = buildChatUserMessage(payload, recent, {
      section: '- [이슈 첨부] a.pdf (application/pdf, 5B)\n  - 텍스트: read_attachment_text({issueKey:"WP-1", fileId:3}) — 약 5자',
      guidance: '첨부는 위 안내대로 읽으세요',
    });
    expect(msg).toContain('## 첨부파일');
    expect(msg).toContain('read_attachment_text({issueKey:"WP-1", fileId:3})');
    expect(msg).toContain('첨부는 위 안내대로 읽으세요');
    expect(msg).not.toContain('이미지/PDF/텍스트 모두 가능');
  });

  it('첨부 없음 → 첨부 섹션에 없음 표기', () => {
    expect(buildChatUserMessage(payload, recent, NONE_PRESENTED)).toContain('첨부 없음');
  });

  // #368: 이슈 제목·상태·본문을 user message 에 직접 주입(AGENT 비멤버라 get_issue_detail 403 → 미리 주입).
  it('#368 이슈 컨텍스트(제목·상태·본문) 주입', () => {
    const enriched: ChatMessagePostedPayload = {
      ...payload,
      issueTitle: '로그인 버그',
      issueStatus: 'IN_PROGRESS',
      issueBody: '재현 절차: 로그인 시 500 에러',
    };
    const msg = buildChatUserMessage(enriched, recent, NONE_PRESENTED);
    expect(msg).toContain('현재 이슈 컨텍스트');
    expect(msg).toContain('로그인 버그');
    expect(msg).toContain('IN_PROGRESS');
    expect(msg).toContain('재현 절차: 로그인 시 500 에러');
  });

  // 구버전 이벤트(컨텍스트 필드 부재)에도 깨지지 않고 placeholder 로 graceful 표기.
  it('#368 이슈 컨텍스트 누락 시 (제목 없음)/(본문 없음) placeholder', () => {
    const msg = buildChatUserMessage(payload, recent, NONE_PRESENTED);
    expect(msg).toContain('(제목 없음)');
    expect(msg).toContain('(본문 없음)');
  });
});
