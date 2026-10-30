// 사용자 매뉴얼 촬영 테넌트 시드의 쓰기 전 가드와 진행 순서 시험 — 대상 서버·테넌트 로그인·빈 테넌트·쓰기 순서(WP-1194),
// 홈 장면 보강과 --extras-only(WP-1196).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeople, PEOPLE as CAST } from '../../intro/scripts/seed-demo.mjs';
import { isLocalHost } from './lib/operator-seed.mjs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { makePdf, makePng } from './lib/sample-files.mjs';
import {
  AI_RUN,
  APP_EXTRAS,
  checkFreshTenant,
  checkManualTarget,
  CHAT_CAL,
  judgeGenie,
  parseWaitMs,
  pickBotIssues,
  SCENE_ISSUES,
  EXTRAS,
  kstDay,
  loginIntoSlug,
  RESET_HINT,
  runAiRun,
  runAppExtrasOnly,
  runChatCalendarOnly,
  runExtrasOnly,
  runManualSeed,
  SeedRefusal,
  seedAppExtras,
  seedChatCalendarExtras,
  seedManualExtras,
} from './lib/user-seed.mjs';

test('isLocalHost is the one localhost rule shared by both seed guards', () => {
  for (const u of ['http://localhost:1', 'http://127.0.0.1', 'http://[::1]:6167']) assert.equal(isLocalHost(new URL(u)), true, u);
  for (const u of ['https://genia-works.iacloud.kr', 'http://10.0.0.5', 'http://localhost.example.com']) assert.equal(isLocalHost(new URL(u)), false, u);
});

test('checkManualTarget allows localhost without confirmation and trims the trailing slash', () => {
  for (const api of ['http://localhost:6167/', 'http://127.0.0.1:6167', 'http://[::1]:6167']) {
    const r = checkManualTarget({ api, slug: 'nuri-demo' });
    assert.equal(r.ok, true, api);
    assert.equal(r.local, true);
    assert.ok(!r.base.endsWith('/'));
  }
});

test('checkManualTarget requires confirm equal to the slug for a remote server', () => {
  const api = 'https://genia-works.iacloud.kr';
  assert.equal(checkManualTarget({ api, slug: 'nuri-demo' }).ok, false);
  assert.equal(checkManualTarget({ api, slug: 'nuri-demo', confirm: 'nuri' }).ok, false);
  assert.match(checkManualTarget({ api, slug: 'nuri-demo', confirm: '' }).reason, /MANUAL_SEED_CONFIRM/);
  assert.deepEqual(checkManualTarget({ api, slug: 'nuri-demo', confirm: 'nuri-demo' }), {
    ok: true,
    base: api,
    local: false,
  });
});

test('checkManualTarget refuses plain http to a remote server even when confirmed', () => {
  const r = checkManualTarget({ api: 'http://genia-works.iacloud.kr', slug: 'nuri-demo', confirm: 'nuri-demo' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /https/);
});

test('checkManualTarget refuses a path, query or hash so /api/v1 is never doubled', () => {
  for (const api of ['https://genia-works.iacloud.kr/api/v1', 'http://localhost:6167/api', 'http://localhost:6167/?x=1', 'http://localhost:6167/#a']) {
    const r = checkManualTarget({ api, slug: 'nuri-demo', confirm: 'nuri-demo' });
    assert.equal(r.ok, false, api);
    assert.match(r.reason, /루트/);
  }
  assert.equal(checkManualTarget({ api: 'http://localhost:6167/', slug: 'nuri-demo' }).base, 'http://localhost:6167');
});

test('checkManualTarget refuses bad urls, other schemes and an empty slug', () => {
  assert.equal(checkManualTarget({ api: 'not a url', slug: 'nuri-demo' }).ok, false);
  assert.equal(checkManualTarget({ api: 'ftp://localhost:6167', slug: 'nuri-demo' }).ok, false);
  assert.equal(checkManualTarget({ api: 'http://localhost:6167', slug: '' }).ok, false);
});

// ── 빈 테넌트 가드 ──────────────────────────────────────────────────────────

const PEOPLE = [
  { key: 'pm', username: 'seoyeon@example.com' },
  { key: 'dev', username: 'junho@example.com' },
  { key: 'qa', username: 'doyun@example.com' },
];
const base = {
  owner: 'seoyeon@example.com',
  people: PEOPLE,
  humans: [{ id: 1, username: 'seoyeon@example.com' }],
  humansTotal: 1,
  projectExists: false,
  projectKey: 'MOB',
};

test('checkFreshTenant accepts a tenant with only the owner', () => {
  assert.deepEqual(checkFreshTenant(base), {});
});

test('checkFreshTenant reuses cast members re-added as existing users', () => {
  const ids = checkFreshTenant({ ...base, humans: [...base.humans, { id: 5, username: 'Junho@example.com' }], humansTotal: 2 });
  assert.deepEqual(ids, { dev: 5 });
});

test('checkFreshTenant refuses a seeded or foreign tenant with the reset hint', () => {
  const cases = [
    { ...base, projectExists: true },
    { ...base, humans: [...base.humans, { id: 9, username: 'real.person@corp.kr' }], humansTotal: 2 },
    { ...base, humans: [{ id: 5, username: 'junho@example.com' }] },
    { ...base, humansTotal: 150 },
  ];
  for (const c of cases) {
    assert.throws(
      () => checkFreshTenant(c),
      (e) => e instanceof SeedRefusal && e.message.includes(RESET_HINT),
    );
  }
  assert.match(RESET_HINT, /영구 삭제/);
});

// ── 가짜 서버로 로그인·진행 순서 시험 ────────────────────────────────────────

/** 서명 없는 시험용 JWT — 시드는 클레임만 읽는다. */
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const tenantOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).tenant;

/**
 * 시험용 가짜 client — 호출을 순서대로 기록한다. accounts: username → { password, tenants: [tenantId…] }.
 * 로그인은 소속이 하나일 때만 토큰에 테넌트를 싣는다(서버와 같은 규칙). conflicts 에 든 아이디는 POST /users 가 409.
 * selectTenantTo 를 주면 테넌트 선택이 그 테넌트 토큰을 돌려준다(어긋난 토큰 시험용). 실패는 실제 client 처럼 status 를 싣는다.
 */
function fakeServer({ accounts, humans = [], conflicts = [], projectExists = false, selectTenantTo, issueTitles = [] }) {
  const calls = [];
  const SLUGS = { 7: 'nuri-demo', 8: 'other' };
  let nextId = 100;
  const fail = (method, path, status) => {
    throw Object.assign(new Error(`${method} ${path} → ${status} {}`), { status, body: '{}' });
  };
  const call = async (token, method, path, body, { allow = [] } = {}) => {
    calls.push({ method, path, user: body?.username, token, body });
    if (path === '/auth/login') {
      const a = accounts[body.username];
      if (!a || a.password !== body.password) {
        if (allow.includes(401)) return null;
        fail(method, path, 401);
      }
      const memberships = a.tenants.map((id) => ({ tenantId: id, tenantName: `T${id}`, tenantSlug: SLUGS[id] }));
      return { accessToken: jwt({ sub: body.username, tenant: a.tenants.length === 1 ? a.tenants[0] : undefined }), memberships };
    }
    if (path === '/auth/select-tenant') return { accessToken: jwt({ tenant: selectTenantTo ?? body.tenantId }) };
    if (method === 'GET' && path.startsWith('/users?')) return { content: humans, totalElements: humans.length };
    if (method === 'GET' && path === '/users/me') return { id: 1 };
    if (method === 'GET' && path.startsWith('/projects/MOB/issues?')) {
      return { items: issueTitles.map((title, i) => ({ id: i + 1, title })), nextCursor: null, hasMore: false };
    }
    if (method === 'GET' && path === '/projects/MOB/types') return [{ code: 'EPIC', typeId: 2 }, { code: 'TASK', typeId: 3 }];
    if (method === 'POST' && path === '/projects/MOB/issues') {
      const id = nextId++;
      return { id, number: id - 80 };
    }
    if (method === 'PATCH' && /^\/projects\/MOB\/issues\/\d+\/status$/.test(path)) return null;
    if (method === 'POST' && /^\/issues\/\d+\/comments$/.test(path)) return { id: nextId++ };
    if (method === 'GET' && path.startsWith('/projects/')) {
      if (projectExists) return { key: 'MOB' };
      if (allow.includes(404)) return null;
      fail(method, path, 404);
    }
    if (method === 'POST' && path === '/users') {
      if (conflicts.includes(body.username)) fail(method, path, 409);
      accounts[body.username] = { password: body.password, tenants: [7] };
      return { userId: nextId++ };
    }
    throw new Error(`fake: unexpected ${method} ${path}`);
  };
  return { calls, client: { call, login: () => assert.fail('plain login must not be used') } };
}

/** 로그인·조회가 아닌 호출 = 쓰기. */
const isWrite = (c) => c.method !== 'GET' && !c.path.startsWith('/auth/');
const PASS = 'Secret1x';
const owner = { password: PASS, tenants: [7] };
const login = (s, username, password = PASS) => loginIntoSlug(s.client, { username, password, slug: 'nuri-demo' });

test('loginIntoSlug keeps the auto-scoped token of a single-tenant account', async () => {
  const s = fakeServer({ accounts: { 'seoyeon@example.com': owner } });
  const r = await login(s, 'seoyeon@example.com');
  assert.equal(tenantOf(r.token), 7);
  assert.equal(r.membership.tenantSlug, 'nuri-demo');
  assert.deepEqual(s.calls.map((c) => c.path), ['/auth/login']);
});

test('loginIntoSlug selects the slug tenant for a member of two tenants', async () => {
  const s = fakeServer({ accounts: { 'junho@example.com': { password: PASS, tenants: [8, 7] } } });
  const r = await login(s, 'junho@example.com');
  assert.equal(tenantOf(r.token), 7);
  assert.deepEqual(s.calls.map((c) => c.path), ['/auth/login', '/auth/select-tenant']);
});

test('loginIntoSlug refuses a bad password, a non-member and a token for the wrong tenant', async () => {
  const accounts = { 'seoyeon@example.com': owner, 'x@example.com': { password: PASS, tenants: [8] } };
  await assert.rejects(login(fakeServer({ accounts }), 'seoyeon@example.com', 'bad'), (e) => e instanceof SeedRefusal && /로그인 실패/.test(e.message));
  await assert.rejects(login(fakeServer({ accounts }), 'x@example.com'), (e) => e instanceof SeedRefusal && /구성원이 아닙니다/.test(e.message));
  const multi = { 'junho@example.com': { password: PASS, tenants: [8, 7] } };
  await assert.rejects(login(fakeServer({ accounts: multi, selectTenantTo: 8 }), 'junho@example.com'), (e) => e instanceof SeedRefusal && /현재 테넌트\(8\)/.test(e.message));
});

const fakeSteps = (log) => ({
  ensureAgent: async () => {
    log.push('agent');
    return { id: 50, created: true };
  },
  createPeople,
  seedContent: async ({ ids, tokens }) => {
    log.push('content');
    return { ids, tokens };
  },
  seedManualExtras: async () => {
    log.push('extras');
    return { dueToday: 14, overdue: 15 };
  },
  seedChatCalendarExtras: async () => {
    log.push('chat-calendar');
    return { dmId: 9 };
  },
  seedAppExtras: async () => {
    log.push('app');
    return { agent: 'release-bot' };
  },
});
const run = (server, steps) =>
  runManualSeed({ client: server.client, slug: 'nuri-demo', password: PASS, people: CAST, agent: { username: 'genie', email: 'genie@example.com' }, projectKey: 'MOB', steps });

test('createPeople skips POST /users for existing members and reuses their pre-fetched tokens', async () => {
  const s = fakeServer({ accounts: {} });
  const signed = [];
  const existing = { dev: { id: 11, token: 'tok-dev' }, qa: { id: 12, token: 'tok-qa' } };
  const r = await createPeople({ client: s.client, admin: 'adm', password: PASS, existing, signIn: async (u) => (signed.push(u), `tok-${u}`) });
  const posted = s.calls.filter((c) => c.path === '/users').map((c) => c.user);
  assert.deepEqual(posted, ['jimin@example.com', 'yuna@example.com']);
  assert.deepEqual(signed, ['jimin@example.com', 'yuna@example.com']); // 기존 구성원은 다시 로그인하지 않는다
  assert.equal(r.ids.dev, 11);
  assert.equal(r.tokens.qa, 'tok-qa');
});

test('createPeople surfaces one structured failure with the failed person and those already created', async () => {
  const s = fakeServer({ accounts: {}, conflicts: ['yuna@example.com'] });
  await assert.rejects(createPeople({ client: s.client, admin: 'adm', password: PASS, signIn: async () => 't' }), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.username, 'yuna@example.com');
    assert.deepEqual(e.created, ['junho@example.com', 'jimin@example.com']);
    return true;
  });
});

test('runManualSeed logs in the owner and every reused member before the first write', async () => {
  const accounts = { 'seoyeon@example.com': owner, 'junho@example.com': { password: PASS, tenants: [8, 7] } };
  const humans = [{ id: 1, username: 'seoyeon@example.com' }, { id: 2, username: 'junho@example.com' }];
  const s = fakeServer({ accounts, humans });
  const log = [];
  const out = await run(s, fakeSteps(log));
  assert.deepEqual(log, ['agent', 'content', 'extras', 'chat-calendar', 'app']); // 보강은 콘텐츠 뒤에
  assert.deepEqual(out.extras, { dueToday: 14, overdue: 15 });
  const firstWrite = s.calls.findIndex(isWrite);
  const logins = s.calls.map((c, i) => [c, i]).filter(([c]) => c.path === '/auth/login');
  // 소유자·준호(재사용)는 첫 쓰기 전에, 새로 만든 셋은 만든 뒤에 로그인한다
  for (const u of ['seoyeon@example.com', 'junho@example.com']) {
    assert.ok(logins.find(([c]) => c.user === u)[1] < firstWrite, u);
  }
  assert.equal(logins.filter(([c]) => c.user === 'junho@example.com').length, 1); // 한 번만
  assert.equal(tenantOf(out.tokens.dev), 7); // 두 테넌트 소속이라 테넌트를 골랐다
  assert.equal(out.ids.agent, 50);
});

test('runManualSeed stops with nothing written when a reused member cannot log in', async () => {
  const accounts = { 'seoyeon@example.com': owner, 'junho@example.com': { password: 'Other1xx', tenants: [7] } };
  const humans = [{ id: 1, username: 'seoyeon@example.com' }, { id: 2, username: 'junho@example.com' }];
  const s = fakeServer({ accounts, humans });
  const log = [];
  await assert.rejects(run(s, fakeSteps(log)), (e) => e instanceof SeedRefusal && /junho/.test(e.message));
  assert.deepEqual(log, []);
  assert.equal(s.calls.filter(isWrite).length, 0);
});

test('runManualSeed stops with nothing written on a seeded tenant', async () => {
  const s = fakeServer({ accounts: { 'seoyeon@example.com': owner }, humans: [{ id: 1, username: 'seoyeon@example.com' }], projectExists: true });
  await assert.rejects(run(s, fakeSteps([])), (e) => e instanceof SeedRefusal && /MOB/.test(e.message));
  assert.equal(s.calls.filter(isWrite).length, 0);
});

test('runManualSeed refuses with nothing written when the agent name is taken elsewhere', async () => {
  const s = fakeServer({ accounts: { 'seoyeon@example.com': owner }, humans: [{ id: 1, username: 'seoyeon@example.com' }] });
  const steps = {
    ...fakeSteps([]),
    ensureAgent: async () => {
      throw Object.assign(new Error('POST /admin/agents → 409 {"message":"이미 사용 중인 아이디입니다."}'), { status: 409 });
    },
  };
  await assert.rejects(run(s, steps), (e) => e instanceof SeedRefusal && /genie/.test(e.message));
  assert.equal(s.calls.filter(isWrite).length, 0);
});

test('runManualSeed on a 409 lists only the failed person and later non-members, and what was already written', async () => {
  const s = fakeServer({
    accounts: { 'seoyeon@example.com': owner, 'yuna@example.com': { password: PASS, tenants: [7] } },
    humans: [{ id: 1, username: 'seoyeon@example.com' }, { id: 4, username: 'yuna@example.com' }],
    conflicts: ['jimin@example.com'],
  });
  await assert.rejects(run(s, fakeSteps([])), (e) => {
    assert.ok(!(e instanceof SeedRefusal)); // 이미 쓴 것이 있다
    assert.match(e.message, /「기존 사용자 추가」\(일반 구성원\)로 넣고 다시 돌립니다: jimin@example\.com/);
    assert.match(e.message, /뒤에 만들 차례였던 doyun@example\.com 도/); // 이미 구성원인 yuna 는 빠진다
    assert.doesNotMatch(e.message, /차례였던[^.]*yuna/);
    assert.match(e.message, /이미 쓴 것: 에이전트 genie, 계정 junho@example\.com/);
    return true;
  });
});

test('runManualSeed says nothing was written when the first person collides on a resumed run', async () => {
  const s = fakeServer({
    accounts: { 'seoyeon@example.com': owner },
    humans: [{ id: 1, username: 'seoyeon@example.com' }],
    conflicts: ['junho@example.com'],
  });
  const steps = { ...fakeSteps([]), ensureAgent: async () => ({ id: 50, created: false }) }; // 앞선 실행이 만든 에이전트를 이어 씀
  await assert.rejects(run(s, steps), /쓴 것은 없습니다/);
});

// ── 홈 장면 보강(WP-1196) ────────────────────────────────────────────────────

test('kstDay uses the Korean calendar day, not the UTC one', () => {
  const now = new Date('2026-10-28T23:30:00Z'); // 한국 시간 10-29 08:30
  assert.equal(kstDay(0, now), '2026-10-29');
  assert.equal(kstDay(-2, now), '2026-10-27');
});

test('seedManualExtras adds a due-today and an overdue issue for seoyeon and a mention comment by junho', async () => {
  const s = fakeServer({ accounts: {} });
  const now = new Date('2026-10-29T03:00:00Z');
  const r = await seedManualExtras({ client: s.client, ids: { pm: 1 }, tokens: { pm: 'adm', dev: 'dev' }, projectKey: 'MOB', now });
  const issues = s.calls.filter((c) => c.method === 'POST' && c.path === '/projects/MOB/issues').map((c) => c.body);
  assert.deepEqual(
    issues.map((b) => [b.title, b.dueDate, b.assigneeIds, b.typeId]),
    [
      [EXTRAS.dueToday, '2026-10-29', [1], 3],
      [EXTRAS.overdue, '2026-10-27', [1], 3],
    ],
  );
  const patch = s.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, `/projects/MOB/issues/${r.dueToday}/status`);
  assert.deepEqual(patch.body, { status: 'IN_PROGRESS' }); // 마감 지남 이슈는 할 일 그대로
  const comment = s.calls.find((c) => /\/comments$/.test(c.path));
  assert.equal(comment.token, 'dev'); // 이준호가 쓴다
  assert.match(comment.body.body, /^<@1> /); // 웹 편집기와 같은 멘션 토큰
  assert.ok(s.calls.every((c) => c.path.endsWith('/comments') || c.token === 'adm'));
});

const extrasAccounts = () => ({ 'seoyeon@example.com': { password: PASS, tenants: [7] }, 'junho@example.com': { password: PASS, tenants: [8, 7] } });
const runExtras = (s, seedExtras) =>
  runExtrasOnly({ client: s.client, slug: 'nuri-demo', password: PASS, people: CAST, projectKey: 'MOB', ...(seedExtras ? { seedExtras } : {}) });

test('runExtrasOnly refuses with nothing written when the project does not exist yet', async () => {
  const s = fakeServer({ accounts: extrasAccounts() });
  await assert.rejects(runExtras(s), (e) => e instanceof SeedRefusal && /MOB 가 없습니다/.test(e.message));
  assert.equal(s.calls.filter(isWrite).length, 0);
});

test('runExtrasOnly refuses with nothing written when any extras issue is already there', async () => {
  for (const title of Object.values(EXTRAS)) {
    const s = fakeServer({ accounts: extrasAccounts(), projectExists: true, issueTitles: ['간편 재주문', title] });
    await assert.rejects(runExtras(s), (e) => e instanceof SeedRefusal && e.message.includes(title));
    assert.equal(s.calls.filter(isWrite).length, 0);
    assert.equal(s.calls.filter((c) => c.user === 'junho@example.com').length, 0); // 멈출 테넌트에 이준호는 로그인하지 않는다
  }
});

test('runExtrasOnly logs in seoyeon and junho once each before the first write', async () => {
  const s = fakeServer({ accounts: extrasAccounts(), projectExists: true, issueTitles: ['간편 재주문'] });
  const r = await runExtras(s);
  const firstWrite = s.calls.findIndex(isWrite);
  const logins = s.calls.map((c, i) => [c, i]).filter(([c]) => c.path === '/auth/login');
  assert.deepEqual(logins.map(([c]) => c.user), ['seoyeon@example.com', 'junho@example.com']); // 필요한 두 계정만, 한 번씩
  assert.ok(logins.every(([, i]) => i < firstWrite));
  const comment = s.calls.find((c) => /\/comments$/.test(c.path));
  assert.equal(tenantOf(comment.token), 7); // 두 테넌트 소속인 준호도 nuri-demo 로 골라 쓴다
  assert.equal(typeof r.dueToday, 'number');
});

test('runExtrasOnly reports a failure after writes without claiming nothing was written', async () => {
  const s = fakeServer({ accounts: extrasAccounts(), projectExists: true });
  const boom = async () => {
    throw new Error('POST /issues/1/comments → 500 {}');
  };
  await assert.rejects(runExtras(s, boom), (e) => !(e instanceof SeedRefusal) && /일부가 들어갔을 수 있습니다/.test(e.message));
});

// ── 05 대화·07 캘린더 보강(WP-1196) ──────────────────────────────────────────

const PM_ID = 1;
const IDS = { pm: 1, dev: 2, design: 3, mkt: 4, qa: 5 };

/**
 * 대화·캘린더 보강용 가짜 서버 — 토큰은 `tok-<key>`(runChatCalendarOnly 경로에서는 로그인으로 받은 JWT)이다.
 * present 에 든 표식(dm·thread·reaction·invite·tag)은 이미 들어간 상태로 응답한다. noChannel 이면 채널이 없다.
 */
function fakeChat({ present = [], noChannel = false } = {}) {
  const calls = [];
  let nextId = 500;
  const messages = [
    { id: 11, authorId: PM_ID, body: `${CHAT_CAL.threadRoot}. 막히는 부분 있으면 여기 공유해 주세요.`, replyCount: present.includes('thread') ? 1 : 0, reactions: [] },
    { id: 12, authorId: 3, body: `${CHAT_CAL.reactTarget}. 홈 상단과 주문 내역 두 곳에 배치했어요.`, replyCount: 0, reactions: present.includes('reaction') ? [{ emoji: '👍' }] : [] },
  ];
  const events = [
    { id: 21, title: '베타 오픈 Go/No-Go' },
    { id: 22, title: '스프린트 7 데일리' },
    { id: 23, title: '스프린트 7 데일리' },
    { id: 24, title: '재주문 디자인 리뷰' },
    ...(present.includes('invite') ? [{ id: 25, title: CHAT_CAL.invite.title }] : []),
  ];
  const accounts = Object.fromEntries(CAST.map((p) => [p.username, { password: PASS, tenants: [7] }]));
  const call = async (token, method, path, body, { allow = [] } = {}) => {
    calls.push({ token, method, path, body, user: body?.username });
    if (path === '/auth/login') {
      const a = accounts[body.username];
      if (!a || a.password !== body.password) return allow.includes(401) ? null : assert.fail('login');
      return { accessToken: jwt({ sub: body.username, tenant: 7 }), memberships: [{ tenantId: 7, tenantName: '누리커머스', tenantSlug: 'nuri-demo' }] };
    }
    if (method === 'GET' && path.startsWith('/users?')) {
      return { content: CAST.map((p) => ({ id: IDS[p.key], username: p.username })), totalElements: 5 };
    }
    if (method === 'GET' && path === '/messaging/channels') return noChannel ? [] : [{ id: 1, name: CHAT_CAL.channel }];
    if (method === 'GET' && path.startsWith('/messaging/channels/1/messages')) return { items: messages, nextCursor: null, hasMore: false };
    if (method === 'GET' && path.startsWith('/calendar/events?')) return events;
    if (method === 'GET' && path === '/calendar/tags') return present.includes('tag') ? [{ id: 1, name: CHAT_CAL.tags[0].name }] : [];
    if (method === 'GET' && path === '/messaging/dms') {
      return present.includes('dm') ? [{ id: 30, participants: [{ userId: PM_ID }, { userId: 2 }], lastMessage: { id: 1 } }] : [];
    }
    if (method === 'POST' && path === '/messaging/dms') return { id: 30 };
    if (method === 'POST' && /\/messages$/.test(path)) return { id: nextId++ };
    if (method === 'POST' && /\/read$/.test(path)) return null;
    if (method === 'POST' && /\/reactions$/.test(path)) return null;
    if (method === 'POST' && path.startsWith('/calendar/events')) return { id: nextId++ };
    if (method === 'POST' && path === '/calendar/tags') return { id: nextId++, name: body.name };
    if (method === 'PUT' && /^\/calendar\/events\/\d+\/tags$/.test(path)) return null;
    throw new Error(`fake: unexpected ${method} ${path}`);
  };
  return { calls, client: { call, login: () => assert.fail('plain login must not be used') } };
}

const TOKENS = Object.fromEntries(Object.keys(IDS).map((k) => [k, `tok-${k}`]));
const writer = (s, pred) => s.calls.filter((c) => isWrite(c) && pred(c));

test('seedChatCalendarExtras writes each item with the right person token', async () => {
  const s = fakeChat();
  const now = new Date('2026-10-29T03:00:00Z');
  const r = await seedChatCalendarExtras({ client: s.client, ids: IDS, tokens: TOKENS, now });
  // DM: 이준호가 열고, 이준호·김서연·이준호 순으로 쓰며, 김서연은 자기 답장까지만 읽는다(마지막 한 건은 안 읽음)
  assert.equal(writer(s, (c) => c.path === '/messaging/dms')[0].token, 'tok-dev');
  const dmWrites = writer(s, (c) => c.path.startsWith('/messaging/channels/30/'));
  assert.deepEqual(dmWrites.map((c) => [c.token, c.path.endsWith('/read') ? 'read' : 'msg']), [
    ['tok-dev', 'msg'],
    ['tok-pm', 'msg'],
    ['tok-pm', 'read'],
    ['tok-dev', 'msg'],
  ]);
  // 스레드 답글: 김서연 메시지(11)에 다른 사람이
  const replies = writer(s, (c) => c.path === '/messaging/channels/1/messages');
  assert.deepEqual(replies.map((c) => [c.token, c.body.parentMessageId]), [['tok-design', 11], ['tok-qa', 11]]);
  assert.equal(writer(s, (c) => c.path.startsWith('/messaging/channels/1/read')).length, 0); // 김서연은 스레드를 읽지 않는다
  // 반응: 시안 메시지(12)에 세 사람이
  assert.deepEqual(writer(s, (c) => c.path.endsWith('/reactions')).map((c) => [c.path, c.token]), [
    ['/messaging/messages/12/reactions', 'tok-dev'],
    ['/messaging/messages/12/reactions', 'tok-qa'],
    ['/messaging/messages/12/reactions', 'tok-mkt'],
  ]);
  // 초대: 이준호 주최, 알림 없이, 다음 날 14시(한국 시간), 김서연·박지민 초대
  const invite = writer(s, (c) => c.path.startsWith('/calendar/events?'))[0];
  assert.equal(invite.token, 'tok-dev');
  assert.equal(invite.path, '/calendar/events?notify=false');
  assert.equal(invite.body.startsAt, '2026-10-30T14:00:00+09:00');
  assert.deepEqual(invite.body.attendeeUserIds, [IDS.pm, IDS.design]);
  // 태그: 김서연이 만들어 제목이 맞는 자기 일정 모두에 붙인다
  const tagPuts = writer(s, (c) => c.method === 'PUT');
  assert.deepEqual(tagPuts.map((c) => c.path), ['/calendar/events/21/tags', '/calendar/events/22/tags', '/calendar/events/23/tags']);
  assert.ok(tagPuts.every((c) => c.token === 'tok-pm'));
  assert.equal(r.tagged, 3);
});

test('seedChatCalendarExtras refuses before any write when any item is already there', async () => {
  for (const marker of ['dm', 'thread', 'reaction', 'invite', 'tag']) {
    const s = fakeChat({ present: [marker] });
    await assert.rejects(seedChatCalendarExtras({ client: s.client, ids: IDS, tokens: TOKENS }), SeedRefusal, marker);
    assert.equal(s.calls.filter(isWrite).length, 0, marker);
  }
});

const runChatCal = (s) => runChatCalendarOnly({ client: s.client, slug: 'nuri-demo', password: PASS, people: CAST });

test('runChatCalendarOnly logs in all five cast members once each before the first write', async () => {
  const s = fakeChat();
  await runChatCal(s);
  const firstWrite = s.calls.findIndex(isWrite);
  const logins = s.calls.map((c, i) => [c, i]).filter(([c]) => c.path === '/auth/login');
  assert.deepEqual(logins.map(([c]) => c.user), CAST.map((p) => p.username));
  assert.ok(logins.every(([, i]) => i < firstWrite));
  // 쓰기 전 조회(inspectChatCalendar)는 한 번만 한다 — 채널 목록 조회 횟수로 본다.
  assert.equal(s.calls.filter((c) => c.method === 'GET' && c.path === '/messaging/channels').length, 1);
});

test('runChatCalendarOnly stops with nothing written on an already-filled or unseeded tenant', async () => {
  for (const s of [fakeChat({ present: ['tag'] }), fakeChat({ noChannel: true })]) {
    await assert.rejects(runChatCal(s), SeedRefusal);
    assert.equal(s.calls.filter(isWrite).length, 0);
  }
});

// ── 05~16장 앱 장면 보강(WP-1197) ────────────────────────────────────────────

test('makePdf builds a PDF whose startxref points at the xref table', () => {
  const pdf = makePdf(['Beta test schedule', 'Week 1 (internal)']);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  assert.match(text, /\(Week 1 \\\(internal\\\)\) Tj/); // 괄호는 이스케이프한다
});

test('makePng output stays byte-identical (zlib.crc32 replaced the hand-written table)', () => {
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  assert.equal(sha(makePng()), 'e66ecedcd814b5e6009026f3f5d7574c1086262a7fe84efb24ed1ac271dba071');
  assert.equal(sha(makePng({ band: [220, 38, 38] })), '05a1614708a8cfec4344afc3dfe4fd6dc090aea5f22b69c8031e2f6ec95e5323');
  assert.equal(sha(makePng({ width: 40, height: 10 })), '478abb91a2dfb39e246f92a39e2f4549dde1e624fb2a8ee7a9b3f721350def48');
});

test('makePng builds a PNG with the requested size and a decodable image', () => {
  const png = makePng({ width: 40, height: 10 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 40);
  assert.equal(png.readUInt32BE(20), 10);
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.toString('latin1', 37, 41), 'IDAT');
  assert.equal(inflateSync(png.subarray(41, 41 + idatLen)).length, (1 + 40 * 3) * 10);
});

/**
 * 앱 장면 보강용 가짜 서버. present 에 든 표식은 이미 있는 상태로, missing 에 든 대상은 없는 상태로 응답한다.
 * agentConflict 면 에이전트 생성이 409. 업로드는 client.upload 로 받아 기록한다(키 응답은 secret 값을 싣는다).
 */
function fakeApp({ present = [], missing = [], agentConflict = false } = {}) {
  const calls = [];
  let nextId = 900;
  const A = APP_EXTRAS;
  const has = (k) => present.includes(k);
  const issues = A.versionIssues.map((title, i) => ({ id: 40 + i, number: 4 + i, title }));
  const agents = has('agent') ? [{ id: 8, username: A.agent.username }] : [];
  const fail = (method, path, status) => {
    throw Object.assign(new Error(`${method} ${path} → ${status} {}`), { status });
  };
  const call = async (token, method, path, body, { allow = [] } = {}) => {
    calls.push({ token, method, path, body, user: body?.username });
    if (path === '/auth/login') {
      return { accessToken: jwt({ sub: body.username, tenant: 7 }), memberships: [{ tenantId: 7, tenantName: '누리커머스', tenantSlug: 'nuri-demo' }] };
    }
    if (method === 'GET') {
      if (path.startsWith('/users?')) return { content: CAST.map((p) => ({ id: IDS[p.key], username: p.username })), totalElements: 5 };
      if (path === '/messaging/channels') {
        return [
          ...(missing.includes('channel') ? [] : [{ id: 1, name: A.channel }]),
          { id: 2, name: A.noticeChannel },
        ];
      }
      if (path === '/wiki/spaces') return [{ id: 10, type: 'TEAM', name: A.wikiSpace }, { id: 11, type: 'PERSONAL', name: '내 노트' }];
      if (path === '/wiki/spaces/10/pages') return A.sharedPages.map((title, i) => ({ id: 60 + i, title }));
      if (path === '/wiki/spaces/11/pages') return has('page') ? [{ id: 70, title: A.scratchPage }] : [];
      if (path.startsWith('/projects/MOB/issues?')) return { items: issues, nextCursor: null, hasMore: false };
      if (path === '/drive/spaces') return [{ id: 30, type: 'CHANNEL', name: A.channel }];
      if (path === '/drive/spaces/30/items') return { folders: [], files: has('drive') ? [{ name: A.channelFiles[0].name }] : [] };
      if (path === '/projects/MOB/versions') return has('version') ? [{ id: 1, name: A.version.name }] : [];
      if (/^\/projects\/MOB\/issues\/\d+\/attachments$/.test(path)) return has('attachment') ? [{ originalName: A.issueAttachment.name }] : [];
      if (path.startsWith('/messaging/channels/2/messages')) return { items: has('notice') ? [{ body: A.noticeMessage.body }] : [] };
      if (/^\/wiki\/pages\/\d+\/share$/.test(path)) return { share: has('share') ? { audience: 'WORKSPACE' } : null };
      if (path === '/user-groups') return { shared: has('group') ? [{ name: A.departments[0].name, children: [] }] : [], personal: [] };
      if (path === '/roles') return [{ id: 3, name: 'AGENT' }, ...(has('role') ? [{ id: 7, name: A.role.name }] : [])];
      if (path === '/admin/agents') return agents;
      if (path === '/permissions') return ['project:read', 'user:read', 'contact:read', 'calendar:read', 'role:write'].map((code, i) => ({ id: i + 1, code }));
    }
    if (method === 'POST' && path === '/admin/agents') {
      if (agentConflict) fail(method, path, 409);
      agents.push({ id: 8, username: body.username });
      return null;
    }
    if (method === 'POST' && /\/keys$/.test(path)) return { id: 1, label: body.label, key: 'ak_SECRET_VALUE' };
    if (method === 'POST' && path.endsWith('/drive-space')) return { spaceId: 30, archived: false };
    if (method === 'POST' || method === 'PUT') return { id: nextId++ };
    throw new Error(`fake: unexpected ${method} ${path}`);
  };
  const upload = async (token, path, name, buf, opts = {}) => {
    calls.push({ token, method: 'UPLOAD', path, name, size: buf.length, field: opts.field ?? 'file', type: opts.type });
    return opts.field === 'files' ? [{ fileId: nextId++ }] : { id: nextId++ };
  };
  return { calls, client: { call, upload, login: () => assert.fail('plain login must not be used') } };
}

const appWrites = (s) => s.calls.filter(isWrite);

test('seedAppExtras writes only with seoyeon token, agent first, and never returns the key value', async () => {
  const s = fakeApp();
  const now = new Date('2026-10-30T03:00:00Z');
  const r = await seedAppExtras({ client: s.client, ids: IDS, tokens: { pm: 'tok-pm', dev: 'tok-dev' }, projectKey: 'MOB', now });
  const writes = appWrites(s);
  assert.ok(writes.every((c) => c.token === 'tok-pm'));
  assert.equal(writes[0].path, '/admin/agents'); // 아이디 충돌이 날 수 있는 것을 맨 먼저
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  assert.deepEqual(writes.find((c) => c.path.endsWith('/runtime')).body, { runtime: 'EXTERNAL' });
  // 역할 권한은 서버에 있는 코드 중 지정한 것만
  assert.deepEqual(writes.find((c) => c.path.endsWith('/permissions')).body, { permissionIds: [1, 2, 3, 4] });
  // 그룹: 조직도 3개(공유) + 내 그룹 1개(개인), 멤버는 등장인물 id
  const groups = writes.filter((c) => c.path === '/user-groups').map((c) => c.body.visibility);
  assert.deepEqual(groups, ['SHARED', 'SHARED', 'SHARED', 'PERSONAL']);
  assert.ok(writes.filter((c) => /\/user-groups\/\d+\/members$/.test(c.path)).every((c) => c.body.targetType === 'MEMBER'));
  // 버전에 묶은 이슈 4건
  assert.deepEqual(writes.filter((c) => c.path.endsWith('/versions') && c.method === 'PUT').map((c) => c.path), [
    '/projects/MOB/issues/4/versions',
    '/projects/MOB/issues/5/versions',
    '/projects/MOB/issues/6/versions',
    '/projects/MOB/issues/7/versions',
  ]);
  // 링크 공유: 워크스페이스 전체 보기, 알림 없음, 30일 뒤 만료
  const shares = writes.filter((c) => c.path.endsWith('/share'));
  assert.equal(shares.length, 2);
  for (const c of shares) {
    assert.equal(c.body.audience, 'WORKSPACE');
    assert.equal(c.body.notify, null);
    assert.equal(c.body.expiresAt, '2026-11-29T18:00:00+09:00');
  }
  // 파일: 채널 드라이브 2개, 이슈 첨부 1개(files 필드), 공지 채널 첨부 1개 → 그 fileId 로 메시지
  const uploads = s.calls.filter((c) => c.method === 'UPLOAD');
  assert.deepEqual(uploads.map((c) => [c.path, c.field, c.type]), [
    ['/drive/spaces/30/files', 'file', 'application/pdf'],
    ['/drive/spaces/30/files', 'file', 'image/png'],
    ['/projects/MOB/issues/7/attachments', 'files', 'image/png'],
    ['/messaging/channels/2/attachments', 'files', 'application/pdf'],
  ]);
  const notice = writes.find((c) => c.path === '/messaging/channels/2/messages');
  assert.equal(notice.body.fileIds.length, 1);
  assert.equal(writes.filter((c) => c.path === '/messaging/channels/1/messages').length, 0); // 모바일-주문앱 대화는 그대로
});

test('seedAppExtras refuses before any write when any item is already there', async () => {
  for (const marker of ['drive', 'version', 'attachment', 'notice', 'page', 'share', 'group', 'role', 'agent']) {
    const s = fakeApp({ present: [marker] });
    await assert.rejects(seedAppExtras({ client: s.client, ids: IDS, tokens: { pm: 'tok-pm' }, projectKey: 'MOB' }), SeedRefusal, marker);
    assert.equal(appWrites(s).length, 0, marker);
  }
});

test('seedAppExtras stops with nothing written when the agent username is taken elsewhere', async () => {
  const s = fakeApp({ agentConflict: true });
  await assert.rejects(seedAppExtras({ client: s.client, ids: IDS, tokens: { pm: 'tok-pm' }, projectKey: 'MOB' }), (e) => e instanceof SeedRefusal && /release-bot/.test(e.message));
  assert.deepEqual(appWrites(s).map((c) => c.path), ['/admin/agents']); // 실패한 생성 요청 하나뿐
});

const runApp = (s) => runAppExtrasOnly({ client: s.client, slug: 'nuri-demo', password: PASS, people: CAST, projectKey: 'MOB' });

test('runAppExtrasOnly logs in only seoyeon, once, before the first write', async () => {
  const s = fakeApp();
  await runApp(s);
  const logins = s.calls.map((c, i) => [c, i]).filter(([c]) => c.path === '/auth/login');
  assert.deepEqual(logins.map(([c]) => c.user), ['seoyeon@example.com']);
  assert.ok(logins[0][1] < s.calls.findIndex(isWrite));
  // 쓰기 전 조회(inspectAppExtras)는 한 번만 한다 — 노트 스페이스 목록 조회 횟수로 본다.
  assert.equal(s.calls.filter((c) => c.method === 'GET' && c.path === '/wiki/spaces').length, 1);
});

test('runAppExtrasOnly stops with nothing written on an already-filled or unseeded tenant', async () => {
  for (const s of [fakeApp({ present: ['role'] }), fakeApp({ missing: ['channel'] })]) {
    await assert.rejects(runApp(s), SeedRefusal);
    assert.equal(appWrites(s).length, 0);
    assert.equal(s.calls.filter((c) => c.method === 'UPLOAD').length, 0);
  }
});

// ── 04장 AI 장면 사전 데이터(--ai-run, WP-1197) ───────────────────────────────

const human = (id) => ({ id, kind: 'HUMAN' });
const issueRow = (number, extra = {}) => ({ id: 100 + number, number, title: `이슈 ${number}`, status: 'TODO', type: { code: 'TASK' }, assignees: [human(2)], ...extra });

test('pickBotIssues skips epics, finished, scene-used titles, unassigned and AI-assigned issues and takes the lowest numbers', () => {
  const issues = [
    issueRow(1, { type: { code: 'EPIC' } }),
    issueRow(4, { title: APP_EXTRAS.versionIssues[0] }),
    issueRow(8, { title: SCENE_ISSUES.picker.title }),
    issueRow(9, { status: 'DONE' }),
    issueRow(10, { assignees: [] }),
    issueRow(11, { assignees: [human(2), { id: 6, kind: 'AGENT' }] }),
    issueRow(13),
    issueRow(12),
    issueRow(16, { title: AI_RUN.issue.title }),
    issueRow(15, { title: EXTRAS.overdue }),
    issueRow(17),
  ];
  assert.deepEqual(pickBotIssues(issues).map((i) => i.number), [12, 13]);
});

test('judgeGenie reports done, failed or pending from the agent work row and genie comments', () => {
  const detail = (state) => ({ status: 'IN_PROGRESS', agentWork: state ? [{ worker: { id: 6 }, state }] : [] });
  const one = [{ authorId: 6 }];
  assert.equal(judgeGenie({ detail: detail('REVIEW'), comments: [], genieId: 6 }).verdict, 'done');
  assert.equal(judgeGenie({ detail: detail('COMPLETED'), comments: [], genieId: 6 }).verdict, 'done');
  assert.equal(judgeGenie({ detail: detail('WORKING'), comments: [...one, ...one], genieId: 6 }).verdict, 'done'); // 착수·결과 코멘트
  assert.equal(judgeGenie({ detail: detail('FAILED'), comments: one, genieId: 6 }).verdict, 'failed');
  assert.equal(judgeGenie({ detail: detail('WORKING'), comments: one, genieId: 6 }).verdict, 'pending');
  assert.match(judgeGenie({ detail: detail(null), comments: [], genieId: 6 }).summary, /지니 작업 없음/);
});

/**
 * --ai-run 가짜 서버. genieStates 는 폴링할 때마다 차례로 돌려줄 지니 작업 상태(끝나면 마지막 값을 유지).
 * present: 'issue'(지니 이슈가 이미 있음)·'bot'(release-bot 이 이미 담당)·'noGenie'(지니 없음).
 */
function fakeAi({ genieStates = ['WORKING', 'REVIEW'], present = [], botMember = false } = {}) {
  const calls = [];
  let unread = 3;
  let poll = 0;
  const GENIE = 6;
  const BOT = 8;
  const issues = [
    issueRow(1, { type: { code: 'EPIC' } }),
    issueRow(7, { title: SCENE_ISSUES.bug.title }),
    issueRow(9, { assignees: [human(3)] }),
    issueRow(10, { assignees: [human(1)] }),
    issueRow(11, present.includes('bot') ? { assignees: [human(2), { id: BOT, kind: 'AGENT' }] } : {}),
    ...(present.includes('issue') ? [issueRow(16, { title: AI_RUN.issue.title })] : []),
  ];
  const call = async (token, method, path, body, { allow = [] } = {}) => {
    calls.push({ token, method, path, body, user: body?.username });
    if (path === '/auth/login') {
      return { accessToken: jwt({ sub: body.username, tenant: 7 }), memberships: [{ tenantId: 7, tenantName: '누리커머스', tenantSlug: 'nuri-demo' }] };
    }
    if (path === '/admin/agents') {
      return [...(present.includes('noGenie') ? [] : [{ id: GENIE, username: 'genie' }]), { id: BOT, username: 'release-bot' }];
    }
    if (path.startsWith('/projects/MOB/issues?')) return { items: issues, nextCursor: null, hasMore: false };
    if (path === '/users/me') return { id: 3 };
    if (path === '/notifications/unread-count') return { count: unread };
    if (method === 'GET' && path === '/projects/MOB/members') return [{ userId: GENIE }, { userId: 3 }, ...(botMember ? [{ userId: BOT }] : [])];
    if (method === 'POST' && path === '/projects/MOB/members') return { userId: body.userId };
    if (path === '/projects/MOB/types') return [{ code: 'TASK', typeId: 3 }];
    if (method === 'POST' && path === '/projects/MOB/issues') return { id: 216, number: 16 };
    if (method === 'PUT' && path.endsWith('/assignees')) return [];
    if (method === 'GET' && path === '/projects/MOB/issues/16') {
      const state = genieStates[Math.min(poll++, genieStates.length - 1)];
      return { summary: { status: 'IN_PROGRESS', agentWork: [{ worker: { id: GENIE }, state }] }, comments: [] }; // 실제 상세 응답 모양
    }
    if (method === 'GET' && path === '/issues/216/comments') return [];
    throw new Error(`fake: unexpected ${method} ${path}`);
  };
  return { calls, client: { call, login: () => assert.fail('plain login must not be used') } };
}

const runAi = (s, opts = {}) =>
  runAiRun({ client: s.client, slug: 'nuri-demo', password: PASS, people: CAST, projectKey: 'MOB', sleep: async () => {}, pollMs: 0, ...opts });

test('runAiRun logs in seoyeon and jimin once before writing, keeps human assignees and waits for genie', async () => {
  const s = fakeAi();
  const lines = [];
  const r = await runAi(s, { log: (l) => lines.push(l) });
  const firstWrite = s.calls.findIndex(isWrite);
  const logins = s.calls.map((c, i) => [c, i]).filter(([c]) => c.path === '/auth/login');
  assert.deepEqual(logins.map(([c]) => c.user), ['seoyeon@example.com', 'jimin@example.com']);
  assert.ok(logins.every(([, i]) => i < firstWrite));
  const admin = jwt({ sub: 'seoyeon@example.com', tenant: 7 }); // 가짜 서버가 김서연에게 주는 토큰
  // release-bot: 김서연 토큰으로, 고른 두 건(9·10)에 사람 담당 + release-bot
  const botPuts = s.calls.filter((c) => c.method === 'PUT' && c.body.userIds.includes(8));
  assert.deepEqual(botPuts.map((c) => [c.path, c.body.userIds]), [
    ['/projects/MOB/issues/9/assignees', [3, 8]],
    ['/projects/MOB/issues/10/assignees', [1, 8]],
  ]);
  assert.ok(botPuts.every((c) => c.token === admin));
  // 담당자는 멤버만 — release-bot 을 김서연이 먼저 MOB 멤버로 넣는다(담당 지정보다 앞)
  const addMember = s.calls.findIndex((c) => c.method === 'POST' && c.path === '/projects/MOB/members');
  assert.deepEqual(s.calls[addMember].body, { userId: 8, role: 'MEMBER' });
  assert.equal(s.calls[addMember].token, admin);
  assert.ok(addMember < s.calls.indexOf(botPuts[0]));
  // 지니 이슈: 박지민 토큰으로 만들고(담당 박지민), 박지민·지니로 담당 교체
  const create = s.calls.find((c) => c.method === 'POST' && c.path === '/projects/MOB/issues');
  assert.notEqual(create.token, admin);
  assert.deepEqual(create.body.assigneeIds, [3]);
  assert.equal(create.body.title, AI_RUN.issue.title);
  const genieAssign = s.calls.find((c) => c.path === '/projects/MOB/issues/16/assignees');
  assert.deepEqual(genieAssign.body.userIds, [3, 6]);
  assert.equal(genieAssign.token, create.token);
  assert.equal(r.issueKey, 'MOB-16');
  assert.match(r.status, /REVIEW/);
  assert.ok(lines.some((l) => /알림\(전\): 3/.test(l)) && lines.some((l) => /알림\(후\): 3/.test(l)));
});

test('runAiRun stops with nothing written when the data is already there or genie is missing', async () => {
  for (const marker of ['issue', 'bot', 'noGenie']) {
    const s = fakeAi({ present: [marker] });
    await assert.rejects(runAi(s), SeedRefusal, marker);
    assert.equal(s.calls.filter(isWrite).length, 0, marker);
  }
});

test('runAiRun does not retry when genie fails or the wait runs out', async () => {
  const failed = fakeAi({ genieStates: ['WORKING', 'FAILED'] });
  await assert.rejects(runAi(failed), (e) => !(e instanceof SeedRefusal) && /실패했습니다/.test(e.message) && /다시 시도하지 않습니다/.test(e.message));
  const slow = fakeAi({ genieStates: ['WORKING'] });
  await assert.rejects(runAi(slow, { waitMs: 0 }), /시간 안에 끝나지 않았습니다/);
  for (const s of [failed, slow]) {
    assert.equal(s.calls.filter((c) => c.method === 'POST' && c.path === '/projects/MOB/issues').length, 1); // 이슈·지니 맡기기는 한 번뿐
    assert.equal(s.calls.filter((c) => c.path === '/projects/MOB/issues/16/assignees').length, 1);
  }
});

test('runAiRun does not add release-bot to the project again when it is already a member', async () => {
  const s = fakeAi({ botMember: true });
  await runAi(s);
  assert.equal(s.calls.filter((c) => c.method === 'POST' && c.path === '/projects/MOB/members').length, 0);
});

test('parseWaitMs accepts an empty value or a positive integer and rejects anything else', () => {
  assert.deepEqual(parseWaitMs(undefined), { ok: true, value: undefined });
  assert.deepEqual(parseWaitMs(''), { ok: true, value: undefined });
  assert.deepEqual(parseWaitMs('60000'), { ok: true, value: 60000 });
  for (const bad of ['abc', '15m', '-1', '0', '1.5', '1e3', 'NaN']) assert.equal(parseWaitMs(bad).ok, false, bad);
});
