import { describe, it, expect, vi, beforeEach } from 'vitest';

const appendFileSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs', () => ({
  appendFileSync: appendFileSyncMock,
  mkdirSync: mkdirSyncMock,
}));

import { log, logFilePathFor, formatEntry } from './logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DISABLE_FILE_LOG;
});

describe('logFilePathFor', () => {
  it('날짜를 YYYY-MM-DD 로 파일명에 박는다', () => {
    // 로컬 시각 기준 날짜 그룹핑(KST 배포에서 '오늘'의 로그가 한 파일에) — 테스트도
    // 로컬 시각으로 Date 를 구성해 실행 환경 타임존과 무관하게 결정적으로 통과시킨다.
    // (month 인자는 0-기준 → 5 = 6월)
    const p = logFilePathFor(new Date(2026, 5, 22, 13, 45, 0));
    expect(p).toMatch(/logs[/\\]ai-agent-2026-06-22\.log$/);
  });
});

describe('formatEntry', () => {
  it('level/tag/event/추가필드를 JSON 한 줄로 직렬화한다', () => {
    const line = formatEntry('INFO', 'ai-compose', 'start', { requestId: 'r1', agentId: 2 });
    const obj = JSON.parse(line);
    expect(obj.level).toBe('INFO');
    expect(obj.tag).toBe('ai-compose');
    expect(obj.event).toBe('start');
    expect(obj.requestId).toBe('r1');
    expect(obj.agentId).toBe(2);
    expect(typeof obj.ts).toBe('string');
  });

  it('fields 없이도 동작한다', () => {
    const obj = JSON.parse(formatEntry('ERROR', 't', 'e'));
    expect(obj.tag).toBe('t');
    expect(obj.event).toBe('e');
  });
});

describe('log.info / warn / error', () => {
  it('파일에 append 하고 console 에도 출력한다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('ai-compose', 'start', { requestId: 'r1' });
    expect(appendFileSyncMock).toHaveBeenCalledTimes(1);
    const [, written] = appendFileSyncMock.mock.calls[0];
    expect(JSON.parse(String(written).trim()).event).toBe('start');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error 는 console.error 로 출력한다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('cli-runner', 'cli_exit', { exitCode: 1 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warn 은 console.warn 으로 출력한다', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('ai-compose', 'fallback', { reason: 'no_sidecar' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('DISABLE_FILE_LOG=true 면 파일 write 를 생략하고 console 만 출력한다', () => {
    process.env.DISABLE_FILE_LOG = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('t', 'e');
    expect(appendFileSyncMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('파일 write 가 던져도 예외를 삼키고 console 로 fallback 한다', () => {
    appendFileSyncMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => log.info('t', 'e')).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('직렬화 불가 필드(순환참조)도 예외를 던지지 않고 안전 라인으로 폴백한다', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular; // 순환참조 → JSON.stringify 가 던진다
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => log.info('ai-compose', 'start', circular)).not.toThrow();
    // 폴백 라인은 유효 JSON 이고 _logError 마커를 포함한다.
    const [written] = spy.mock.calls[0];
    const obj = JSON.parse(String(written));
    expect(obj._logError).toBe('serialize_failed');
    expect(obj.event).toBe('start');
    spy.mockRestore();
  });
});
