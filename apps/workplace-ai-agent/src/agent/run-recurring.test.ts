// WP-989: 반복 회차 실행 — recurring 프로필·전용 지시문으로 돌리고, 결과(성공·실패)를 API 내부 보고로 돌려주는지 검증한다.
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
import { AGENT_INSTRUCTIONS_HEADER } from './agent-instructions.js';
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
// WP-1368: 지시 조회(toolClient().getMember)는 기본 「지시 없음」 — instructions 를 주면 그 지시를 돌려준다.
function client(
  credential: unknown | Error = { provider: 'anthropic', token: 'tk', model: null },
  instructions: string | null = null,
) {
  const member = () => ({ getMember: vi.fn().mockResolvedValue({ userId: 201, instructions }) });
  const scoped = {
    reportRecurringRun: vi.fn().mockResolvedValue(undefined),
    toolClient: vi.fn(member),
  };
  const c = {
    getProviderCredential:
      credential instanceof Error ? vi.fn().mockRejectedValue(credential) : vi.fn().mockResolvedValue(credential),
    reportRecurringRun: vi.fn().mockResolvedValue(undefined),
    toolClient: vi.fn(member),
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
    // MCP 서버는 recurring 프로필로 만든다.
    // 도구는 소유자(7) 대행 + 이벤트 테넌트(5) 스코프 클라이언트 — 홈 AI 채팅과 같은 대행. LLM 자격은 비서(201).
    expect(c.withOnBehalfOfTenant).toHaveBeenCalledWith(5);
    expect(vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0]).toMatchObject({
      profile: 'recurring',
      onBehalfOfId: 7,
      client: c.scoped,
    });
    expect(input.userId).toBe(7);
  });

  // WP-1312: 질문에 소유자가 답해 보낸 이어 처리 — 회차와 같은 AI 자격·소유자 대행·recurring 프로필·프롬프트로 돌고, 이어 처리 지시문을 쓰며,
  // 결과는 이어 처리 runId 로 같은 보고 경로에 돌려준다. 또 확인이 필요하면 다시 question:true.
  it('이어 처리(followUp) — 같은 신원·권한·프로필로 돌고 이어 처리 runId 로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '채널에 초안을 올렸습니다')]);
    const c = client();
    const followUp = {
      ...payload,
      runId: '3-f991',
      followUp: { question: '초안을 채널에 올릴까요?', answer: '올려 줘' },
    };
    await runRecurring(followUp, { client: c });

    expect(c.getProviderCredential).toHaveBeenCalledWith(201);
    expect(c.withOnBehalfOfTenant).toHaveBeenCalledWith(5);
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f991', ok: true, message: '채널에 초안을 올렸습니다' });
    const input = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(input.systemPrompt).toBe(RECURRING_RUN_SYSTEM_PROMPT);
    expect(input.userId).toBe(7);
    expect(input.userMessage).toContain('초안을 채널에 올릴까요?');
    expect(input.userMessage).toContain('올려 줘');
    expect(input.userMessage).not.toContain('2회차 실행');
    expect(vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0]).toMatchObject({
      profile: 'recurring',
      onBehalfOfId: 7,
      client: c.scoped,
    });
  });

  it('이어 처리가 또 확인이 필요하면 question:true 로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '[확인 필요] 받는 사람을 누구로 할까요?')]);
    const c = client();
    await runRecurring({ ...payload, runId: '3-f991', followUp: { question: 'q', answer: 'a' } }, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-f991',
      ok: true,
      message: '받는 사람을 누구로 할까요?',
      question: true,
    });
  });

  // WP-1311: 본문이 확인을 받으라고 해 쓰기를 멈춘 회차는 첫 줄 표지를 떼고 question:true 로 보고한다(API 가 질문 글로 남긴다).
  it('최종 답변이 질문 표지로 시작하면 표지를 떼고 question:true 로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '[확인 필요]\n김대리에게 주간 보고 메일을 보낼까요?')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-1790000000',
      ok: true,
      message: '김대리에게 주간 보고 메일을 보낼까요?',
      question: true,
    });
  });

  it('표지를 굵게·제목으로 감싸도 질문으로 보고, 같은 줄의 나머지는 남긴다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '## **[확인 필요]** 메일 발송 확인\n보낼까요?')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-1790000000',
      ok: true,
      message: '메일 발송 확인\n보낼까요?',
      question: true,
    });
  });

  it('표지가 첫 줄이 아니면 질문이 아니다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '## 정리\n- [확인 필요] 항목 없음')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: '## 정리\n- [확인 필요] 항목 없음' });
  });

  // WP-1376: 결과 맨 끝 「정해 주세요」 절에 항목이 있으면 결과 전체를 그대로 질문으로 보고한다(`[확인 필요]` 와 같은 질문 경로).
  it('결과 맨 끝 「정해 주세요」 절에 항목이 있으면 결과 전체를 question:true 로 보고한다', async () => {
    const body = '## 오늘 정리\n- 메일 3건 분류\n\n## 정해 주세요\n1. 거래처 견적 메일에 회신할까요? (회신 / 보류)';
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', body)]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: body, question: true });
  });

  it('이어 처리 결과가 다시 「정해 주세요」로 물으면 question:true, 절 없이 끝나면 질문이 아니다', async () => {
    const again = '답에서 고른 항목을 알 수 없어 처리하지 않았습니다.\n\n### 정해 주세요\n1. 회신할까요, 보류할까요?';
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', again)]);
    const c = client();
    await runRecurring({ ...payload, runId: '3-f991', followUp: { question: 'q', answer: '음' } }, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f991', ok: true, message: again, question: true });

    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '하지 않았습니다.')]);
    const c2 = client();
    await runRecurring({ ...payload, runId: '3-f992', followUp: { question: 'q', answer: '넘어가' } }, { client: c2 });
    expect(c2.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f992', ok: true, message: '하지 않았습니다.' });
  });

  it('「제안」 절만 있는 결과는 질문이 아니다', async () => {
    const body = '## 오늘 정리\n- 메일 3건 분류\n\n## 제안\n1. 거래처 메일을 따로 폴더로 모으면 좋겠습니다';
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', body)]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: body });
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

  // WP-1368: 이 AI 의 지시는 실행 AI(201) 자신을 테넌트 스코프 클라이언트로 조회해 시스템 프롬프트 맨 뒤에 붙인다.
  it('지시가 있으면 systemPrompt 끝에 지시 블록, 없으면 기존 상수 그대로', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client(undefined, '결과는 세 줄로 요약한다');
    await runRecurring(payload, { client: c });
    expect(c.scoped.toolClient).toHaveBeenCalledWith(201);
    const withInstr = vi.mocked(runSdkCollect).mock.calls[0][0].systemPrompt as string;
    expect(withInstr.startsWith(RECURRING_RUN_SYSTEM_PROMPT)).toBe(true);
    expect(withInstr).toContain(AGENT_INSTRUCTIONS_HEADER);
    expect(withInstr.endsWith('\n\n결과는 세 줄로 요약한다')).toBe(true);

    await runRecurring(payload, { client: client() });
    expect(vi.mocked(runSdkCollect).mock.calls[1][0].systemPrompt).toBe(RECURRING_RUN_SYSTEM_PROMPT);
  });

  it('지시 조회가 실패해도 지시 없이 실행하고 결과를 보고한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    const c = client();
    c.scoped.toolClient.mockReturnValue({ getMember: vi.fn().mockRejectedValue(new Error('500')) });
    await runRecurring(payload, { client: c });
    expect(vi.mocked(runSdkCollect).mock.calls[0][0].systemPrompt).toBe(RECURRING_RUN_SYSTEM_PROMPT);
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: 'ok' });
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

// WP-1313: 「지금 실행」(테스트 실행, issue.recurring_test_run) — recurring-test 프로필로 돌고, 도구 래퍼가 멈춘 되돌릴 수 없는 쓰기를
// 질문과 함께 보고한다. 테스트 질문의 이어 처리는 그 멈춘 쓰기만 허락받는다.
describe('runRecurring — 테스트 실행', () => {
  beforeEach(() => {
    vi.mocked(runSdkCollect).mockReset();
    vi.mocked(buildInProcessWorkplaceMcpServer).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const testRun = { ...payload, runId: '3-t1790000000123', round: undefined };

  // 실행 중 도구 래퍼가 멈춘 쓰기를 알린 것처럼 — MCP 서버에 넘긴 호스트 브리지로 onProposal 을 부른 뒤 최종 답변을 낸다.
  function runWithPaused(final: string, paused: Array<{ tool: string; args: Record<string, unknown> }>) {
    vi.mocked(runSdkCollect).mockImplementation(async () => {
      const bridge = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls.at(-1)?.[0].hostBridge;
      for (const a of paused) bridge?.onProposal({ actionType: a.tool, summary: '', params: a.args });
      return [resultLine('success', final)];
    });
  }

  it('recurring-test 프로필·테스트 지시문으로 돌고, 멈춘 쓰기가 없으면 결과를 그대로 보고한다', async () => {
    runWithPaused('## 정리\n- 3건', []);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });

    const mcp = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0];
    expect(mcp).toMatchObject({ profile: 'recurring-test', onBehalfOfId: 7, client: c.scoped, recurringPermits: [] });
    expect(mcp.hostBridge).toBeDefined();
    const input = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(input.userMessage).toContain('[이벤트: issue.recurring_test_run]');
    expect(input.userMessage).toContain('「지금 실행」');
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-t1790000000123', ok: true, message: '## 정리\n- 3건' });
  });

  it('메일 보내기를 멈췄으면 질문으로, 멈춘 쓰기와 함께 보고한다', async () => {
    const mail = { accountId: 3, to: ['boss@x.com'], subject: '주간 보고' };
    runWithPaused('[확인 필요] 주간 보고 메일을 팀장님께 보낼까요?', [{ tool: 'send_mail', args: mail }]);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-t1790000000123',
      ok: true,
      message: '주간 보고 메일을 팀장님께 보낼까요?',
      question: true,
      pausedActions: [{ tool: 'send_mail', args: mail }],
    });
  });

  it('멈췄는데 모델이 표지를 빠뜨리거나 답을 비워도 질문으로 보고한다', async () => {
    runWithPaused('메일 초안을 준비했습니다', [{ tool: 'send_mail', args: {} }]);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    expect(c.scoped.reportRecurringRun).toHaveBeenLastCalledWith(201, 3, expect.objectContaining({ message: '메일 초안을 준비했습니다', question: true }));

    runWithPaused('', [{ tool: 'delete_event', args: { eventId: 7 } }]);
    const c2 = client();
    await runRecurring(testRun, { client: c2 }, { test: true });
    const body = c2.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ ok: true, question: true, pausedActions: [{ tool: 'delete_event', args: { eventId: 7 } }] });
    expect(body.message).toContain('delete_event');
  });

  // 멈춘 쓰기가 있는데 실행이 비정상으로 끝나면(최대 턴·시간 초과·오류) 실패로 버리지 않고 질문으로 — 답하면 그 쓰기만 이어 처리한다.
  it('멈춘 뒤 최대 턴 등으로 비정상 종료하면 실패가 아니라 멈춘 쓰기와 함께 질문으로 보고한다', async () => {
    const mail = { subject: '주간 보고' };
    vi.mocked(runSdkCollect).mockImplementation(async () => {
      const bridge = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls.at(-1)?.[0].hostBridge;
      bridge?.onProposal({ actionType: 'send_mail', summary: '', params: mail });
      return [resultLine('error_max_turns', '')];
    });
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ runId: '3-t1790000000123', ok: true, question: true, pausedActions: [{ tool: 'send_mail', args: mail }] });
    expect(body.message).toContain('실행이 중간에 끝났습니다(AI 실행이 정상적으로 끝나지 않았습니다)');
    expect(body.message).toContain('메일 보내기 (`send_mail`)');
    expect(body.message).toContain('주간 보고');
  });

  it('멈춘 뒤 러너가 던져도(시간 초과) 사유를 적은 질문으로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockImplementation(async () => {
      const bridge = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls.at(-1)?.[0].hostBridge;
      bridge?.onProposal({ actionType: 'delete_event', summary: '', params: { eventId: 7 } });
      throw new Error('timeout after 300000ms\nstack...');
    });
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ ok: true, question: true, pausedActions: [{ tool: 'delete_event', args: { eventId: 7 } }] });
    expect(body.message).toContain('실행이 중간에 끝났습니다(timeout after 300000ms)');
    expect(body.message).toContain('일정 지우기 (`delete_event`)');
  });

  it('멈춘 쓰기 없이 비정상 종료한 테스트 실행은 그대로 실패로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('error_max_turns', '')]);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-t1790000000123',
      ok: false,
      message: 'AI 실행이 정상적으로 끝나지 않았습니다',
    });
  });

  it('테스트 질문의 이어 처리는 그 질문이 멈춘 쓰기만 허락받고, 허락된 쓰기를 지시문에 보인다', async () => {
    runWithPaused('보냈습니다', []);
    const c = client();
    const followUp = {
      ...testRun,
      runId: '3-f77',
      followUp: {
        question: '주간 보고 메일을 보낼까요?',
        answer: '보내 줘',
        permittedActions: [{ tool: 'send_mail', args: { subject: '주간 보고' } }],
      },
    };
    await runRecurring(followUp, { client: c }, { test: true });
    expect(vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0]).toMatchObject({
      profile: 'recurring-test',
      recurringPermits: ['send_mail'],
    });
    const msg = vi.mocked(runSdkCollect).mock.calls[0][0].userMessage;
    expect(msg).toContain('[이벤트: issue.recurring_test_run · 이어 처리]');
    expect(msg).toContain('send_mail {"subject":"주간 보고"}');
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f77', ok: true, message: '보냈습니다' });
  });

  it('정기 회차는 호스트 브리지·허락 없이 recurring 프로필로 돈다', async () => {
    runWithPaused('ok', []);
    await runRecurring(payload, { client: client() });
    const mcp = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0];
    expect(mcp.profile).toBe('recurring');
    expect(mcp.hostBridge).toBeUndefined();
    expect(mcp.recurringPermits).toBeUndefined();
  });
});
