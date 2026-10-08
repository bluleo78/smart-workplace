import { describe, it, expect, vi } from 'vitest';
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildFinalizeUserMessage, finalizeAfterLimit, ToolResultCollector } from './ai-chat-finalize.js';
import type { AgentRunner } from './agent-runner.js';

// 한도 도달 마무리 — 도구 결과 수집 상한과 마무리 호출 결과 처리.
describe('ToolResultCollector', () => {
  it('tool_result 만 적재하고 시작·오류 결과는 건너뛴다', () => {
    const c = new ToolResultCollector();
    c.add({ seq: 1, event: 'tool_use_start', toolName: 'a', args: {} });
    c.add({ seq: 1, event: 'tool_result', toolName: 'a', isError: true, result: 'err' });
    c.add({ seq: 2, event: 'tool_result', toolName: 'list_issues', result: 'WP-1' });
    expect(c.toBlock()).toBe('### list_issues\nWP-1');
  });

  it('결과가 없으면 "없음"을 명시', () => {
    expect(new ToolResultCollector().toBlock()).toBe('(조회된 결과 없음)');
  });

  it('결과 1건은 4000자에서 자르고, 총량 초과 시 오래된 결과부터 버린다', () => {
    const c = new ToolResultCollector();
    for (let k = 0; k < 15; k++) c.add({ seq: k, event: 'tool_result', toolName: `t${k}`, result: 'x'.repeat(5_000) });
    const block = c.toBlock();
    expect(block).toContain('…(생략)');
    expect(block).not.toContain('### t0\n'); // 오래된 것 탈락
    expect(block).toContain('### t14\n'); // 최근 것 유지
    expect(block.length).toBeLessThanOrEqual(40_000 + 20);
  });

  it('마무리 user 메시지 = 원래 요청 + 조회 결과 블록', () => {
    const c = new ToolResultCollector();
    c.add({ seq: 1, event: 'tool_result', toolName: 'x', result: 'r' });
    expect(buildFinalizeUserMessage('현재 요청: 질문', c)).toBe('현재 요청: 질문\n\n## 지금까지 조회한 결과\n### x\nr');
  });
});

describe('finalizeAfterLimit', () => {
  const base = (collect: AgentRunner['collect']) => ({
    runner: { stream: vi.fn(), collect } as unknown as AgentRunner,
    credential: { provider: 'anthropic' as const, token: 't', model: null },
    model: 'm',
    agentId: 9,
    userId: 1,
    kind: 'max_turns' as const,
    originalUserMessage: 'q',
    results: new ToolResultCollector(),
    dateDirective: '',
    timeoutMs: 45_000,
  });

  it('성공 result 텍스트와 사용량을 반환, 받은 timeoutMs 를 러너에 전달', async () => {
    const usage = { inputTokens: 10, outputTokens: 5 };
    const collect = vi.fn().mockResolvedValue([{ type: 'result', ok: true, text: ' 답 ', usage }]);
    const out = await finalizeAfterLimit({ ...base(collect), timeoutMs: 12_000 });
    expect(out).toEqual({ text: '답', usage });
    expect(collect.mock.calls[0][0].timeoutMs).toBe(12_000);
  });

  it('실패 result 의 부분 텍스트는 답으로 쓰지 않는다', async () => {
    const out = await finalizeAfterLimit(base(vi.fn().mockResolvedValue([{ type: 'result', ok: false, text: '부분', usage: null }])));
    expect(out.text).toBe('');
  });

  it('러너 실패 시 빈 텍스트(호출자가 오류로 되돌림)', async () => {
    const out = await finalizeAfterLimit(base(vi.fn().mockRejectedValue(new Error('x'))));
    expect(out).toEqual({ text: '', usage: null });
  });
});
