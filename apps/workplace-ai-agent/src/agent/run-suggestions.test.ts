import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunnerInput } from './agent-runner.js';

// 러너는 목으로 — collect 입력(모델·effort·도구 차단)과 결과 파싱만 검증한다.
const { collectSpy } = vi.hoisted(() => ({ collectSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({ runnerFor: vi.fn(() => ({ collect: collectSpy, stream: vi.fn() })) }));
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildFollowupMessage,
  buildStarterMessage,
  parseSuggestionItems,
  resolveSuggestionModel,
  runSuggestions,
  seoulNowLabel,
  suggestionsInput,
} from './run-suggestions.js';

const anthropic = { provider: 'anthropic' as const, token: 'tok', model: 'claude-sonnet-5-5' };
const opencode = { provider: 'opencode' as const, payload: { providerId: 'p', options: {} }, model: 'p/gpt-4.1' };
const getProviderCredential = vi.fn();
const deps = { client: { getProviderCredential } as never };
const ok = (text: string) => [{ type: 'result', ok: true, text, usage: { inputTokens: 10, outputTokens: 5 } }];
// 2026-10-13 00:30Z = 서울 09:30(화요일 아침)
const NOW = new Date('2026-10-13T00:30:00Z');

const starter = { mode: 'starter' as const, agentId: 7, count: 4, timeoutMs: 15_000 };

beforeEach(() => {
  vi.clearAllMocks();
  getProviderCredential.mockResolvedValue(anthropic);
});

describe('suggestionsInput', () => {
  it('API 가 보내는 명시적 null 필드를 받는다', () => {
    const r = suggestionsInput.safeParse({
      ...starter, model: null, screenContext: null, recentTitles: null, question: null, answer: null,
    });
    expect(r.success).toBe(true);
  });
  it('count 는 2~4, 제목은 5개까지', () => {
    expect(suggestionsInput.safeParse({ ...starter, count: 5 }).success).toBe(false);
    expect(suggestionsInput.safeParse({ ...starter, count: 1 }).success).toBe(false);
    expect(suggestionsInput.safeParse({ ...starter, recentTitles: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
  });
  it('followup 은 답이 있어야 한다', () => {
    expect(suggestionsInput.safeParse({ ...starter, mode: 'followup', count: 3 }).success).toBe(false);
    expect(suggestionsInput.safeParse({ ...starter, mode: 'followup', count: 3, answer: '일정 2건' }).success).toBe(true);
  });
});

describe('resolveSuggestionModel — 자동 모델은 API 가 정해 싣는다(스펙 §10.3)', () => {
  it('API 가 실은 model 이 있으면 그대로(Anthropic 자동이면 API 가 Haiku 를 싣는다)', () => {
    expect(resolveSuggestionModel('claude-haiku-5-5', anthropic)).toBe('claude-haiku-5-5');
    expect(resolveSuggestionModel('p/small', opencode)).toBe('p/small');
  });
  it('model 이 없으면 비서 연결 모델(opencode 자동)', () => {
    expect(resolveSuggestionModel(null, opencode)).toBe('p/gpt-4.1');
    expect(resolveSuggestionModel(undefined, anthropic)).toBe('claude-sonnet-5-5');
  });
  it('추천 전용 기본값·env 를 두지 않는다 — 둘 다 없으면 일반 기본 모델(타입 안전망)', () => {
    process.env.WORKPLACE_AI_SUGGESTION_MODEL = 'claude-haiku-9';
    try {
      expect(resolveSuggestionModel(null, { ...anthropic, model: null })).toBe('claude-sonnet-5-5');
    } finally {
      delete process.env.WORKPLACE_AI_SUGGESTION_MODEL;
    }
  });
});

describe('parseSuggestionItems', () => {
  it('코드펜스·머리말 속 첫 JSON 배열을 꺼낸다', () => {
    const text = '추천이에요:\n```json\n["오늘 일정 요약해줘", "내 이슈 알려줘"]\n```\n끝';
    expect(parseSuggestionItems(text, 4)).toEqual(['오늘 일정 요약해줘', '내 이슈 알려줘']);
  });
  it('문구 안의 대괄호가 있어도 배열 전체를 읽는다', () => {
    expect(parseSuggestionItems('["[긴급] 메일 알려줘", "b 해줘"]', 3)).toEqual(['[긴급] 메일 알려줘', 'b 해줘']);
  });
  it('공백 정리·강조 기호 제거·40자 초과·빈 값·중복·문자열 아닌 값은 버리고 count 까지', () => {
    const long = '가'.repeat(41);
    const text = JSON.stringify(['  **오늘   일정** 요약해줘 ', long, '', 3, '오늘 일정 요약해줘', 'a', 'b', 'c']);
    expect(parseSuggestionItems(text, 3)).toEqual(['오늘 일정 요약해줘', 'a', 'b']);
  });
  it('정확히 40자는 남긴다(코드포인트 기준)', () => {
    const forty = '나'.repeat(40);
    expect(parseSuggestionItems(JSON.stringify([forty]), 3)).toEqual([forty]);
  });
  it('머리말의 대괄호·이스케이프된 따옴표/대괄호가 있어도 첫 유효 배열을 읽는다', () => {
    expect(parseSuggestionItems('[참고] 아래예요 ["a \\"]\\" 해줘", "b 해줘"]', 3)).toEqual(['a "]" 해줘', 'b 해줘']);
  });
  it('배열이 없거나 깨지면 빈 목록', () => {
    expect(parseSuggestionItems('죄송해요, 만들 수 없어요', 3)).toEqual([]);
    expect(parseSuggestionItems('["깨진', 3)).toEqual([]);
  });
});

describe('메시지 구성', () => {
  it('서울 기준 날짜·요일·시간대', () => {
    expect(seoulNowLabel(NOW)).toBe('2026-10-13 (화) 오전 9시 — 아침');
  });
  it('starter: 화면이 있으면 화면 블록, 없으면 최근 대화 제목', () => {
    const withScreen = buildStarterMessage(
      { ...starter, count: 3, screenContext: { view: '이슈 상세', focus: { type: '이슈', label: 'WP-342 로그인 버그', refs: { issueKey: 'WP-342' } } } },
      NOW,
    );
    expect(withScreen).toContain('## 현재 화면');
    expect(withScreen).toContain('WP-342');
    expect(withScreen).toContain('질문 3개');
    const general = buildStarterMessage({ ...starter, recentTitles: ['3분기 매출 정리', '회의록 요약'] }, NOW);
    expect(general).toContain('## 최근 대화 제목\n- 3분기 매출 정리\n- 회의록 요약');
    expect(general).toContain('2026-10-13 (화) 오전 9시');
  });
  it('followup: 질문·답(앞 4000자)을 싣는다', () => {
    const msg = buildFollowupMessage({ ...starter, mode: 'followup', count: 3, question: '오늘 일정', answer: 'x'.repeat(5000) });
    expect(msg).toContain('## 사용자 질문\n오늘 일정');
    expect(msg.match(/x/g)?.length).toBe(4000);
  });
});

describe('runSuggestions', () => {
  it('도구 없이 maxTurns 1·effort low·API 가 실은 모델로 collect 하고 항목을 돌려준다', async () => {
    collectSpy.mockResolvedValue(ok('["오늘 일정 요약해줘","답장이 필요한 메일 알려줘"]'));
    const out = await runSuggestions(
      suggestionsInput.parse({ ...starter, model: 'claude-haiku-5-5', recentTitles: ['a'] }),
      deps,
      NOW,
    );
    expect(out).toEqual({ items: ['오늘 일정 요약해줘', '답장이 필요한 메일 알려줘'] });
    expect(getProviderCredential).toHaveBeenCalledWith(7);
    const arg = collectSpy.mock.calls[0][0] as RunnerInput;
    expect(arg).toMatchObject({
      model: 'claude-haiku-5-5', maxTurns: 1, effort: 'low', timeoutMs: 15_000,
      allowSubagents: false, allowFileRead: false, includePartialMessages: false,
    });
    expect(arg.mcp).toBeUndefined();
    expect(arg.systemPrompt).toContain('## 오늘 날짜');
  });
  it('실행이 실패(ok:false)면 예외 — 라우트가 502 로 바꾼다', async () => {
    collectSpy.mockResolvedValue([{ type: 'result', ok: false, text: '["부분"]', usage: null }]);
    await expect(runSuggestions(suggestionsInput.parse(starter), deps, NOW)).rejects.toThrow();
  });
  it('러너 예외(시간 초과 등)는 그대로 전파', async () => {
    collectSpy.mockRejectedValue(new Error('timeout'));
    await expect(runSuggestions(suggestionsInput.parse(starter), deps, NOW)).rejects.toThrow('timeout');
  });
});
