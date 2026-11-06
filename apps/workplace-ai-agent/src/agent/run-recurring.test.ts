// WP-989: 반복 회차 실행 — recurring 프로필·전용 지시문으로 돌리고, 결과(성공·실패)를 API 내부 보고로 돌려주는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 인-프로세스 러너·MCP 서버를 모킹 — 호출 인자만 검증(LLM/네트워크 미실행).
// WP-1407: runRecurring 은 collect 대신 stream 을 쓴다 — 기존 테스트가 runSdkCollect 로 정한 라인을 runSdkStream 이 그대로 흘리게 잇는다.
// 이벤트를 흘린 뒤 실패(시간 초과)하는 경우는 테스트가 runSdkStream 을 직접 바꾼다.
vi.mock('./sdk-runner.js', () => {
  const runSdkCollect = vi.fn().mockResolvedValue([]);
  const runSdkStream = vi.fn((input: unknown, onLine: (line: string) => void) => ({
    done: Promise.resolve(runSdkCollect(input)).then((lines: string[] | undefined) => {
      for (const l of lines ?? []) onLine(l);
    }),
    kill: () => {},
  }));
  return { runSdkCollect, runSdkStream };
});
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => ({ __sentinel: 'workplace-mcp' })),
}));

import { AxiosError, AxiosHeaders } from 'axios';
import { looksLikeUnmarkedQuestion, REPORT_RETRY_DELAYS_MS, runRecurring } from './run-recurring.js';
import { runSdkCollect, runSdkStream } from './sdk-runner.js';
import { RunnerLimitError } from './runner-limit.js';
import { log } from '../logger.js';
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
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ runId: '3-1790000000', ok: false });
    // 일반 오류는 첫 줄을 사유로, 실행 기록 요약을 함께 싣는다.
    expect(body.message).toMatch(/^timeout after 300000ms — 걸린 시간 \d+초 \/ 한도 30분 · 줄 대기 0초\n모델 호출 0회 · 도구 호출 0회 · 마지막 단계: 모델 응답 대기 \d+초$/);
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
    expect(body.message).toContain('실행이 중간에 끝났습니다(AI 실행이 정상적으로 끝나지 않았습니다 — 걸린 시간');
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
    expect(body.message).toContain('실행이 중간에 끝났습니다(timeout after 300000ms — 걸린 시간');
    expect(body.message).toContain('일정 지우기 (`delete_event`)');
  });

  it('멈춘 쓰기 없이 비정상 종료한 테스트 실행은 그대로 실패로 보고한다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('error_max_turns', '')]);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ runId: '3-t1790000000123', ok: false });
    // 테스트 실행은 회차 시각이 없어 줄 대기를 적지 않는다.
    expect(body.message).toMatch(/^AI 실행이 정상적으로 끝나지 않았습니다 — 걸린 시간 \d+초 \/ 한도 30분\n/);
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

// WP-1407: 반복 상한(대화형과 따로)·실행 기록(로그·실패 글 요약)·같은 AI 동시 실행 수.
describe('runRecurring — 반복 상한·실행 기록', () => {
  const ENV_KEYS = [
    'WORKPLACE_AI_RECURRING_TIMEOUT_MS',
    'WORKPLACE_AI_RECURRING_MAX_TURNS',
    'WORKPLACE_AI_TIMEOUT_MS',
    'WORKPLACE_AI_MAX_TURNS',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.mocked(runSdkCollect).mockReset();
    vi.mocked(runSdkStream).mockClear();
    vi.mocked(log.info).mockClear();
    vi.mocked(log.warn).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  // 러너에 넘긴 상한 — Claude 러너는 runSdkStream 입력(SdkRunInput)에 그대로 싣는다.
  async function limitsPassed(): Promise<{ timeoutMs: number; maxTurns: number }> {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', 'ok')]);
    await runRecurring(payload, { client: client() });
    const input = vi.mocked(runSdkStream).mock.calls.at(-1)![0];
    return { timeoutMs: input.timeoutMs, maxTurns: input.maxTurns };
  }

  // Claude SDK 라인 — assistant 메시지(도구 호출 하나)와 그 도구 결과.
  const assistantTool = (name: string, input: unknown = { secret: 'arg-value' }) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name, input }], usage: { input_tokens: 100, output_tokens: 20 } },
    });
  const toolResult = () => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '본문' }] } });

  // 라인을 흘린 뒤 err 로 실패하는 스트림 — 시간 초과처럼 끝나기 전에 받은 이벤트가 기록에 남는지 본다.
  function streamThenFail(lines: string[], err: Error) {
    vi.mocked(runSdkStream).mockImplementationOnce((_i, onLine) => ({
      done: (async () => {
        for (const l of lines) onLine(l);
        throw err;
      })(),
      kill: () => {},
    }));
  }

  it('env 가 없으면 반복 상한 30분·60턴이다', async () => {
    expect(await limitsPassed()).toEqual({ timeoutMs: 1_800_000, maxTurns: 60 });
  });

  it('WORKPLACE_AI_RECURRING_* 로 덮어쓰고, 대화형 env 는 반복에 영향이 없다', async () => {
    process.env.WORKPLACE_AI_RECURRING_TIMEOUT_MS = '1234';
    process.env.WORKPLACE_AI_RECURRING_MAX_TURNS = '7';
    process.env.WORKPLACE_AI_TIMEOUT_MS = '1';
    process.env.WORKPLACE_AI_MAX_TURNS = '2';
    expect(await limitsPassed()).toEqual({ timeoutMs: 1234, maxTurns: 7 });
  });

  it.each(['', 'abc', '0', '-5'])('잘못된 값(%j)이면 기본값', async (bad) => {
    process.env.WORKPLACE_AI_RECURRING_TIMEOUT_MS = bad;
    process.env.WORKPLACE_AI_RECURRING_MAX_TURNS = bad;
    expect(await limitsPassed()).toEqual({ timeoutMs: 1_800_000, maxTurns: 60 });
  });

  it('시간 초과 — 사람 말 사유·걸린 시간·한도·줄 대기·호출 요약을 보고하고 내부 문구는 싣지 않는다', async () => {
    streamThenFail(
      [assistantTool('mcp__workplace__list_issues'), toolResult(), assistantTool('mcp__workplace__update_issue'), toolResult()],
      new RunnerLimitError('timeout', 'agent:issue.recurring_run:P1-3:201 timeout after 1800000ms'),
    );
    const c = client();
    // 회차 시각보다 12분 3초 늦게 보냈다 — 줄 대기.
    await runRecurring({ ...payload, occurredAt: '2026-09-21T14:25:23Z' }, { client: c });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body.ok).toBe(false);
    expect(body.message).toContain('실행 시간 한도를 넘겼습니다');
    expect(body.message).toContain('걸린 시간');
    expect(body.message).toContain('한도 30분');
    expect(body.message).toContain('줄 대기 12분 3초');
    // 같은 AI 동시 실행 수는 사용자 글에 싣지 않는다 — API 줄이 겹침을 막아 잡음이다(로그에만 남긴다).
    expect(body.message).not.toContain('함께 돈');
    expect(body.message).toContain('모델 호출 2회');
    expect(body.message).toContain('도구 호출 2회(list_issues 1, update_issue 1)');
    expect(body.message).toContain('마지막 단계: 모델 응답 대기');
    expect(body.message).not.toContain('timeout after');
    expect(body.message).not.toContain('agent:issue');

    // 실패 기록 로그 — warn, 숫자·이름만.
    const [, event, fields] = vi.mocked(log.warn).mock.calls.find((c) => c[1] === 'recurring_run_trace')!;
    expect(event).toBe('recurring_run_trace');
    expect(fields).toMatchObject({ outcome: 'timeout', modelCalls: 2, toolCalls: 2, waitMs: 723_000, lastStep: 'model_wait' });
    expect(JSON.stringify(fields)).not.toContain('arg-value');
  });

  // 리뷰: stream 경로에서도 제공자 오류(success + is_error, WP-1347)를 성공 결과로 남기지 않고, 원인 문구를 사유에 싣는다.
  // 러너(runSdkStream)는 그때 「<logTag> result is_error: <원인>」으로 던진다(sdk-runner.test.ts) — 여기서는 그 오류를 받은 회차의 보고를 본다.
  it('제공자 오류 result 면 ok:false, 사유에 원인 문구(로그 태그 없이)', async () => {
    streamThenFail(
      [JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: '401 invalid x-api-key' })],
      new Error('agent:issue.recurring_run:P1-3:201 result is_error: 401 invalid x-api-key'),
    );
    const c = client();
    await runRecurring(payload, { client: c });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/^result is_error: 401 invalid x-api-key — 걸린 시간/);
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledTimes(1);
  });

  it('러너가 던지지 않아도 result 가 is_error 면 성공으로 보고하지 않는다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 Overloaded' }),
    ]);
    const c = client();
    await runRecurring(payload, { client: c });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/^AI 실행이 정상적으로 끝나지 않았습니다/);
  });

  it('최대 턴 — 「최대 턴(60)에 닿았습니다」', async () => {
    streamThenFail([], new RunnerLimitError('max_turns', 'Reached maximum number of turns'));
    const c = client();
    await runRecurring(payload, { client: c });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body.message).toMatch(/^최대 턴\(60\)에 닿았습니다 — /);
  });

  it('성공 회차도 실행 기록 로그를 남기고, 도구 인자·결과·본문은 싣지 않는다', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      assistantTool('mcp__workplace__list_issues', { query: '비밀-인자' }),
      toolResult(),
      resultLine('success', '## 결과 본문'),
    ]);
    await runRecurring(payload, { client: client() });
    const call = vi.mocked(log.info).mock.calls.find((c) => c[1] === 'recurring_run_trace')!;
    expect(call[2]).toMatchObject({ outcome: 'ok', issueKey: 'P1-3', runId: '3-1790000000', modelCalls: 1, toolCalls: 1, tools: { list_issues: 1 } });
    const json = JSON.stringify(call[2]);
    expect(json).not.toContain('비밀-인자');
    expect(json).not.toContain('결과 본문');
    expect(json).not.toContain('본문');
  });

  it('API 가 보낸 대로 바로 실행한다 — 같은 AI 두 회차가 겹치면 각자 로그에 concurrentSameAgent 1, 다른 AI 면 0', async () => {
    // 실행 기록 로그(warn)에서 runId 로 그 실행의 같은 AI 동시 실행 수를 찾는다 — 사용자 글에는 싣지 않는다.
    const concurrentOf = (runId: string) =>
      vi
        .mocked(log.warn)
        .mock.calls.filter((c) => c[1] === 'recurring_run_trace' && (c[2] as { runId?: string }).runId === runId)
        .map((c) => (c[2] as { concurrentSameAgent?: number }).concurrentSameAgent);
    // 두 실행이 모두 러너를 시작할 때까지 끝내지 않는다 — 서로 기다리지 않고 둘 다 시작하는지도 본다.
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(runSdkStream).mockImplementation(() => {
      started += 1;
      if (started === 2) release();
      return {
        done: gate.then(() => {
          throw new RunnerLimitError('timeout', 'x timeout after 1ms');
        }),
        kill: () => {},
      };
    });
    const a = client();
    const b = client();
    await Promise.all([
      runRecurring(payload, { client: a }),
      runRecurring({ ...payload, issueId: 4, runId: '4-1790000000' }, { client: b }),
    ]);
    expect(started).toBe(2);
    expect(concurrentOf('3-1790000000')).toEqual([1]);
    expect(concurrentOf('4-1790000000')).toEqual([1]);
    expect(a.scoped.reportRecurringRun.mock.calls[0][2].message).not.toContain('함께 돈');

    vi.mocked(log.warn).mockClear();

    started = 0;
    const c1 = client();
    const c2 = client();
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    vi.mocked(runSdkStream).mockImplementation(() => {
      started += 1;
      if (started === 2) release2();
      return {
        done: gate2.then(() => {
          throw new RunnerLimitError('timeout', 'x timeout after 1ms');
        }),
        kill: () => {},
      };
    });
    await Promise.all([
      runRecurring(payload, { client: c1 }),
      runRecurring({ ...payload, actingAgentId: 202, runId: '3-1790000001' }, { client: c2 }),
    ]);
    expect(concurrentOf('3-1790000000')).toEqual([0]);
    expect(concurrentOf('3-1790000001')).toEqual([0]);
  });

  it('테스트 실행이 멈춘 쓰기가 있는데 시간 초과면 질문 글에 같은 사유(원인·걸린 시간·요약)가 들어간다', async () => {
    vi.mocked(runSdkStream).mockImplementationOnce((_i, onLine) => ({
      done: (async () => {
        const bridge = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls.at(-1)?.[0].hostBridge;
        bridge?.onProposal({ actionType: 'send_mail', summary: '', params: { subject: '보고' } });
        onLine(assistantTool('mcp__workplace__send_mail'));
        throw new RunnerLimitError('timeout', 'x timeout after 1ms');
      })(),
      kill: () => {},
    }));
    const c = client();
    await runRecurring({ ...payload, runId: '3-t1', round: undefined }, { client: c }, { test: true });
    const body = c.scoped.reportRecurringRun.mock.calls[0][2];
    expect(body).toMatchObject({ ok: true, question: true });
    expect(body.message).toContain('실행이 중간에 끝났습니다(실행 시간 한도를 넘겼습니다 — 걸린 시간');
    expect(body.message).toContain('도구 호출 1회(send_mail 1)');
    expect(body.message).toContain('마지막 단계: 도구 실행 중(send_mail)');
    // 테스트 실행은 회차 시각이 없어 줄 대기를 적지 않는다.
    expect(body.message).not.toContain('줄 대기');
  });
});

// WP-1408: 모델이 `[확인 필요]` 표지 없이 진행 여부를 물으면(「진행해도 될까요?」) 질문으로 보지 않아, 사람의 「진행」이 이어 처리(쓰기 도구 있음)가 아니라
// 이슈 챗 AI(쓰기 도구 없음)로 갔다. 마지막 문단이 물음표 + 진행 확인 어미면 질문으로 보고한다.
describe('looksLikeUnmarkedQuestion', () => {
  it('마지막 문단이 진행 확인 어미 + 물음표면 질문', () => {
    expect(looksLikeUnmarkedQuestion('## 확인\n- WP-12 를 사이클 3에 넣으려 합니다.\n\n진행해도 될까요?')).toBe(true);
    expect(looksLikeUnmarkedQuestion('사이클에 넣을까요?')).toBe(true);
    expect(looksLikeUnmarkedQuestion('초안을 만들었습니다.\n\n채널에 올릴까요?')).toBe(true);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n이대로 괜찮을까요？')).toBe(true);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n**계속 진행할까요?**')).toBe(true);
    expect(looksLikeUnmarkedQuestion('메일 초안을 만들었습니다.\n\n바로 보내기를 원하시나요?')).toBe(true);
  });

  it('본문 속 물음표만 있고 마지막 문단이 서술이면 질문이 아니다', () => {
    expect(looksLikeUnmarkedQuestion('## 정리\n- 「배포는 언제 할까요?」 라는 코멘트가 있었습니다\n\n이상 3건입니다.')).toBe(false);
  });

  // 리뷰: 「제안」 절은 질문이 아니다(시스템 프롬프트) — 그 절 안의 물음은 표지 없는 질문으로 보지 않는다.
  it('마지막 문단이 「제안」 절 안이면 질문이 아니다', () => {
    expect(looksLikeUnmarkedQuestion('## 오늘 정리\n- 3건\n\n## 제안\n\n거래처 메일을 폴더로 모을까요?')).toBe(false);
    expect(looksLikeUnmarkedQuestion('## 오늘 정리\n- 3건\n\n**제안**\n- 거래처 메일을 폴더로 모을까요?')).toBe(false);
  });

  // 리뷰: 「제안」이 든 굵은 물음 줄은 절 제목이 아니다 — 물음표로 끝나는 굵은 줄은 제목으로 보지 않는다.
  it('「제안」이 든 굵은 물음 줄은 제목이 아니라 질문이다', () => {
    expect(looksLikeUnmarkedQuestion('## 오늘 정리\n- 3건\n\n**이 제안대로 WP-12 를 사이클에 넣을까요?**')).toBe(true);
  });

  it('수사적 물음·권유(어떨까요·왜 …까요·…일까요·…했을까요)는 질문이 아니다', () => {
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n다음 주에는 미리 정리해 두는 게 어떨까요?')).toBe(false);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n왜 이번 주에만 늘었을까요?')).toBe(false);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n원인은 배포 지연일까요?')).toBe(false);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n담당자가 미리 알았을까요?')).toBe(false);
  });

  it('끝의 닫는 괄호·따옴표·마침표·이모지·공백을 걷어 내고 물음표를 본다', () => {
    expect(looksLikeUnmarkedQuestion('사이클 「11월 1주」에 넣을까요?」')).toBe(true);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n(진행해도 될까요?)')).toBe(true);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n진행할까요? 🙂 ')).toBe(true);
    expect(looksLikeUnmarkedQuestion('정리했습니다.\n\n"진행해도 될까요?".')).toBe(true);
  });

  it('물음표가 없거나 진행 확인 어미가 없으면 질문이 아니다', () => {
    expect(looksLikeUnmarkedQuestion('사이클에 넣었습니다. 다음 회차에 다시 확인할까요 하는 내용은 없습니다.')).toBe(false);
    expect(looksLikeUnmarkedQuestion('## 오늘 정리\n- 3건\n\n왜 늦어졌는지는 본문에 없습니까?')).toBe(false);
    expect(looksLikeUnmarkedQuestion('')).toBe(false);
  });
});

describe('runRecurring — 표지 없는 질문·결과 글 정리 (WP-1408)', () => {
  beforeEach(() => {
    vi.mocked(runSdkCollect).mockReset();
    // 앞 describe(WP-1407)가 runSdkStream 을 mockImplementation 으로 바꾼 채 남긴다 — 처음 구현(collect 라인을 흘림)으로 되돌린다.
    vi.mocked(runSdkStream).mockReset();
    vi.mocked(log.info).mockClear();
    vi.mocked(log.warn).mockClear();
    vi.mocked(buildInProcessWorkplaceMcpServer).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const testRun = { ...payload, runId: '3-t1790000000123', round: undefined };

  it('「지금 실행」 결과가 표지 없이 진행 여부를 물으면 경고를 남기고 question:true 로 보고한다', async () => {
    const body = '## 할 일\n- WP-12 를 사이클 「11월 1주」에 넣으려 합니다.\n\n진행해도 될까요?';
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', body)]);
    const c = client();
    await runRecurring(testRun, { client: c }, { test: true });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: testRun.runId, ok: true, message: body, question: true });
    expect(console.warn).toHaveBeenCalled();
    // 실행 기록(WP-1407)의 결말도 질문 — 성공(ok)으로 남지 않는다.
    expect(log.info).toHaveBeenCalledWith('run-recurring', 'recurring_run_trace', expect.objectContaining({ outcome: 'question' }));
  });

  it('정기 회차·이어 처리도 같은 규칙', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '초안을 만들었습니다.\n\n채널에 올릴까요?')]);
    const c = client();
    await runRecurring({ ...payload, runId: '3-f9', followUp: { question: 'q', answer: 'a' } }, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-f9',
      ok: true,
      message: '초안을 만들었습니다.\n\n채널에 올릴까요?',
      question: true,
    });
  });

  it('이미 `[확인 필요]` 로 시작하면 표지를 한 번만 떼고 그대로 질문으로(중복 표지 없음)', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '[확인 필요]\n사이클에 넣을까요?')]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
      runId: '3-1790000000',
      ok: true,
      message: '사이클에 넣을까요?',
      question: true,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('본문 속 물음표만 있는 정상 결과는 질문이 아니다', async () => {
    const body = '## 정리\n- 「배포는 언제 할까요?」 코멘트에 답했습니다\n\n이상입니다.';
    vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', body)]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: body });
  });

  it('결과 글은 마지막 도구 뒤의 답만 — 중간 말이 섞이지 않는다', async () => {
    const assistant = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
    vi.mocked(runSdkCollect).mockResolvedValue([
      assistant([
        { type: 'text', text: '먼저 필요한 정보를 조회합니다.' },
        { type: 'tool_use', name: 'get_issue_detail', input: {} },
      ]),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      assistant([{ type: 'text', text: '## 오늘 정리\n- 3건' }]),
      // 러너가 전체를 이어 붙여 result 에 실어도(opencode) 마지막 답만 쓴다.
      resultLine('success', '먼저 필요한 정보를 조회합니다.\n\n## 오늘 정리\n- 3건'),
    ]);
    const c = client();
    await runRecurring(payload, { client: c });
    expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: '## 오늘 정리\n- 3건' });
    // 리뷰: 모델 출력(사용자 데이터)은 로그에 남기지 않는다 — 길이만.
    const logged = JSON.stringify([
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(log.info).mock.calls,
      ...vi.mocked(log.warn).mock.calls,
    ]);
    expect(logged).not.toContain('먼저 필요한 정보를 조회합니다');
    expect(logged).not.toContain('오늘 정리');
  });

  // 리뷰: 테스트 질문의 이어 처리가 다시 물으면(표지가 있든 없든) 앞 질문이 허락받은 쓰기를 넘겨 다음 「진행」에도 허락이 남게 한다.
  // 이번 실행에서 그 도구를 부른 만큼은 쓴 것으로 보고 빼 — 같은 되돌릴 수 없는 쓰기가 두 번 실행되지 않게.
  describe('테스트 이어 처리의 다시 묻기 — 허락받은 쓰기를 넘긴다', () => {
    const permitted = [
      { tool: 'send_mail', args: { subject: '주간 보고' } },
      { tool: 'create_event', args: { title: '회의' } },
    ];
    const followUpRun = {
      ...testRun,
      runId: '3-f78',
      followUp: { question: '메일을 보내고 일정을 만들까요?', answer: '음', permittedActions: permitted },
    };

    it('표지를 붙여 다시 물으면 허락받은 쓰기 목록을 함께 보고한다', async () => {
      vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '[확인 필요]\n어느 쪽을 진행할까요?')]);
      const c = client();
      await runRecurring(followUpRun, { client: c }, { test: true });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
        runId: '3-f78',
        ok: true,
        message: '어느 쪽을 진행할까요?',
        question: true,
        pausedActions: permitted,
      });
    });

    it('표지 없이 다시 물어도 같다', async () => {
      vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '답을 이해하지 못했습니다.\n\n진행해도 될까요?')]);
      const c = client();
      await runRecurring(followUpRun, { client: c }, { test: true });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(
        201,
        3,
        expect.objectContaining({ question: true, pausedActions: permitted }),
      );
    });

    it('이번에 부른 허락 도구는 빼고, 새로 멈춘 쓰기와 함께 보고한다', async () => {
      vi.mocked(runSdkCollect).mockImplementation(async () => {
        const bridge = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls.at(-1)?.[0].hostBridge;
        bridge?.onProposal({ actionType: 'add_channel_member', summary: '', params: { channelId: 1 } });
        return [
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'mcp__workplace__send_mail', input: {} }] },
          }),
          JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
          resultLine('success', '[확인 필요]\n메일은 보냈습니다. 채널 초대도 할까요?'),
        ];
      });
      const c = client();
      await runRecurring(followUpRun, { client: c }, { test: true });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
        runId: '3-f78',
        ok: true,
        message: '메일은 보냈습니다. 채널 초대도 할까요?',
        question: true,
        pausedActions: [{ tool: 'add_channel_member', args: { channelId: 1 } }, { tool: 'create_event', args: { title: '회의' } }],
      });
    });

    it('질문이 아니면(처리 끝) 넘기지 않는다', async () => {
      vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', '하지 않았습니다.')]);
      const c = client();
      await runRecurring(followUpRun, { client: c }, { test: true });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f78', ok: true, message: '하지 않았습니다.' });
    });

    // 리뷰: 다음 이어 처리는 허락이 없을 때만 「정해 주세요」 질문으로 본다(isDecisionQuestion) — 허락을 넘기면 「고른 항목만 처리」(WP-1376)를 잃는다.
    it('「정해 주세요」 질문에는 허락을 넘기지 않는다', async () => {
      const body = '처리하지 않았습니다.\n\n## 정해 주세요\n1. 메일과 일정 중 무엇을 할까요?';
      vi.mocked(runSdkCollect).mockResolvedValue([resultLine('success', body)]);
      const c = client();
      await runRecurring(followUpRun, { client: c }, { test: true });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-f78', ok: true, message: body, question: true });
    });
  });

  // 리뷰: 질문(표지·「정해 주세요」 절)을 쓴 뒤 도구를 또 부르고 짧은 맺음으로 끝나면, 마지막 조각만 보면 질문을 잃는다.
  describe('질문 조각 → 도구 → 짧은 맺음', () => {
    const assistant = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
    const toolResult = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } });
    const lines = (question: string) => [
      assistant([{ type: 'text', text: question }, { type: 'tool_use', name: 'mcp__workplace__add_comment', input: {} }]),
      toolResult,
      assistant([{ type: 'text', text: '이상입니다.' }]),
      resultLine('success', '이상입니다.'),
    ];

    it('표지 조각이 있으면 그 조각을 질문으로 보고한다', async () => {
      vi.mocked(runSdkCollect).mockResolvedValue(lines('[확인 필요]\nWP-12 를 사이클에 넣을까요?'));
      const c = client();
      await runRecurring(payload, { client: c });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, {
        runId: '3-1790000000',
        ok: true,
        message: 'WP-12 를 사이클에 넣을까요?',
        question: true,
      });
    });

    it('「정해 주세요」 절 조각이 있으면 그 조각을 질문으로 보고한다', async () => {
      const q = '## 오늘 정리\n- 3건\n\n## 정해 주세요\n1. 회신할까요, 보류할까요?';
      vi.mocked(runSdkCollect).mockResolvedValue(lines(q));
      const c = client();
      await runRecurring(payload, { client: c });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: q, question: true });
    });

    it('표지 없는 물음은 마지막 조각만 본다 — 앞 조각의 물음 뒤에 일을 해 끝냈으면 질문이 아니다', async () => {
      vi.mocked(runSdkCollect).mockResolvedValue(lines('사이클에 넣을까요?'));
      const c = client();
      await runRecurring(payload, { client: c });
      expect(c.scoped.reportRecurringRun).toHaveBeenCalledWith(201, 3, { runId: '3-1790000000', ok: true, message: '이상입니다.' });
    });
  });
});
