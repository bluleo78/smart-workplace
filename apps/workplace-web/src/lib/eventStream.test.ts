import { describe, expect, it, vi } from 'vitest';

import { createSseParser } from './eventStream';

describe('createSseParser', () => {
  it('event + data 한 쌍을 파싱해 JSON 으로 onEvent 호출', () => {
    const onEvent = vi.fn();
    const p = createSseParser(onEvent);
    p.feed('event: chat.message.created\ndata: {"threadId":7,"id":3}\n\n');
    expect(onEvent).toHaveBeenCalledWith('chat.message.created', { threadId: 7, id: 3 });
  });

  it('콜론(:) 코멘트(heartbeat)는 무시', () => {
    const onEvent = vi.fn();
    const p = createSseParser(onEvent);
    p.feed(': ping\n\n');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('여러 data 라인은 개행으로 합쳐 파싱', () => {
    const onEvent = vi.fn();
    const p = createSseParser(onEvent);
    p.feed('event: notify.created\ndata: {"type":\ndata: "X"}\n\n');
    expect(onEvent).toHaveBeenCalledWith('notify.created', { type: 'X' });
  });

  it('청크 경계가 라인 중간을 갈라도 누적 후 파싱', () => {
    const onEvent = vi.fn();
    const p = createSseParser(onEvent);
    p.feed('event: chat.message.created\nda');
    p.feed('ta: {"threadId":1,"id":2}\n\n');
    expect(onEvent).toHaveBeenCalledWith('chat.message.created', { threadId: 1, id: 2 });
  });

  it('data 없이 event 만 있어도 dispatch(파싱 실패 시 data=undefined)', () => {
    const onEvent = vi.fn();
    const p = createSseParser(onEvent);
    p.feed('event: notify.created\ndata: not-json\n\n');
    expect(onEvent).toHaveBeenCalledWith('notify.created', undefined);
  });

  it('onEvent 가 throw 해도 feed 는 전파하지 않고 다음 이벤트를 계속 처리', () => {
    const seen: string[] = [];
    const onEvent = vi.fn((name: string) => {
      if (name === 'chat.bad') throw new Error('handler boom');
      seen.push(name);
    });
    const p = createSseParser(onEvent);
    expect(() => {
      p.feed('event: chat.bad\ndata: {}\n\n');
      p.feed('event: notify.created\ndata: {"type":"X"}\n\n');
    }).not.toThrow();
    expect(seen).toEqual(['notify.created']);
  });
});
