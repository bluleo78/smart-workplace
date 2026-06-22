import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// node:fs 를 모킹해 실제 디스크 write 없이 append 호출/내용을 검증한다.
const fsMock = vi.hoisted(() => ({ appendFileSync: vi.fn(), mkdirSync: vi.fn() }));
vi.mock('node:fs', () => fsMock);

import {
  transcriptEnabled,
  transcriptRequest,
  transcriptStreamLine,
  transcriptResult,
} from './ai-transcript-log.js';

// 마지막 append 호출의 (파일경로, 기록된 JSON 객체) 를 반환하는 헬퍼.
function lastAppend(): { file: string; rec: Record<string, unknown> } {
  const calls = fsMock.appendFileSync.mock.calls;
  const [file, data] = calls[calls.length - 1] as [string, string];
  return { file, rec: JSON.parse((data as string).trim()) };
}

describe('transcriptEnabled', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('WORKPLACE_AI_TRANSCRIPT=on 이면 활성', () => {
    process.env.WORKPLACE_AI_TRANSCRIPT = 'on';
    expect(transcriptEnabled()).toBe(true);
  });
  it('WORKPLACE_AI_TRANSCRIPT=off 이면 비활성(NODE_ENV 무관)', () => {
    process.env.WORKPLACE_AI_TRANSCRIPT = 'off';
    process.env.NODE_ENV = 'development';
    expect(transcriptEnabled()).toBe(false);
  });
  it('미설정 + 비-prod → 기본 활성', () => {
    delete process.env.WORKPLACE_AI_TRANSCRIPT;
    process.env.NODE_ENV = 'development';
    expect(transcriptEnabled()).toBe(true);
  });
  it('미설정 + prod → 기본 비활성(데이터·PII 보호)', () => {
    delete process.env.WORKPLACE_AI_TRANSCRIPT;
    process.env.NODE_ENV = 'production';
    expect(transcriptEnabled()).toBe(false);
  });
});

describe('트랜스크립트 기록', () => {
  beforeEach(() => {
    fsMock.appendFileSync.mockClear();
    fsMock.mkdirSync.mockClear();
    process.env.WORKPLACE_AI_TRANSCRIPT = 'on';
  });

  it('requestId 가 없으면 no-op(파일 write 안 함)', () => {
    transcriptRequest(undefined, { query: 'x' });
    transcriptStreamLine(undefined, '{"a":1}');
    transcriptResult(undefined, { answerText: 'y' });
    expect(fsMock.appendFileSync).not.toHaveBeenCalled();
  });

  it('비활성(off)이면 no-op', () => {
    process.env.WORKPLACE_AI_TRANSCRIPT = 'off';
    transcriptRequest('req-1', { query: 'x' });
    expect(fsMock.appendFileSync).not.toHaveBeenCalled();
  });

  it('request 레코드를 <requestId>.jsonl 에 kind:request 로 기록', () => {
    transcriptRequest('req-1', { query: '오늘 일정', model: 'claude-sonnet-4-6' });
    const { file, rec } = lastAppend();
    expect(file).toContain('req-1.jsonl');
    expect(rec.kind).toBe('request');
    expect(rec.query).toBe('오늘 일정');
    expect(rec.ts).toBeTruthy(); // 수신 시각 주입
  });

  it('stream 라인은 JSON 파싱해 객체로 기록(라인별 ts 포함)', () => {
    transcriptStreamLine('req-1', '{"type":"assistant","seq":2}');
    const { rec } = lastAppend();
    expect(rec.kind).toBe('stream');
    expect((rec.line as Record<string, unknown>).type).toBe('assistant');
    expect(rec.ts).toBeTruthy();
  });

  it('비-JSON stream 라인은 원문 문자열로 기록', () => {
    transcriptStreamLine('req-1', 'not json');
    const { rec } = lastAppend();
    expect(rec.line).toBe('not json');
  });

  it('result 레코드를 kind:result 로 기록', () => {
    transcriptResult('req-1', { answerText: '처리했어요', widgetCount: 1, source: 'router' });
    const { rec } = lastAppend();
    expect(rec.kind).toBe('result');
    expect(rec.answerText).toBe('처리했어요');
    expect(rec.source).toBe('router');
  });
});
