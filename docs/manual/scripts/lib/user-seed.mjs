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
 * 1) 준비(로그인·조회만) → 2) 에이전트(이름 충돌이 가장 흔한 곳이라 계정보다 먼저 — 409 면 쓴 것 없음) → 3) 계정 → 4) 콘텐츠
 * → 5) 매뉴얼 홈 장면 보강(steps.seedManualExtras, 없으면 seedManualExtras)
 * → 6) 매뉴얼 05·07장 대화·캘린더 보강(steps.seedChatCalendarExtras, 없으면 seedChatCalendarExtras).
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

  let out;
  try {
    out = await steps.seedContent({ client, admin, ids: { ...accounts.ids, agent: agentId }, tokens: accounts.tokens });
  } catch (e) {
    throw new Error(`콘텐츠 단계 실패 — 일부 콘텐츠가 남았을 수 있습니다: ${e.message} ${RESET_HINT}`);
  }
  // 5) 매뉴얼 홈 장면용 보강(오늘 마감·마감 지남·멘션) — 소개 자료 데이터에는 없는 매뉴얼 전용 항목.
  const seedExtras = steps.seedManualExtras ?? seedManualExtras;
  try {
    out.extras = await seedExtras({ client, ids: accounts.ids, tokens: accounts.tokens, projectKey });
  } catch (e) {
    throw new Error(
      `보강 단계 실패 — 콘텐츠는 들어갔습니다. 보강 이슈(${Object.values(EXTRAS).join(', ')})가 하나도 없으면 --extras-only 로 다시 넣고, ` +
        `일부만 있으면 확인해 지운 뒤 다시 넣습니다: ${e.message}`,
    );
  }
  // 6) 매뉴얼 05 대화·07 캘린더 장면용 보강(DM·스레드 답글·반응·응답 전 초대·태그).
  const seedChatCal = steps.seedChatCalendarExtras ?? seedChatCalendarExtras;
  try {
    out.chatCalendar = await seedChatCal({ client, ids: accounts.ids, tokens: accounts.tokens });
  } catch (e) {
    throw new Error(
      `대화·캘린더 보강 실패 — 콘텐츠·홈 보강은 들어갔습니다. 대화·캘린더 보강이 하나도 없으면 --chat-calendar-extras 로 다시 넣고, ` +
        `일부만 있으면 확인해 지운 뒤 다시 넣습니다: ${e.message}`,
    );
  }
  return out;
}

// ── 매뉴얼 홈 장면용 보강(WP-1196) ─────────────────────────────────────────────
// 홈 「요약」·「지금 신경 쓸 일」은 김서연에게 맡긴 이슈 중 마감이 오늘이거나 지난 것(완료·취소 제외, GET /me/issues?assignee=me)과
// 안 읽은 코멘트 멘션 알림(ISSUE_COMMENT_MENTION)으로 채워진다(web: computeSynthesisCounts·buildAttentionRows).
// 소개 자료 시드에는 그런 항목이 없어 홈이 「다 확인했습니다」로 비므로, 매뉴얼 테넌트에만 최소한으로 더한다.

/** 보강 이슈 제목 — 이미 넣었는지 알아보는 표식이기도 하다(둘 중 하나라도 있으면 다시 넣지 않는다). */
export const EXTRAS = {
  dueToday: '베타 오픈 Go/No-Go 체크리스트 확정',
  overdue: '페이링크 결제 연동 계약서 검토 회신',
};

/**
 * 오늘 기준 상대 날짜(yyyy-MM-dd, 한국 시간). 홈의 「오늘」은 보는 사람의 로컬 날짜라, UTC 날짜를 쓰면 아침 9시 전에 하루 어긋난다.
 * @param {number} offset 오늘로부터 며칠
 */
export function kstDay(offset, now = new Date()) {
  const d = new Date(now.getTime() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

/** 프로젝트 이슈 제목 전부(커서 페이지를 끝까지 넘긴다). */
async function issueTitles(client, token, projectKey) {
  const titles = [];
  let cursor = null;
  do {
    const q = `size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await client.call(token, 'GET', `/projects/${projectKey}/issues?${q}`);
    titles.push(...page.items.map((i) => i.title));
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor);
  return titles;
}

/**
 * 보강 데이터를 넣는다 — 김서연 담당 이슈 둘(오늘 마감·진행 중, 이틀 전 마감·할 일)과, 이준호가 오늘 마감 이슈에 김서연을 멘션한 코멘트.
 * 멘션은 웹 편집기가 만드는 본문 토큰 `<@사용자id>` 그대로 쓴다(서버 MentionParser 가 읽어 멘션 알림을 만든다).
 * tokens.pm 은 김서연(관리자), tokens.dev 는 이준호의 테넌트 토큰, ids.pm 은 김서연 id 다.
 * @returns {Promise<{ dueToday: number, overdue: number }>} 만든 이슈 번호
 */
export async function seedManualExtras({ client, ids, tokens, projectKey, now = new Date() }) {
  const { call } = client;
  const admin = tokens.pm;
  const types = await call(admin, 'GET', `/projects/${projectKey}/types`);
  const task = types.find((t) => (t.code ?? t.key ?? t.name)?.toUpperCase() === 'TASK');
  const create = (fields) =>
    call(admin, 'POST', `/projects/${projectKey}/issues`, { assigneeIds: [ids.pm], typeId: task.typeId ?? task.id, ...fields });
  // 오늘 마감 — 「오늘 마감」 칸과 「지금 신경 쓸 일」의 오늘 마감 줄. 생성 API 는 상태를 받지 않아 만든 뒤 진행 중으로 옮긴다.
  const today = await create({
    title: EXTRAS.dueToday,
    body: '베타 오픈 판단 회의 전에 출시 체크리스트 항목별 담당·완료 여부를 확정한다.',
    priority: 'HIGH',
    startDate: kstDay(-3, now),
    dueDate: kstDay(0, now),
    parentNumber: 1,
  });
  await call(admin, 'PATCH', `/projects/${projectKey}/issues/${today.number}/status`, { status: 'IN_PROGRESS' });
  // 마감 지남 — 「지금 신경 쓸 일」의 마감 지남 줄(아직 할 일).
  const overdue = await create({
    title: EXTRAS.overdue,
    body: '페이링크가 보낸 결제 연동 계약서 초안을 검토해 수정 의견을 회신한다.',
    priority: 'MID',
    startDate: kstDay(-7, now),
    dueDate: kstDay(-2, now),
    parentNumber: 2,
  });
  // 멘션 — 「멘션」 칸과 「지금 신경 쓸 일」의 멘션 줄(안 읽은 코멘트 멘션 알림).
  await call(tokens.dev, 'POST', `/issues/${today.id}/comments`, {
    body: `<@${ids.pm}> 체크리스트에 iOS 17 수량 버그(MOB-7) 수정 빌드 확인 항목도 넣어 주세요. 오늘 오후에 빌드 드릴게요.`,
  });
  return { dueToday: today.number, overdue: overdue.number };
}

/**
 * 보강만 넣기(--extras-only) 전 준비 — 로그인과 조회만 한다. 이미 채운 테넌트(프로젝트 MOB 있음)여야 하고, 보강 이슈가 하나도 없어야 한다.
 * 필요한 계정(김서연·이준호)만 한 번씩 slug 테넌트로 로그인한다. 어느 하나라도 실패하면 SeedRefusal(쓴 것 없음).
 */
export async function prepareExtrasOnly({ client, slug, password, people, projectKey }) {
  const owner = people[0];
  const dev = people.find((p) => p.key === 'dev');
  const { token: admin, membership } = await loginIntoSlug(client, { username: owner.username, password, slug });
  const project = await client.call(admin, 'GET', `/projects/${projectKey}`, undefined, { allow: [404] });
  if (project === null) throw new SeedRefusal(`프로젝트 ${projectKey} 가 없습니다 — 보강은 이미 채운 테넌트에만 넣습니다(먼저 전체 시드를 돌립니다).`);
  const titles = await issueTitles(client, admin, projectKey);
  const present = Object.values(EXTRAS).filter((t) => titles.includes(t));
  if (present.length) throw new SeedRefusal(`보강 이슈가 이미 있습니다: ${present.join(', ')}`);
  const me = await client.call(admin, 'GET', '/users/me');
  const { token: devToken } = await loginIntoSlug(client, { username: dev.username, password, slug });
  return { membership, ids: { pm: me.id }, tokens: { pm: admin, dev: devToken } };
}

/** 이미 채운 테넌트에 보강만 넣는다(--extras-only). 쓰기 전에 멈추면 SeedRefusal, 쓴 뒤 실패하면 손으로 확인할 것을 적은 Error. */
export async function runExtrasOnly({ client, slug, password, people, projectKey, seedExtras = seedManualExtras, log = () => {} }) {
  const { membership, ids, tokens } = await prepareExtrasOnly({ client, slug, password, people, projectKey });
  log(`테넌트 ${membership.tenantName}(${slug}) 에 홈 장면 보강을 넣습니다.`);
  try {
    return await seedExtras({ client, ids, tokens, projectKey });
  } catch (e) {
    throw new Error(`보강 단계 실패 — 보강 이슈 일부가 들어갔을 수 있습니다(${Object.values(EXTRAS).join(', ')}). 확인해 지운 뒤 다시 돌립니다: ${e.message}`);
  }
}

// ── 매뉴얼 05 대화·07 캘린더 장면용 보강(WP-1196) ────────────────────────────────
// 소개 자료 데이터에는 DM·김서연 메시지의 스레드 답글·이모지 반응·응답 전 초대·태그가 없어 05·07장의 몇 장면이 비었다.
// 각 사람의 토큰으로 쓴다(서버가 작성자·반응한 사람·주최자를 토큰에서 정한다). 일정 초대는 example.com 가상 인물의 앱 안 일정이라
// 메일이 나가지 않는다 — 초대 메일은 외부(M365) 쓰기 캘린더에서만 공급자가 보내고, 서버에는 메일 발송기가 없다. 앱 안 초대 알림도 끈다(notify=false).

/** 대화·캘린더 보강의 내용 — 이미 넣었는지 알아보는 표식도 여기서 나온다. */
export const CHAT_CAL = {
  channel: '모바일-주문앱',
  /** 이준호 → 김서연 DM. who 는 PEOPLE key. 김서연은 답장하며 그때까지 읽고, 마지막 한 건만 안 읽음으로 남는다. */
  dm: [
    { who: 'dev', body: '서연님, MOB-7 수정 빌드 올렸습니다. iOS 17.5 기기에서 재주문 한 번만 확인 부탁드려요.' },
    { who: 'pm', body: '확인했어요. 재주문 뒤 수량이 정상으로 보여요. QA 쪽에도 공유해 둘게요.' },
    { who: 'dev', body: '감사합니다! 회귀 체크리스트(MOB-13)에 이 케이스도 넣어 두었습니다.' },
  ],
  /** 김서연이 채널에 쓴 메시지(본문 앞부분으로 찾는다)에 다른 사람이 단 스레드 답글 — 김서연에게 안 읽음으로 남는다. */
  threadRoot: '이번 주 목표는 재주문 베타 빌드입니다',
  threadReplies: [
    { who: 'design', body: '재주문 버튼 시안은 오늘 최종본으로 고정했어요. 베타 빌드에 그대로 들어갑니다.' },
    { who: 'qa', body: '베타 빌드 나오면 재주문 회귀 테스트(MOB-13)부터 돌리겠습니다.' },
  ],
  /** 이모지 반응을 받을 채널 메시지(박지민의 시안 공유)와 반응한 사람. */
  reactTarget: '재주문 버튼 최종 시안 올렸습니다',
  reactions: [
    { who: 'dev', emoji: '👍' },
    { who: 'qa', emoji: '👍' },
    { who: 'mkt', emoji: '🎉' },
  ],
  /** 이준호가 주최하고 김서연·박지민을 초대한 일정(김서연 응답 전). 날짜는 넣는 날(한국 시간)의 다음 날 오후. */
  invite: { title: '포인트 결제 UI 구현 범위 논의', offset: 1, from: 14, to: 15, location: '회의실 B', attendees: ['pm', 'design'] },
  /** 김서연의 태그와 그 태그를 붙일 김서연 일정(제목이 같은 것 모두). */
  tags: [
    { name: '출시', color: null, events: ['베타 오픈 Go/No-Go'] },
    { name: '스프린트', color: null, events: ['스프린트 7 데일리'] },
  ],
};

/** 한국 시간 일시(ISO, +09:00). */
function kstAt(offset, hour, now) {
  return `${kstDay(offset, now)}T${String(hour).padStart(2, '0')}:00:00+09:00`;
}

/** 일정 표식·태그를 찾을 범위 — 소개 자료 일정(시드한 날 ±며칠)과 초대 일정이 넉넉히 들어간다. */
function eventRange(now) {
  return `from=${encodeURIComponent(kstAt(-60, 0, now))}&to=${encodeURIComponent(kstAt(60, 0, now))}`;
}

/** 채널의 최상위 메시지 전부(커서 페이지를 끝까지). */
async function channelMessages(client, token, channelId) {
  const items = [];
  let cursor = null;
  do {
    const page = await client.call(token, 'GET', `/messaging/channels/${channelId}/messages?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...page.items);
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor);
  return items;
}

/**
 * 대화·캘린더 보강을 넣기 전 조회 — 김서연 토큰으로 대상(채널·메시지·일정)을 찾고, 이미 들어간 표식을 모은다(읽기만).
 * @returns {Promise<{ channelId: number, root: object, react: object, events: object[], present: string[] }>}
 */
export async function inspectChatCalendar({ client, admin, ids, now = new Date() }) {
  const { call } = client;
  const channels = await call(admin, 'GET', '/messaging/channels');
  const channel = (channels.content ?? channels).find((c) => c.name === CHAT_CAL.channel);
  if (!channel) throw new SeedRefusal(`채널 ${CHAT_CAL.channel} 이 없습니다 — 대화·캘린더 보강은 이미 채운 테넌트에만 넣습니다.`);
  const messages = await channelMessages(client, admin, channel.id);
  const root = messages.find((m) => m.authorId === ids.pm && m.body?.startsWith(CHAT_CAL.threadRoot));
  const react = messages.find((m) => m.body?.startsWith(CHAT_CAL.reactTarget));
  if (!root || !react) throw new SeedRefusal(`채널 ${CHAT_CAL.channel} 에서 보강할 메시지를 찾지 못했습니다(소개 자료 대화가 없습니다).`);
  const events = await call(admin, 'GET', `/calendar/events?${eventRange(now)}`);
  const tags = await call(admin, 'GET', '/calendar/tags');
  const dms = await call(admin, 'GET', '/messaging/dms');
  const present = [];
  if (dms.some((d) => d.lastMessage && d.participants.some((p) => p.userId === ids.dev))) present.push('이준호와의 DM');
  if (root.replyCount > 0) present.push('김서연 메시지의 스레드 답글');
  if ((react.reactions ?? []).length > 0) present.push('시안 메시지의 이모지 반응');
  if (events.some((e) => e.title === CHAT_CAL.invite.title)) present.push(`일정 「${CHAT_CAL.invite.title}」`);
  for (const t of CHAT_CAL.tags) if (tags.some((x) => x.name === t.name)) present.push(`태그 「${t.name}」`);
  return { channelId: channel.id, root, react, events, present };
}

/**
 * 대화·캘린더 보강을 넣는다. ids·tokens 는 등장인물 key(pm·dev·design·mkt·qa)별 사용자 id·테넌트 토큰이다.
 * 이미 하나라도 들어갔으면 쓰기 전에 SeedRefusal 로 멈춘다(전체 시드에서 불려도 같은 판정을 거친다).
 * @returns {Promise<{ dmId: number, replies: number, reactions: number, inviteId: number, tagged: number }>}
 */
export async function seedChatCalendarExtras({ client, ids, tokens, now = new Date() }) {
  const { call } = client;
  const target = await inspectChatCalendar({ client, admin: tokens.pm, ids, now });
  if (target.present.length) throw new SeedRefusal(`대화·캘린더 보강이 이미 있습니다: ${target.present.join(', ')}`);

  // 1) DM — 이준호가 열고(있으면 같은 DM), 김서연은 답장하며 거기까지 읽는다. 마지막 이준호 메시지 하나만 안 읽음으로 남는다.
  const dm = await call(tokens.dev, 'POST', '/messaging/dms', { userIds: [ids.pm] });
  for (const m of CHAT_CAL.dm) {
    const sent = await call(tokens[m.who], 'POST', `/messaging/channels/${dm.id}/messages`, { body: m.body, parentMessageId: null });
    // 내가 보낸 메시지만으로는 읽음 기준점이 잡히지 않는다(WP-256) — 김서연의 답장까지 읽음으로 둔다.
    if (m.who === 'pm') await call(tokens.pm, 'POST', `/messaging/channels/${dm.id}/read`, { uptoMessageId: sent.id });
  }
  // 2) 스레드 답글 — 김서연은 열지 않아 스레드 모아 보기에 새 답글로 남는다.
  for (const r of CHAT_CAL.threadReplies) {
    await call(tokens[r.who], 'POST', `/messaging/channels/${target.channelId}/messages`, { body: r.body, parentMessageId: target.root.id });
  }
  // 3) 이모지 반응
  for (const r of CHAT_CAL.reactions) {
    await call(tokens[r.who], 'POST', `/messaging/messages/${target.react.id}/reactions`, { emoji: r.emoji });
  }
  // 4) 응답 전 초대 — 이준호 주최, 앱 안 초대 알림은 보내지 않는다(notify=false, 김서연의 알림 수를 바꾸지 않게).
  const inv = CHAT_CAL.invite;
  const invite = await call(tokens.dev, 'POST', '/calendar/events?notify=false', {
    title: inv.title,
    startsAt: kstAt(inv.offset, inv.from, now),
    endsAt: kstAt(inv.offset, inv.to, now),
    allDay: false,
    location: inv.location,
    attendeeUserIds: inv.attendees.map((k) => ids[k]),
  });
  // 5) 태그 — 김서연이 만들어 자기 일정에 붙인다.
  let tagged = 0;
  for (const t of CHAT_CAL.tags) {
    const tag = await call(tokens.pm, 'POST', '/calendar/tags', { name: t.name, color: t.color });
    for (const e of target.events.filter((x) => t.events.includes(x.title))) {
      await call(tokens.pm, 'PUT', `/calendar/events/${e.id}/tags`, { tagIds: [tag.id] });
      tagged++;
    }
  }
  return {
    dmId: dm.id,
    replies: CHAT_CAL.threadReplies.length,
    reactions: CHAT_CAL.reactions.length,
    inviteId: invite.id,
    tagged,
  };
}

/**
 * 이미 채운 테넌트에 대화·캘린더 보강만 넣는다(--chat-calendar-extras). 쓰기 전에 등장인물 다섯 명을 slug 테넌트로 한 번씩 로그인하고
 * 대상·표식을 조회한다 — 어느 하나라도 실패하거나 이미 들어갔으면 SeedRefusal(쓴 것 없음). 쓴 뒤 실패하면 이미 쓴 것을 확인하라는 Error.
 */
export async function runChatCalendarOnly({ client, slug, password, people, seedStep = seedChatCalendarExtras, now = new Date(), log = () => {} }) {
  const tokens = {};
  let membership;
  for (const p of people) {
    const r = await loginIntoSlug(client, { username: p.username, password, slug });
    tokens[p.key] = r.token;
    membership ??= r.membership;
  }
  const humans = await client.call(tokens.pm, 'GET', '/users?kind=HUMAN&size=100');
  const ids = {};
  for (const p of people) {
    const u = humans.content.find((h) => h.username.toLowerCase() === p.username.toLowerCase());
    if (!u) throw new SeedRefusal(`${p.username} 이 테넌트 ${slug} 의 구성원이 아닙니다.`);
    ids[p.key] = u.id;
  }
  // 쓰기 전 판정을 여기서도 한 번 해 「쓴 것 없음」을 보장한다(seedStep 안의 같은 판정은 전체 시드 경로를 위한 것).
  const target = await inspectChatCalendar({ client, admin: tokens.pm, ids, now });
  if (target.present.length) throw new SeedRefusal(`대화·캘린더 보강이 이미 있습니다: ${target.present.join(', ')}`);
  log(`테넌트 ${membership.tenantName}(${slug}) 에 대화·캘린더 보강을 넣습니다.`);
  try {
    return await seedStep({ client, ids, tokens, now });
  } catch (e) {
    if (e instanceof SeedRefusal) throw e;
    throw new Error(`대화·캘린더 보강 도중 실패 — 일부(DM·스레드 답글·반응·초대 일정·태그)가 들어갔을 수 있습니다. 확인해 지운 뒤 다시 돌립니다: ${e.message}`);
  }
}
