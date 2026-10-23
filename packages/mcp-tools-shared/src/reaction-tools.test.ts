// react 도구(WP-812) — 채팅 메시지·이슈 코멘트 반응을 한 도구가 대상으로 가른다.
import { describe, expect, it, vi } from 'vitest';
import { resultText } from './mcp-content.js';
import { buildReactionTools } from './reaction-tools.js';
import type { IssueToolClient, MessagingToolClient } from './tool-client.js';

function mockClient() {
  return {
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    addCommentReaction: vi.fn().mockResolvedValue(undefined),
    removeCommentReaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as IssueToolClient & MessagingToolClient & Record<'addReaction' | 'removeReaction' | 'addCommentReaction' | 'removeCommentReaction', ReturnType<typeof vi.fn>>;
}
const react = (c: ReturnType<typeof mockClient>) => buildReactionTools(c)[0];

describe('react', () => {
  it('이슈·메시징 두 앱에 태그된다', () => {
    expect(react(mockClient()).app).toEqual(['issue', 'messaging']);
  });

  it('messageId 면 채팅 반응 — reacted 에 따라 add/remove', async () => {
    const c = mockClient();
    expect(resultText(await react(c).handler({ messageId: 40, emoji: '👍', reacted: true }))).toBe('ok');
    expect(c.addReaction).toHaveBeenCalledWith(40, '👍');
    expect(resultText(await react(c).handler({ messageId: 40, emoji: '👍', reacted: false }))).toBe('ok');
    expect(c.removeReaction).toHaveBeenCalledWith(40, '👍');
    expect(c.addCommentReaction).not.toHaveBeenCalled();
    expect(c.removeCommentReaction).not.toHaveBeenCalled();
  });

  it('issueKey+commentId 면 코멘트 반응 — reacted 에 따라 add/remove', async () => {
    const c = mockClient();
    expect(resultText(await react(c).handler({ issueKey: 'WP-1', commentId: 5, emoji: '👀', reacted: true }))).toBe('ok');
    expect(c.addCommentReaction).toHaveBeenCalledWith('WP-1', 5, '👀');
    expect(resultText(await react(c).handler({ issueKey: 'WP-1', commentId: 5, emoji: '👀', reacted: false }))).toBe('ok');
    expect(c.removeCommentReaction).toHaveBeenCalledWith('WP-1', 5, '👀');
    expect(c.addReaction).not.toHaveBeenCalled();
    expect(c.removeReaction).not.toHaveBeenCalled();
  });

  it('잘못된 입력은 거절한다 — 이모지 1~32자, reacted 필수, 대상은 하나만·코멘트는 둘 다', async () => {
    const c = mockClient();
    const bad = [
      { messageId: 40, emoji: '', reacted: true },
      { messageId: 40, emoji: 'x'.repeat(33), reacted: true },
      { messageId: 40, emoji: '👍' },
      { emoji: '👍', reacted: true },
      { issueKey: 'WP-1', emoji: '👍', reacted: true },
      { commentId: 5, emoji: '👍', reacted: true },
      { messageId: 40, issueKey: 'WP-1', commentId: 5, emoji: '👍', reacted: true },
    ];
    for (const args of bad) await expect(react(c).handler(args), JSON.stringify(args)).rejects.toThrow();
    // 어긋난 경우마다 다른 안내를 준다.
    await expect(react(c).handler({ emoji: '👍', reacted: true })).rejects.toThrow(/give a target/);
    await expect(react(c).handler({ issueKey: 'WP-1', emoji: '👍', reacted: true })).rejects.toThrow(/needs both/);
    await expect(react(c).handler({ messageId: 4, issueKey: 'WP-1', emoji: '👍', reacted: true })).rejects.toThrow(/cannot be combined/);
    expect(c.addReaction).not.toHaveBeenCalled();
    expect(c.addCommentReaction).not.toHaveBeenCalled();
  });
});
