import { describe, expect, it, vi } from 'vitest';

import {
  atLimit,
  createChatStreams,
  currentSessionId,
  DRAFT_PREFIX,
  otherActivity,
  sendBlocked,
  sessionStatus,
  triggerActivityOf,
} from './chatStreams';

/** 메모리 Storage — 실패 주입 가능. */
function memStorage(fail = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => { if (fail) throw new Error('blocked'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (fail) throw new Error('blocked'); m.set(k, v); },
    raw: m,
  };
}

function setup(storage = memStorage()) {
  const s = createChatStreams({ storage: () => storage });
  const effects = { sessionsChanged: vi.fn(), refetch: vi.fn() };
  s.setEffects(effects);
  s.setOwner('1:1');
  return { s, effects, storage };
}
const ev = (s: ReturnType<typeof createChatStreams>, kind: string, data: Record<string, unknown>) =>
  s.applyEvent(`home.chat.${kind}`, data);
const turnsOf = (s: ReturnType<typeof createChatStreams>, key: string) => s.getSnapshot().entries.get(key)?.turns;

/** 새 대화로 질문을 보내고 POST 응답까지 붙인다. */
function ask(s: ReturnType<typeof createChatStreams>, q: string, corr: string, sid: string) {
  s.newConversation();
  const { key, gen } = s.startTurn(q);
  s.attach(key, gen, corr, sid);
}

describe('이벤트 라우팅·키 교체', () => {
  it('새 대화는 draft 키로 시작하고 POST 응답의 sessionId 로 바뀐다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A 질문');
    expect(key.startsWith(DRAFT_PREFIX)).toBe(true);
    expect(currentSessionId(s.getSnapshot())).toBeNull();
    s.attach(key, gen, 'corr-a', 's-a');
    expect(s.getSnapshot().currentKey).toBe('s-a');
    expect(s.getSnapshot().active.get('s-a')).toBe('corr-a');
  });

  it('correlationId 로 각 대화 칸에 기록하고, 보지 않는 대화도 계속 쌓인다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ask(s, 'B', 'corr-b', 's-b'); // 현재 = B
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: 'A 답' });
    ev(s, 'delta', { correlationId: 'corr-b', sessionId: 's-b', text: 'B 답' });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: 'A 답' });
    expect(turnsOf(s, 's-b')?.[1]).toMatchObject({ content: 'B 답' });
  });

  it('POST 응답 전에 온 이벤트는 보류했다가 attach 때 재생한다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '먼저 온 ' });
    ev(s, 'pending_action', { correlationId: 'corr-a', sessionId: 's-a', actions: [{ id: 7, actionType: 'x', summary: '일정 생성', params: {} }] });
    s.attach(key, gen, 'corr-a', 's-a');
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '먼저 온 ' });
    expect(s.getSnapshot().entries.get('s-a')?.pendingActions).toHaveLength(1);
  });

  it('구 API(시작 응답에 sessionId 없음)는 done 의 sessionId 로 키를 확정한다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    s.attach(key, gen, 'corr-a', undefined);
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(s.getSnapshot().currentKey).toBe('s-a');
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(false);
  });

  it('끝난 correlationId 의 재전송은 무시한다(재연결 중복)', () => {
    const { s, effects } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '답' });
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '답' });
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '답' });
    expect(effects.sessionsChanged).toHaveBeenCalledTimes(1);
  });

  it('구 호환 error{cancelled:true} 는 무시하고 cancelled 로 마감한다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '부분' });
    ev(s, 'error', { correlationId: 'corr-a', sessionId: 's-a', cancelled: true });
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(true);
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    expect(s.getSnapshot().entries.get('s-a')).toMatchObject({ pending: false });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '부분', interrupted: 'stopped' });
    expect(s.getSnapshot().active.has('s-a')).toBe(false);
  });

  it('서버 시간 초과 취소는 사용자 정지와 구분해 시간 초과로 중단됨', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '부분' });
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'timeout' });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '부분', interrupted: 'timeout' });
    // 첫 토큰 전 시간 초과 — 빈 말풍선 대신 시간 초과 안내.
    ask(s, 'B', 'corr-b', 's-b');
    ev(s, 'cancelled', { correlationId: 'corr-b', sessionId: 's-b', reason: 'timeout' });
    expect(turnsOf(s, 's-b')?.[1]).toEqual({ role: 'assistant', content: '시간 초과로 중단됨' });
  });

  it('오류 종결은 오류로 중단됨', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '부분' });
    ev(s, 'error', { correlationId: 'corr-a', sessionId: 's-a', message: '실패' });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ interrupted: 'failed' });
  });
});

describe('대화별 세대 가드', () => {
  it('A 를 멈춰도 B 의 이벤트는 그대로 반영된다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ask(s, 'B', 'corr-b', 's-b');
    s.select('s-a');
    expect(s.stopLocal('s-a')).toBe('corr-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '늦은 A' });
    ev(s, 'delta', { correlationId: 'corr-b', sessionId: 's-b', text: 'B 계속' });
    expect(turnsOf(s, 's-a')?.[1]).toEqual({ role: 'assistant', content: '응답을 중단했어요.' });
    expect(turnsOf(s, 's-b')?.[1]).toMatchObject({ content: 'B 계속' });
  });

  it('■ 직후엔 서버 종결 전까지 같은 대화 전송을 막는다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    s.stopLocal('s-a');
    expect(sendBlocked(s.getSnapshot())).toBe(true);
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    expect(sendBlocked(s.getSnapshot())).toBe(false);
  });

  it('POST 응답 전 ■ 이면 attach 가 곧바로 취소를 요구한다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    expect(s.stopLocal(key)).toBeNull();
    expect(s.attach(key, gen, 'corr-a', 's-a').cancelNow).toBe(true);
  });

  it('409·429 거절은 낙관적 두 턴을 걷고 빈 draft 칸을 지운다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('넷째');
    s.failStart(key, gen, null);
    expect(s.getSnapshot().entries.has(key)).toBe(false);
    expect(s.getSnapshot().currentKey).toBeNull();
  });

  it('POST 응답 전 ■ 뒤 POST 가 거절되면(429) 칸을 정리하고 attach 대기에서 풀린다(I1)', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('넷째');
    s.stopLocal(key);
    s.failStart(key, gen, null);
    // 빈 draft 칸은 지워지고, 다른 대화의 종결이 더는 보류되지 않는다.
    expect(s.getSnapshot().entries.has(key)).toBe(false);
    expect(sendBlocked(s.getSnapshot())).toBe(false);
    s.setActive([{ sessionId: 's-x', correlationId: 'corr-x', startedAt: '2026-10-05T00:00:00Z' }], 3, s.beginResync());
    ev(s, 'done', { correlationId: 'corr-x', sessionId: 's-x', widgets: null });
    expect(s.getSnapshot().active.has('s-x')).toBe(false);
  });

  it('기존 대화에서 POST 응답 전 ■ 뒤 POST 가 거절되면 낙관적 두 턴을 걷고 이후 이력 조회가 중복되지 않는다(I1)', () => {
    const { s } = setup();
    s.select('s-a');
    s.load('s-a', [{ role: 'user', content: '이전' }, { role: 'assistant', content: '이전 답' }], []);
    const { key, gen } = s.startTurn('새 질문');
    s.stopLocal(key);
    s.failStart(key, gen, null);
    expect(turnsOf(s, 's-a')).toHaveLength(2);
    s.load('s-a', [{ role: 'user', content: '이전' }, { role: 'assistant', content: '이전 답' }], []);
    expect(turnsOf(s, 's-a')).toHaveLength(2);
    expect(s.getSnapshot().entries.get('s-a')?.cancelOnAttach).toBe(false);
  });

  it('POST 응답 전 ■ 뒤 POST 가 일반 오류면 중단됨 표시는 두고 취소 예약만 지운다(I1)', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    s.stopLocal(key);
    s.failStart(key, gen, '실패');
    const e = s.getSnapshot().entries.get(key);
    expect(e).toMatchObject({ cancelOnAttach: false, pending: false });
    expect(e?.turns[1]).toEqual({ role: 'assistant', content: '응답을 중단했어요.' });
    expect(sendBlocked(s.getSnapshot())).toBe(false);
  });

  it('POST 응답 전 ■ 뒤엔 응답이 올 때까지 전송을 막고, attach 가 곧바로 취소를 요구한다(I3)', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    s.stopLocal(key);
    expect(sendBlocked(s.getSnapshot())).toBe(true);
    const { key: k, cancelNow } = s.attach(key, gen, 'corr-a', 's-a');
    expect(cancelNow).toBe(true);
    expect(s.getSnapshot().entries.get(k)?.cancelOnAttach).toBe(false);
    // 서버 종결(cancelled) 전까지는 active 기준으로 계속 막힌다(R12).
    expect(sendBlocked(s.getSnapshot())).toBe(true);
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    expect(sendBlocked(s.getSnapshot())).toBe(false);
  });

  it('■ 뒤 새 질문이 끼어들어도 취소 예약은 이전 POST 의 attach 가 소비한다(I3)', () => {
    const { s } = setup();
    s.select('s-a');
    s.load('s-a', [], []);
    const first = s.startTurn('A');
    s.stopLocal('s-a');
    const second = s.startTurn('B'); // 가드를 우회한 호출에도 예약을 잃지 않는다
    expect(s.getSnapshot().entries.get('s-a')?.cancelOnAttach).toBe(true);
    expect(s.attach('s-a', second.gen, 'corr-b', 's-a').cancelNow).toBe(false);
    expect(s.attach('s-a', first.gen, 'corr-a', 's-a').cancelNow).toBe(true);
    expect(s.getSnapshot().entries.get('s-a')?.cancelOnAttach).toBe(false);
  });

  it('■ 뒤 다른 대화로 옮긴 사이 온 cancelled 는 멈춘 대화에 새 답변을 남기지 않는다(I2)', () => {
    const { s, effects } = setup();
    s.setPanelOpen(true);
    ask(s, 'A', 'corr-a', 's-a');
    s.stopLocal('s-a');
    ask(s, 'B', 'corr-b', 's-b'); // 현재 = B
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    const snap = s.getSnapshot();
    expect(snap.unseenDone.has('s-a')).toBe(false);
    expect(snap.active.has('s-a')).toBe(false);
    expect(sessionStatus(snap, 's-a')).toBeNull();
    expect(effects.sessionsChanged).toHaveBeenCalled();
    // 재전송은 무시된다(은퇴한 correlationId).
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    expect(s.getSnapshot().unseenDone.has('s-a')).toBe(false);
  });

  it('확인카드 처리 결과는 그 대화의 세대가 같을 때만 반영', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    const gen = s.getSnapshot().entries.get('s-a')!.gen;
    expect(s.appendTurn('s-a', gen, { role: 'action', outcome: 'done', content: '승인 완료' })).toBe(true);
    s.startTurn('다음');
    expect(s.appendTurn('s-a', gen, { role: 'action', outcome: 'done', content: '늦은 결과' })).toBe(false);
  });
});

describe('복원·자리표시·정리', () => {
  it('active 에 있는 대화를 읽으면 생성 중 자리표시를 붙이고, 중간 이벤트는 버린 채 종결 때 재조회한다', () => {
    const { s, effects } = setup();
    s.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '' }], 3, s.beginResync());
    s.select('s-a');
    s.load('s-a', [{ role: 'user', content: 'A' }], []);
    expect(s.getSnapshot().entries.get('s-a')).toMatchObject({ pending: true });
    expect(turnsOf(s, 's-a')).toEqual([{ role: 'user', content: 'A' }, { role: 'assistant', content: '' }]);
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '중간' });
    expect(turnsOf(s, 's-a')?.[1]).toEqual({ role: 'assistant', content: '' });
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(effects.refetch).toHaveBeenCalledWith('s-a');
  });

  it('라이브 생성 중인 칸은 서버 이력으로 덮지 않는다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '라이브' });
    s.load('s-a', [{ role: 'user', content: 'A' }], []);
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '라이브' });
  });

  it('복원 조회 중 보낸 질문은 늦게 온 서버 이력에 지워지지 않고, 이력 뒤에 이어 답변을 받는다', () => {
    const { s } = setup();
    s.select('s-a'); // 칸 없음 → 복원 조회 시작
    const { key, gen } = s.startTurn('새 질문'); // 조회 응답 전에 전송(POST 진행 중)
    s.load('s-a', [{ role: 'user', content: '옛 질문' }, { role: 'assistant', content: '옛 답' }], []);
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '옛 답', '새 질문', '']);
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(true);
    s.attach(key, gen, 'c1', 's-a');
    ev(s, 'delta', { correlationId: 'c1', sessionId: 's-a', text: '새 답' });
    ev(s, 'done', { correlationId: 'c1', sessionId: 's-a', widgets: null });
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '옛 답', '새 질문', '새 답']);
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(false);
  });

  it('복원 조회가 서버의 새 질문 저장 뒤에 처리돼도 그 질문을 두 번 붙이지 않는다', () => {
    const { s } = setup();
    s.select('s-a');
    s.startTurn('새 질문');
    s.load('s-a', [{ role: 'user', content: '옛 질문' }, { role: 'assistant', content: '옛 답' }, { role: 'user', content: '새 질문' }], []);
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '옛 답', '새 질문', '']);
  });

  it('복원 조회 중 보내고 POST 응답 전에 ■ 해도, 늦은 이력이 attach 즉시 취소를 지우지 않는다', () => {
    const { s } = setup();
    s.select('s-a');
    const { key, gen } = s.startTurn('새 질문');
    s.stopLocal(key);
    s.load('s-a', [{ role: 'user', content: '옛 질문' }], []);
    expect(turnsOf(s, 's-a')?.[0]?.content).toBe('옛 질문');
    expect(s.attach(key, gen, 'c1', 's-a').cancelNow).toBe(true);
  });

  it('복원 조회 중 보낸 질문의 POST 응답이 이력보다 먼저 와 생성 중이어도, 늦은 이력을 앞에 붙이고 답변은 이어 받는다', () => {
    const { s } = setup();
    s.select('s-a'); // 칸 없음 → 복원 조회 시작
    const { key, gen } = s.startTurn('새 질문');
    s.attach(key, gen, 'c1', 's-a'); // POST 응답이 먼저 — 라이브 라우팅 등록
    ev(s, 'delta', { correlationId: 'c1', sessionId: 's-a', text: '새 ' });
    expect(s.hasHistory('s-a')).toBe(false); // 이력 조회가 실패해도 다시 열면 재조회한다
    // 조회가 서버의 새 질문 저장 뒤에 처리됨 — 이력 끝의 같은 질문은 한 번만.
    s.load('s-a', [{ role: 'user', content: '옛 질문' }, { role: 'assistant', content: '옛 답' }, { role: 'user', content: '새 질문' }], []);
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '옛 답', '새 질문', '새 ']);
    expect(s.hasHistory('s-a')).toBe(true);
    ev(s, 'delta', { correlationId: 'c1', sessionId: 's-a', text: '답' });
    ev(s, 'done', { correlationId: 'c1', sessionId: 's-a', widgets: null });
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '옛 답', '새 질문', '새 답']);
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(false);
  });

  it('복원 조회 중 보낸 질문의 답변이 이력보다 먼저 끝나도, 늦은 이력은 지난 대화만 앞에 붙인다', () => {
    const { s } = setup();
    s.select('s-a');
    const { key, gen } = s.startTurn('새 질문');
    s.attach(key, gen, 'c1', 's-a');
    ev(s, 'delta', { correlationId: 'c1', sessionId: 's-a', text: '새 답' });
    ev(s, 'done', { correlationId: 'c1', sessionId: 's-a', widgets: null });
    s.load('s-a', [{ role: 'user', content: '옛 질문' }, { role: 'user', content: '새 질문' }, { role: 'assistant', content: '새 답' }], []);
    expect(turnsOf(s, 's-a')?.map((t) => t.content)).toEqual(['옛 질문', '새 질문', '새 답']);
  });

  it('새 대화(draft)는 불러올 이력이 없어 이력 반영된 칸으로 본다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    expect(s.hasHistory('s-a')).toBe(true);
  });

  it('생성 중도 현재도 아닌 칸은 최근 연 5개만 남긴다', () => {
    const { s } = setup();
    for (let i = 0; i < 7; i++) { s.select(`s${i}`); s.load(`s${i}`, [{ role: 'user', content: String(i) }], []); }
    s.newConversation();
    const keys = [...s.getSnapshot().entries.keys()];
    expect(keys).toHaveLength(5);
    expect(keys).not.toContain('s0');
    expect(keys).not.toContain('s1');
  });

  it('재동기화: 서버에 없는 생성은 끝난 것으로 처리하되, 요청 이후 시작한 생성은 유지한다', () => {
    const { s, effects } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    const token = s.beginResync();
    ask(s, 'B', 'corr-b', 's-b'); // 요청 뒤 시작
    s.setActive([], 3, token);
    expect(s.getSnapshot().active.has('s-a')).toBe(false);
    expect(s.getSnapshot().active.has('s-b')).toBe(true);
    expect(effects.refetch).toHaveBeenCalledWith('s-a');
  });

  it('새 대화 POST 응답 전에 재동기화가 그 생성을 먼저 알려도, 중간 이벤트를 보류했다가 attach 때 이어 붙인다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    s.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '' }], 3, s.beginResync());
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '앞부분 ' });
    s.attach(key, gen, 'corr-a', 's-a');
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '뒷부분' });
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '앞부분 뒷부분' });
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(false);
    expect(s.getSnapshot().active.has('s-a')).toBe(false);
  });

  it('새 대화 POST 응답 전에 재동기화 뒤 답변이 끝까지 와도, attach 때 전부 재생해 답변을 잃지 않는다', () => {
    const { s } = setup();
    const { key, gen } = s.startTurn('A');
    s.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '' }], 3, s.beginResync());
    ev(s, 'delta', { correlationId: 'corr-a', sessionId: 's-a', text: '전체 답' });
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    s.attach(key, gen, 'corr-a', 's-a');
    expect(turnsOf(s, 's-a')?.[1]).toMatchObject({ content: '전체 답' });
    expect(s.getSnapshot().entries.get('s-a')?.pending).toBe(false);
    expect(s.getSnapshot().active.has('s-a')).toBe(false);
  });

  it('삭제한 대화에 늦게 온 종결 이벤트는 새 답변 표시를 남기지 않는다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    s.newConversation();
    s.forget('s-a');
    ev(s, 'cancelled', { correlationId: 'corr-a', sessionId: 's-a', reason: 'user' });
    expect(s.getSnapshot().unseenDone.has('s-a')).toBe(false);
    expect(s.getSnapshot().entries.has('s-a')).toBe(false);
    expect(sessionStatus(s.getSnapshot(), 's-a')).toBeNull();
  });

  it('삭제 전에 요청한 재동기화 응답이 삭제한 대화를 생성 중으로 되살리지 않는다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    const token = s.beginResync();
    s.forget('s-a');
    s.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '' }], 3, token);
    expect(s.getSnapshot().active.has('s-a')).toBe(false);
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(s.getSnapshot().unseenDone.has('s-a')).toBe(false);
  });
});

describe('미확인 완료·집계', () => {
  it('보고 있지 않은 대화가 끝나면 새 답변, 열면 해제(+localStorage 영속)', () => {
    const { s, storage } = setup();
    s.setPanelOpen(true);
    ask(s, 'A', 'corr-a', 's-a');
    ask(s, 'B', 'corr-b', 's-b');
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    ev(s, 'done', { correlationId: 'corr-b', sessionId: 's-b', widgets: null });
    expect(sessionStatus(s.getSnapshot(), 's-a')).toBe('unseen');
    expect(sessionStatus(s.getSnapshot(), 's-b')).toBeNull(); // 보고 있던 대화
    expect(JSON.parse(storage.raw.get('ai-chat-unseen:1:1')!)).toEqual(['s-a']);
    s.select('s-a');
    expect(sessionStatus(s.getSnapshot(), 's-a')).toBeNull();
  });

  it('패널이 닫혀 있으면 현재 대화도 새 답변, 패널을 열면 해제', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(triggerActivityOf(s.getSnapshot(), false)).toBe('done');
    s.setPanelOpen(true);
    expect(triggerActivityOf(s.getSnapshot(), false)).toBe('idle');
  });

  it('localStorage 가 막혀도 메모리 표시는 동작한다', () => {
    const { s } = setup(memStorage(true));
    ask(s, 'A', 'corr-a', 's-a');
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(sessionStatus(s.getSnapshot(), 's-a')).toBe('unseen');
  });

  it('owner 가 바뀌면 칸·생성 중·미확인을 비우고 새 owner 의 미확인을 읽는다', () => {
    const storage = memStorage();
    storage.raw.set('ai-chat-unseen:2:1', JSON.stringify(['s-z']));
    const { s } = setup(storage);
    ask(s, 'A', 'corr-a', 's-a');
    s.setOwner('2:1');
    expect(s.getSnapshot().entries.size).toBe(0);
    expect(s.getSnapshot().active.size).toBe(0);
    expect([...s.getSnapshot().unseenDone]).toEqual(['s-z']);
  });

  it('triggerActivity: 생성 중 > 새 답변 > idle, 열려 있으면 idle', () => {
    const { s } = setup();
    expect(triggerActivityOf(s.getSnapshot(), false)).toBe('idle');
    ask(s, 'A', 'corr-a', 's-a');
    expect(triggerActivityOf(s.getSnapshot(), false)).toBe('pending');
    expect(triggerActivityOf(s.getSnapshot(), true)).toBe('idle');
  });

  it('otherActivity 는 현재 대화를 뺀다', () => {
    const { s } = setup();
    s.setPanelOpen(true);
    ask(s, 'A', 'corr-a', 's-a');
    expect(otherActivity(s.getSnapshot())).toBe('idle'); // 현재 = A
    s.newConversation();
    expect(otherActivity(s.getSnapshot())).toBe('pending');
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(otherActivity(s.getSnapshot())).toBe('done');
  });

  it('atLimit: 생성 중 수가 상한 이상이고 현재 대화가 생성 중이 아닐 때', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    ask(s, 'B', 'corr-b', 's-b');
    ask(s, 'C', 'corr-c', 's-c');
    expect(atLimit(s.getSnapshot())).toBe(false); // 현재 = C(생성 중)
    s.newConversation();
    expect(atLimit(s.getSnapshot())).toBe(true);
    expect(sendBlocked(s.getSnapshot())).toBe(true);
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    expect(atLimit(s.getSnapshot())).toBe(false);
  });

  it('상한값은 서버 응답을 따른다', () => {
    const { s } = setup();
    s.setActive([{ sessionId: 's-x', correlationId: 'c-x', startedAt: '' }], 1, s.beginResync());
    expect(atLimit(s.getSnapshot())).toBe(true);
    expect(s.getSnapshot().limit).toBe(1);
  });

  it('목록이 완전할 때만 사라진 대화의 미확인 표시를 지운다', () => {
    const { s } = setup();
    ask(s, 'A', 'corr-a', 's-a');
    s.newConversation();
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null });
    s.pruneUnseen(['s-b'], false);
    expect(s.getSnapshot().unseenDone.has('s-a')).toBe(true);
    s.pruneUnseen(['s-b'], true);
    expect(s.getSnapshot().unseenDone.has('s-a')).toBe(false);
  });

  it('getSnapshot 은 변경이 없으면 같은 참조(useSyncExternalStore 무한 루프 방지)', () => {
    const { s } = setup();
    expect(s.getSnapshot()).toBe(s.getSnapshot());
  });
});

describe('첨부(WP-234)', () => {
  const att = (fileId: number, previewUrl?: string) => ({
    fileId, originalName: `f${fileId}.png`, mimeType: 'image/png', sizeBytes: 10, ...(previewUrl ? { previewUrl } : {}),
  });

  it('낙관적 사용자 턴에 첨부를 붙이고, 일반 오류로 거절되면 그 턴의 첨부만 뗀다(미리보기는 초안 소유라 해제하지 않음)', () => {
    const { s } = setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { key, gen, userTurn } = s.startTurn('사진 봐 줘', [att(7, 'blob:p7')]);
    expect(turnsOf(s, key)?.[0]).toMatchObject({ role: 'user', attachments: [{ fileId: 7 }] });
    s.failStart(key, gen, '응답 생성에 실패했습니다. 다시 시도해 주세요.', userTurn);
    expect(turnsOf(s, key)?.[0]).toEqual({ role: 'user', content: '사진 봐 줘' });
    expect(turnsOf(s, key)?.[1]).toMatchObject({ content: '응답 생성에 실패했습니다. 다시 시도해 주세요.' });
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });

  it('POST 응답 전 ■ 뒤 늦게 온 일반 거절도 세대와 무관하게 그 턴의 첨부를 뗀다', () => {
    const { s } = setup();
    ask(s, '첫 질문', 'corr-1', 's-a');
    ev(s, 'done', { correlationId: 'corr-1', sessionId: 's-a' });
    const { key, gen, userTurn } = s.startTurn('', [att(8)]);
    s.stopLocal(key); // 세대 증가 + 취소 예약
    s.failStart(key, gen, 'x', userTurn);
    const turns = turnsOf(s, key)!;
    expect(turns.some((t) => t.role === 'user' && t.attachments?.length)).toBe(false);
  });

  it('대화 전환(새 대화·다른 대화 선택·현재 대화 삭제)마다 첨부 초안 초기화 신호가 오르고, 같은 대화 재선택은 오르지 않는다', () => {
    const { s } = setup();
    const n0 = s.getSnapshot().attachmentResetNonce;
    s.newConversation();
    expect(s.getSnapshot().attachmentResetNonce).toBe(n0 + 1);
    s.select('s-x');
    expect(s.getSnapshot().attachmentResetNonce).toBe(n0 + 2);
    s.select('s-x');
    expect(s.getSnapshot().attachmentResetNonce).toBe(n0 + 2);
    s.forget('s-x');
    expect(s.getSnapshot().attachmentResetNonce).toBe(n0 + 3);
  });

  it('칸을 버릴 때(삭제·서버 이력으로 교체) 보낸 턴의 미리보기를 해제한다', () => {
    const { s } = setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    s.newConversation();
    const a = s.startTurn('A', [att(1, 'blob:a')]);
    s.attach(a.key, a.gen, 'corr-a', 's-a');
    ev(s, 'done', { correlationId: 'corr-a', sessionId: 's-a' });
    s.load('s-a', [{ role: 'user', content: 'A', attachments: [att(1)] }, { role: 'assistant', content: '답' }], []);
    expect(revoke).toHaveBeenCalledWith('blob:a');
    revoke.mockClear();
    s.newConversation();
    const b = s.startTurn('B', [att(2, 'blob:b')]);
    s.attach(b.key, b.gen, 'corr-b', 's-b');
    ev(s, 'done', { correlationId: 'corr-b', sessionId: 's-b' });
    s.forget('s-b');
    expect(revoke).toHaveBeenCalledWith('blob:b');
    revoke.mockRestore();
  });
});
