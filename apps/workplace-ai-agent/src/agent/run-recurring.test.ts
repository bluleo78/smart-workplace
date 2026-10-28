// WP-989: 반복 회차 실행 — 읽기 전용 프로필·전용 지시문으로 돌리고, 결과(성공·실패)를 API 내부 보고로 돌려주는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 인-프로세스 러너·MCP 서버를 모킹 — 호출 인자만 검증(LLM/네트워크 미실행).
vi.mock('./sdk-runner.js', () => ({
  runSdkCollect: vi.fn().mockResolvedValue([]),
}));
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => ({ __sentinel: 'workplace-mcp' })),
}));

import { runRecurring } from './run-recurring.js';
import { runSdkCollect } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { RECURRING_RUN_SYSTEM_PROMPT } from './system-prompt.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { IssueRecurringRunPayload } from '../types/issue-events.js';

const payload: IssueRecurringRunPayload = {
  projectKey: 'P1',
  issueKey: 'P1-3',
  issueId: 3,
  issueTitle: '매일 정리',
  actor: { id: 7, username: 'owner', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'my-ai', kind: 'AGENT' }],
  occurredAt: '2026-09-21T14:13:20Z',
  actingAgentId: 201,
  ownerUserId: 7,
  tenantId: 5,
  runId: '3-1790000000',
  runAt: '2026-09-21T23:13:20+09:00',
  round: 2,
  recurrence: { rrule: 'FREQ=DAILY', time: '23:13' },
  issueBody: '오늘 할 일을 정리해 줘',
};

// 테넌트 스코프 클라이언트(withOnBehalfOfTenant)는 별도 객체로 — 도구 대행·결과 보고가 스코프 쪽으로 가는지 본다.
function client(credential: unknown | Error = { provider: 'anthropic', token: 'tk', model: null }) {
  const scoped = {
    reportRecurringRun: vi.fn().mockResolvedValue(undefined),
    toolClient: vi.fn(),
  };
  const c = {
    getProviderCredential:
      credential instanceof Error ? vi.fn().mockRejectedValue(credential) : vi.fn().mockResolvedValue(credential),
    reportRecurringRun: vi.fn().mockResolvedValue(undefined),
    toolClient: vi.fn(),
    withOnBehalfOfTenant: vi.fn(() => scoped),
    scoped,
  };
  return c as unknown as WorkplaceApiClient & {
    reportRecurringRun: ReturnType<typeof vi.fn>;
    withOnBehalfOfTenant: ReturnType<typeof vi.fn>;
    scoped: typeof scoped;
  };
}

const resultLine = (subtype: string, result: string) => JSON.stringify({ type: 'result', subtype, result });

describe('runRecurring', () => {
  beforeEach(() => {
    vi.mocked(runSdkCollect).mockReset();
    vi.mocked(buildInProcessWorkplaceMcpServer).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('성공 — 최종 답변을 ok:true 로 보고하고, recurring 프로필·전용 프롬프트·회차 지시문으로 돈다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '## 오늘 정리\n- 3건')]);
    const c = client();
    await runRecurring(payload, { client: c });

    expect(c.getProviderCredential).toHaveBeenCalledWith(201);
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: '## 오늘 정리\n- 3건' });
    const input = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(input.systemPrompt).toBe(RECURRING_RUN_SYSTEM_PROMPT);
    expect(input.userMessage).toContain('2회차');
    expect(input.userMessage).toContain('오늘 할 일을 정리해 줘');
    // MCP 서버는 읽기 전용 recurring 프로필로 만든다.
    // 도구는 소유자(7) 대행 + 이벤트 테넌트(5) 스코프 클라이언트 — 홈 AI 채팅과 같은 대행. LLM 자격은 비서(201).
    expect(c.withOnBehalfOfTenant).toHaveBeenCalledWith(5);
    expect(vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0]).toMatchObject({
      profile: 'recurring',
      onBehalfOfId: 7,
      client: c.scoped,
    });
    expect(input.userId).toBe(7);
  });

  it('실행이 실패로 끝나면 ok:false 로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('error_max_turns', '')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, expect.objectContaining({ runId: '3-1790000000', ok: false }));
  });

  it('러너가 던지면(타임아웃 등) 사유와 함께 ok:false', async () => {
    vi.mocked(runSdkCollect).mockRejectedValue(new Error('timeout after 300000ms\nstack...'));
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: false, message: 'timeout after 300000ms' });
  });

  it('결과가 비면 ok:false', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '   ')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, expect.objectContaining({ ok: false }));
  });

  it('자격 증명을 못 가져오면 실행하지 않고 ok:false', async () => {
    const c = client(new Error('401'));
    await runRecurring(payload, { client: c });
    expect(runSdkCollect).not.toHaveBeenCalled();
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, expect.objectContaining({ ok: false }));
  });

  it('보고 호출이 실패해도 던지지 않는다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client();
    c.scoped.reportRecurringRun.mockRejectedValue(new Error('network'));
    await expect(runRecurring(payload, { client: c })).resolves.toBeUndefined();
  });
});

describe('runRecurring — 테넌트 없음', () => {
  it('tenantId 가 없으면 스코프 없이 기본 클라이언트로 대행·보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client();
    await runRecurring({ ...payload, tenantId: null }, { client: c });
    expect(c.withOnBehalfOfTenant).not.toHaveBeenCalled();
    expect(c.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: 'ok' });
  });
});
