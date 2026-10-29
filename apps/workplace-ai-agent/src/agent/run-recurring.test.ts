// WP-989: 반복 회차 실행 — 읽기 전용 프로필·전용 지시문으로 돌리고, 결과(성공·실패)를 API 내부 보고로 돌려주는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 인-프로세스 러너·MCP 서버를 모킹 — 호출 인자만 검증(LLM/네트워크 미실행).
vi.mock('./sdk-runner.js', () => ({
  runSdkCollect: vi.fn().mockResolvedValue([]),
}));
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => ({ __sentinel: 'workplace-mcp' })),
}));

import { AxiosError, AxiosHeaders } from 'axios';
import { REPORT_RETRY_DELAYS_MS, runRecurring } from './run-recurring.js';
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

// API 응답 오류 — status 가 없으면 응답 없이 끊긴 요청(네트워크 오류)이다.
function axiosError(status: number | undefined): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    status ? `Request failed with status code ${status}` : 'socket hang up',
    status ? 'ERR_BAD_RESPONSE' : 'ECONNRESET',
    config,
    undefined,
    status ? { status, statusText: '', headers: {}, config, data: {} } : undefined,
  );
}

// 기다리지 않는 sleep — 요청한 간격만 기록한다.
const noSleep = () => vi.fn((_ms: number) => Promise.resolve());

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

  it('보고 호출이 끝내 실패해도 던지지 않는다 — 정한 횟수만큼 다시 보낸 뒤 그만둔다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client();
    c.scoped.reportRecurringRun.mockRejectedValue(axiosError(undefined));
    await expect(runRecurring(payload, { client: c, sleep: noSleep() })).resolves.toBeUndefined();
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledTimes(REPORT_RETRY_DELAYS_MS.length + 1);
  });

  // WP-1118: 결과 보고가 일시 오류로 실패하면 쉬었다 다시 보낸다 — 한 번만 보내면 성공한 회차가 30분 뒤 실패로 세졌다.
  it('일시 오류(응답 없음·5xx·408·429)면 같은 본문으로 다시 보내 성공한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '## 정리')]);
    const c = client();
    c.scoped.reportRecurringRun
      .mockRejectedValueOnce(axiosError(undefined))
      .mockRejectedValueOnce(axiosError(503))
      .mockRejectedValueOnce(axiosError(408))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce(undefined);
    await runRecurring(payload, { client: c, sleep: noSleep() });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledTimes(5);
    for (const call of c.scoped.reportRecurringRun.mock.calls) {
      expect(call).toEqual([201, 3, { runId: '3-1790000000', ok: true, message: '## 정리' }]);
    }
  });

  it('권한·잘못된 요청(4xx)이나 axios 가 아닌 오류면 다시 보내지 않는다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    for (const err of [axiosError(403), axiosError(400), new TypeError('boom')]) {
      const c = client();
      const sleep = noSleep();
      c.scoped.reportRecurringRun.mockRejectedValue(err);
      await runRecurring(payload, { client: c, sleep });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('다시 보내기 전 간격은 2초부터 2분까지 차례로 늘고, 흔들림은 ±20% 안이다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client();
    c.scoped.reportRecurringRun.mockRejectedValue(axiosError(502));
    const sleep = noSleep();
    await runRecurring(payload, { client: c, sleep, random: () => 0.5 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 5_000, 15_000, 30_000, 60_000, 120_000]);

    const c2 = client();
    c2.scoped.reportRecurringRun.mockRejectedValueOnce(axiosError(502)).mockResolvedValueOnce(undefined);
    const lo = noSleep();
    await runRecurring(payload, { client: c2, sleep: lo, random: () => 0 });
    expect(lo.mock.calls).toEqual([[1_600]]);
    const c3 = client();
    c3.scoped.reportRecurringRun.mockRejectedValueOnce(axiosError(502)).mockResolvedValueOnce(undefined);
    const hi = noSleep();
    await runRecurring(payload, { client: c3, sleep: hi, random: () => 0.999999 });
    expect(hi.mock.calls[0][0]).toBe(2_400);
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
