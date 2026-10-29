// 사용자 매뉴얼 촬영 테넌트 시드(seed-user.mjs)의 가드와 진행 순서(WP-1194).
// 시드는 운영(genia-works.iacloud.kr)의 이미 만든 테넌트에 돌므로, 잘못 겨누면 실제 테넌트에 가상 데이터가 섞인다.
// 진행(runManualSeed)은 client·단계 함수를 주입받게 해 네트워크 없이 시험한다.
import { isLocalHost } from './operator-seed.mjs';

/** 테넌트를 처음부터 다시 만드는 방법 — 가드가 멈출 때 함께 알린다(README 「사용자 매뉴얼 촬영 테넌트」). */
export const RESET_HINT =
  '다시 채우려면 운영자 콘솔에서 테넌트를 삭제 → 영구 삭제한 뒤, 같은 slug 로 테넌트와 소유자를 다시 만들고 시드를 다시 돌립니다' +
  '(이미 있는 계정은 「기존 사용자 추가」로 넣습니다 — docs/manual/README.md 「사용자 매뉴얼 촬영 테넌트」).';

/** 쓰기 전에 멈춘다 — 이 오류가 나면 시드는 아무것도 쓰지 않았다(로그인·조회만 했다). */
export class SeedRefusal extends Error {}

/**
 * 대상 서버 가드(a) — 쓰기 전에, 네트워크 없이 판정한다(결과는 사용법 오류 exit 2 로 쓰인다).
 * 주소는 서버 루트여야 한다(경로를 붙이면 `/api/v1` 이 겹친다). localhost 가 아니면(운영 등) https 여야 하고,
 * MANUAL_SEED_CONFIRM 이 MANUAL_TENANT_SLUG 와 같아야 한다 — 겨눈 테넌트를 손으로 한 번 더 적게 한다.
 * @returns {{ ok: true, base: string, local: boolean } | { ok: false, reason: string }} base 는 URL origin
 */
export function checkManualTarget({ api, slug, confirm }) {
  let u;
  try {
    u = new URL(api);
  } catch {
    return { ok: false, reason: `MANUAL_API 가 올바른 주소가 아닙니다: ${api}` };
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { ok: false, reason: `MANUAL_API 는 http(s) 주소여야 합니다: ${api}` };
  }
  if (u.pathname !== '/' || u.search || u.hash) {
    return { ok: false, reason: `MANUAL_API 는 서버 루트 주소만 받습니다(경로 없이, 예: https://genia-works.iacloud.kr): ${api}` };
  }
  if (!slug) return { ok: false, reason: 'MANUAL_TENANT_SLUG 가 비었습니다.' };
  const local = isLocalHost(u);
  if (!local) {
    if (u.protocol !== 'https:') {
      return { ok: false, reason: `localhost 가 아닌 서버는 https 로만 붙습니다(인증서 검증 그대로): ${u.origin}` };
    }
    if (confirm !== slug) {
      return {
        ok: false,
        reason: `localhost 가 아닌 서버(${u.host})에 쓰려면 MANUAL_SEED_CONFIRM 을 MANUAL_TENANT_SLUG 와 같은 값으로 줍니다.`,
      };
    }
  }
  return { ok: true, base: u.origin, local };
}

/** access 토큰(JWT)의 현재 테넌트 클레임(`tenant`). 테넌트를 고르기 전 토큰이거나 형식이 아니면 null. 서명은 서버가 확인한다. */
function tokenTenantId(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return claims.tenant == null ? null : Number(claims.tenant);
  } catch {
    return null;
  }
}

/**
 * 테넌트 가드(b) — slug 의 테넌트로 로그인한다: 비밀번호 로그인 한 번 → 소속에서 slug 고르기 → 토큰이 그 테넌트가 아니면 테넌트 선택
 * → 토큰의 현재 테넌트 확인. 소속이 여럿인 계정은 로그인 토큰에 테넌트가 없거나 다른 테넌트라, 고르지 않으면 콘텐츠 단계 중간에 실패한다.
 * 로그인은 한 번만 시도한다(틀린 비밀번호로 되풀이하면 운영 계정 잠금에 걸린다). 실패는 SeedRefusal 로 던진다.
 * @returns {Promise<{ token: string, membership: { tenantId: number, tenantName: string, tenantSlug: string } }>}
 */
export async function loginIntoSlug(client, { username, password, slug }) {
  const res = await client.call(null, 'POST', '/auth/login', { username, password }, { allow: [401, 403, 423] });
  if (!res) throw new SeedRefusal(`${username} 로그인 실패 — MANUAL_PASS 나 계정 상태를 확인합니다(한 번만 시도했습니다).`);
  const membership = (res.memberships ?? []).find((m) => m.tenantSlug === slug);
  if (!membership) throw new SeedRefusal(`${username} 계정이 테넌트 ${slug} 의 구성원이 아닙니다.`);
  const want = Number(membership.tenantId);
  let token = res.accessToken;
  if (tokenTenantId(token) !== want) {
    token = (await client.call(token, 'POST', '/auth/select-tenant', { tenantId: membership.tenantId })).accessToken;
  }
  const current = tokenTenantId(token);
  if (current !== want) {
    throw new SeedRefusal(`${username} 토큰의 현재 테넌트(${current ?? '없음'})가 ${slug}(${want}) 가 아닙니다.`);
  }
  return { token, membership };
}

/**
 * 빈 테넌트 가드(c) — 콘텐츠를 넣기 전 상태인지 본다. 아니면 SeedRefusal.
 * - 프로젝트(MOB)가 있으면 이미 채운 테넌트다 — 콘텐츠 단계는 멱등이 아니므로 멈춘다.
 * - 사람 구성원은 소유자와, 등장인물(people) 중 이미 있는 계정뿐이어야 한다. 다른 사람이 있으면 실제로 쓰는 테넌트일 수 있어 멈춘다.
 *   (영구 삭제는 사람 계정을 지우지 않아, 다시 만든 테넌트에는 등장인물을 「기존 사용자 추가」로 넣는다 — 그 사람들은 만들지 않고 그대로 쓴다.)
 * - 시드 에이전트는 있어도 된다 — 앞선 실행이 계정 단계에서 멈춘 경우라 그대로 이어 쓴다.
 * @param {{ owner: string, people: {key: string, username: string}[], humans: {id: number, username: string}[],
 *   humansTotal: number, projectExists: boolean, projectKey: string }} s
 * @returns {Record<string, number>} 이미 구성원인 등장인물(소유자 제외)의 key → 사용자 id
 */
export function checkFreshTenant(s) {
  const refuse = (why) => new SeedRefusal(`빈 테넌트가 아닙니다 — ${why}. ${RESET_HINT}`);
  if (s.projectExists) throw refuse(`프로젝트 ${s.projectKey} 가 이미 있습니다`);
  // 한 쪽(최대 100명)에 다 담기지 않았으면 판정할 수 없다 — 그만큼 사람이 있으면 빈 테넌트도 아니다.
  if (s.humansTotal > s.humans.length) throw refuse(`구성원이 ${s.humansTotal}명입니다`);
  const owner = s.owner.toLowerCase();
  const byUsername = new Map(s.people.map((p) => [p.username.toLowerCase(), p]));
  const strangers = s.humans.filter((h) => !byUsername.has(h.username.toLowerCase()));
  if (strangers.length) throw refuse(`등장인물이 아닌 구성원이 있습니다(${strangers.length}명)`);
  if (!s.humans.some((h) => h.username.toLowerCase() === owner)) throw refuse('소유자 계정이 구성원 목록에 없습니다');
  const existingIds = {};
  for (const h of s.humans) {
    if (h.username.toLowerCase() !== owner) existingIds[byUsername.get(h.username.toLowerCase()).key] = h.id;
  }
  return existingIds;
}

/**
 * 쓰기 전 준비 — 로그인과 조회만 한다. 소유자를 slug 테넌트로 로그인하고(b), 빈 테넌트인지 보고(c),
 * 이미 구성원인 등장인물을 한 사람씩 한 번만 로그인해 둔다. 어느 하나라도 실패하면 SeedRefusal(쓴 것 없음).
 * @returns {Promise<{ admin: string, membership: object, existing: Record<string, { id: number, token: string }> }>}
 */
export async function prepareManualSeed({ client, slug, password, people, projectKey }) {
  const [owner] = people;
  const { token: admin, membership } = await loginIntoSlug(client, { username: owner.username, password, slug });
  const humans = await client.call(admin, 'GET', '/users?kind=HUMAN&size=100');
  // 프로젝트는 404 만 「없음」으로 본다(그 밖의 실패는 던져 멈춘다).
  const project = await client.call(admin, 'GET', `/projects/${projectKey}`, undefined, { allow: [404] });
  const existingIds = checkFreshTenant({
    owner: owner.username,
    people,
    humans: humans.content,
    humansTotal: humans.totalElements,
    projectExists: project !== null,
    projectKey,
  });
  const existing = {};
  for (const p of people.slice(1)) {
    if (existingIds[p.key] == null) continue;
    const { token } = await loginIntoSlug(client, { username: p.username, password, slug });
    existing[p.key] = { id: existingIds[p.key], token };
  }
  return { admin, membership, existing };
}

/**
 * 매뉴얼 테넌트 시드의 진행 순서. steps 는 소개 자료 시드의 ensureAgent·createPeople·seedContent(시험에서는 가짜).
 * 1) 준비(로그인·조회만) → 2) 에이전트(이름 충돌이 가장 흔한 곳이라 계정보다 먼저 — 409 면 쓴 것 없음) → 3) 계정 → 4) 콘텐츠.
 * 아이디·이메일이 서버에 이미 있는지 테넌트 관리자가 미리 알아볼 API 는 없다(조회는 플랫폼 운영자 전용) — 그래서 순서와 안내로 줄인다.
 * 쓰기 전에 멈추면 SeedRefusal, 쓴 뒤에 실패하면 이미 쓴 것을 적은 Error 를 던진다.
 */
export async function runManualSeed({ client, slug, password, people, agent, projectKey, steps, log = () => {} }) {
  const { admin, membership, existing } = await prepareManualSeed({ client, slug, password, people, projectKey });
  log(`테넌트 ${membership.tenantName}(${slug}) 에 시드를 넣습니다.`);

  let agentId;
  let createdAgent;
  try {
    ({ id: agentId, created: createdAgent } = await steps.ensureAgent({ client, admin }));
  } catch (e) {
    if (e.status === 409) {
      throw new SeedRefusal(
        `에이전트 아이디 ${agent.username} 또는 이메일 ${agent.email} 이 다른 테넌트에 이미 있습니다(아이디는 서버 전체에서 하나). ` +
          `시드의 에이전트 아이디를 바꿔야 합니다 — 초기화로는 풀리지 않습니다. (${e.message})`,
      );
    }
    throw new Error(`에이전트 단계 실패 — 에이전트가 만들어졌을 수 있습니다(다시 돌리면 이어 씁니다): ${e.message}`);
  }

  const signIn = async (username) => (await loginIntoSlug(client, { username, password, slug })).token;
  let accounts;
  try {
    accounts = await steps.createPeople({ client, admin, password, existing, signIn });
  } catch (e) {
    // 이번 실행에서 쓴 것을 그대로 알린다 — 「쓴 것 없음」을 거짓으로 말하지 않게.
    const written = [...(createdAgent ? [`에이전트 ${agent.username}`] : []), ...(e.created ?? []).map((u) => `계정 ${u}`)];
    const note = written.length
      ? `이번 실행에서 이미 쓴 것: ${written.join(', ')}. 다시 돌리면 이미 만든 계정·에이전트는 건너뛰고 이어서 합니다.`
      : '이번 실행에서 쓴 것은 없습니다.';
    if (e.status === 409 && e.username) {
      // 넣어야 할 계정은 실패한 사람과, 그 뒤에 만들 차례였던 사람(아직 확인 못 함) 중 구성원이 아닌 사람뿐이다.
      const others = people.slice(1);
      const later = others
        .slice(others.findIndex((p) => p.username === e.username) + 1)
        .filter((p) => !existing[p.key])
        .map((p) => p.username);
      throw new Error(
        `계정 ${e.username} 이 서버에 이미 있습니다(아이디는 서버 전체에서 하나 — 영구 삭제도 사람 계정은 남깁니다). ` +
          `운영자 콘솔에서 이 테넌트에 「기존 사용자 추가」(일반 구성원)로 넣고 다시 돌립니다: ${e.username}` +
          (later.length ? ` (뒤에 만들 차례였던 ${later.join(', ')} 도 이미 있으면 함께 넣습니다)` : '') +
          `. ${note}`,
      );
    }
    throw new Error(`계정 단계 실패: ${e.message} ${note}`);
  }
  const reused = Object.keys(existing).length;
  log(`등장인물 ${people.length}명 준비(새로 만듦 ${people.length - 1 - reused}, 기존 계정 ${reused})`);

  try {
    return await steps.seedContent({ client, admin, ids: { ...accounts.ids, agent: agentId }, tokens: accounts.tokens });
  } catch (e) {
    throw new Error(`콘텐츠 단계 실패 — 일부 콘텐츠가 남았을 수 있습니다: ${e.message} ${RESET_HINT}`);
  }
}
