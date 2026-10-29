// 사용자 매뉴얼 촬영 테넌트 시드의 쓰기 전 가드와 진행 순서 시험 — 대상 서버·테넌트 로그인·빈 테넌트·쓰기 순서(WP-1194).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeople, PEOPLE as CAST } from '../../intro/scripts/seed-demo.mjs';
import { isLocalHost } from './lib/operator-seed.mjs';
import { checkFreshTenant, checkManualTarget, loginIntoSlug, RESET_HINT, runManualSeed, SeedRefusal } from './lib/user-seed.mjs';

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
function fakeServer({ accounts, humans = [], conflicts = [], projectExists = false, selectTenantTo }) {
  const calls = [];
  const SLUGS = { 7: 'nuri-demo', 8: 'other' };
  let nextId = 100;
  const fail = (method, path, status) => {
    throw Object.assign(new Error(`${method} ${path} → ${status} {}`), { status, body: '{}' });
  };
  const call = async (token, method, path, body, { allow = [] } = {}) => {
    calls.push({ method, path, user: body?.username });
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
  assert.deepEqual(log, ['agent', 'content']);
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
