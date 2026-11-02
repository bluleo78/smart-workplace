// 작업 화면 보기(WP-1277) — 제어 프레임 읽기·상태 전이·창 이름·열 수 있는 상태.
import { describe, expect, it } from 'vitest';

import {
  activeScreenWindow,
  canViewScreen,
  INITIAL_SCREEN_STATE,
  parseScreenFrame,
  reduceScreen,
  screenSocketClosed,
  screenWindowLabel,
} from './agentScreen';

const win = (index: number, name: string, active = false) => ({ index, name, width: 240, height: 60, active });

describe('parseScreenFrame', () => {
  it('reads known frames and drops malformed ones', () => {
    expect(parseScreenFrame('{"type":"status","state":"attached"}')).toEqual({ type: 'status', state: 'attached' });
    expect(parseScreenFrame('{"type":"status","state":"ended","reason":"끊김"}')).toEqual({ type: 'status', state: 'ended', reason: '끊김' });
    expect(parseScreenFrame('{"type":"input","enabled":true,"allowed":true}')).toEqual({ type: 'input', enabled: true, allowed: true });
    // allowed 가 없으면(옛 runner) 허용 안 함
    expect(parseScreenFrame('{"type":"input","enabled":false}')).toEqual({ type: 'input', enabled: false, allowed: false });
    expect(parseScreenFrame('{"type":"error","message":"다른 관리자가 이미 입력 중이에요"}')).toEqual({
      type: 'error',
      message: '다른 관리자가 이미 입력 중이에요',
    });
    // 창 목록은 모양이 맞는 것만
    expect(parseScreenFrame(JSON.stringify({ type: 'windows', items: [win(0, 'WP', true), { index: 'x' }] }))).toEqual({
      type: 'windows',
      items: [win(0, 'WP', true)],
    });
    expect(parseScreenFrame('not json')).toBeNull();
    expect(parseScreenFrame('{"type":"status","state":"weird"}')).toBeNull();
    expect(parseScreenFrame('{"type":"unknown"}')).toBeNull();
  });
});

describe('reduceScreen', () => {
  it('connecting → attached → input on → ended clears input; frames after end are ignored', () => {
    let s = reduceScreen(INITIAL_SCREEN_STATE, { type: 'status', state: 'attached' });
    expect(s.phase).toBe('attached');
    s = reduceScreen(s, { type: 'error', message: '다른 관리자가 이미 입력 중이에요' });
    expect(s.notice).toBe('다른 관리자가 이미 입력 중이에요');
    s = reduceScreen(s, { type: 'input', enabled: true, allowed: true });
    expect(s).toMatchObject({ input: true, inputAllowed: true, notice: null });
    s = reduceScreen(s, { type: 'status', state: 'ended', reason: 'AI 작업 공간이 떠 있지 않아요' });
    expect(s).toMatchObject({ phase: 'ended', input: false, reason: 'AI 작업 공간이 떠 있지 않아요' });
    expect(reduceScreen(s, { type: 'status', state: 'attached' })).toBe(s);
  });

  it('socket closed without a status frame ends with a generic reason, keeps an earlier reason', () => {
    expect(screenSocketClosed(INITIAL_SCREEN_STATE)).toMatchObject({ phase: 'ended', reason: '작업 화면 연결이 끊겼어요' });
    const ended = reduceScreen(INITIAL_SCREEN_STATE, { type: 'status', state: 'ended', reason: 'x' });
    expect(screenSocketClosed(ended)).toBe(ended);
  });
});

describe('helpers', () => {
  it('labels the notification window and picks the active window', () => {
    expect(screenWindowLabel('events')).toBe('알림');
    expect(screenWindowLabel('WP')).toBe('WP');
    expect(activeScreenWindow([win(0, 'WP'), win(1, 'events', true)])?.index).toBe(1);
    expect(activeScreenWindow([win(0, 'WP')])?.index).toBe(0);
    expect(activeScreenWindow([])).toBeNull();
  });

  it('opens only while the workspace is up', () => {
    expect(canViewScreen('RUNNING')).toBe(true);
    expect(canViewScreen('APPLY_PENDING')).toBe(true);
    for (const s of ['OFF', 'STARTING', 'STOPPING', 'FAILED']) expect(canViewScreen(s)).toBe(false);
  });
});
