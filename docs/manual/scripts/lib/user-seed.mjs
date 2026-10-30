// 사용자 매뉴얼 촬영 테넌트 시드(seed-user.mjs)의 가드와 진행 순서(WP-1194).
// 시드는 운영(genia-works.iacloud.kr)의 이미 만든 테넌트에 돌므로, 잘못 겨누면 실제 테넌트에 가상 데이터가 섞인다.
// 진행(runManualSeed)은 client·단계 함수를 주입받게 해 네트워크 없이 시험한다.
import { isLocalHost } from './operator-seed.mjs';
import { makePdf, makePng } from './sample-files.mjs';

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
 * → 6) 매뉴얼 05·07장 대화·캘린더 보강(steps.seedChatCalendarExtras, 없으면 seedChatCalendarExtras)
 * → 7) 매뉴얼 05~16장 앱 장면 보강(steps.seedAppExtras, 없으면 seedAppExtras).
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
  // 5)~7) 매뉴얼 전용 보강 — 앞 단계가 들어간 뒤라, 실패하면 무엇이 들어갔는지와 다시 넣는 플래그를 알린다.
  const retry = (flag) => `하나도 없으면 ${flag} 로 다시 넣고, 일부만 있으면 확인해 지운 뒤 다시 넣습니다`;
  const extraSteps = [
    // 5) 홈 장면(오늘 마감·마감 지남·멘션) — 소개 자료 데이터에는 없는 매뉴얼 전용 항목.
    {
      key: 'extras',
      fn: steps.seedManualExtras ?? seedManualExtras,
      msg: `보강 단계 실패 — 콘텐츠는 들어갔습니다. 보강 이슈(${Object.values(EXTRAS).join(', ')})가 ${retry('--extras-only')}`,
    },
    // 6) 05 대화·07 캘린더(DM·스레드 답글·반응·응답 전 초대·태그).
    {
      key: 'chatCalendar',
      fn: steps.seedChatCalendarExtras ?? seedChatCalendarExtras,
      msg: `대화·캘린더 보강 실패 — 콘텐츠·홈 보강은 들어갔습니다. 대화·캘린더 보강이 ${retry('--chat-calendar-extras')}`,
    },
    // 7) 05~16장 앱 장면(채널 드라이브·버전·첨부·노트·공유·조직도·역할·외부 에이전트).
    {
      key: 'app',
      fn: steps.seedAppExtras ?? seedAppExtras,
      msg: `앱 장면 보강 실패 — 앞 단계는 들어갔습니다. 앱 장면 보강이 ${retry('--app-extras')}`,
    },
  ];
  for (const { key, fn, msg } of extraSteps) {
    try {
      out[key] = await fn({ client, ids: accounts.ids, tokens: accounts.tokens, projectKey });
    } catch (e) {
      throw new Error(`${msg}: ${e.message}`);
    }
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

// ── 공용 조회 ─────────────────────────────────────────────────────────────────

/** cond 가 참이면 「이미 들어간 것」 목록에 label 을 더한다(보강 조회 공용). */
function markIf(present, cond, label) {
  if (cond) present.push(label);
}

/**
 * 이미 채운 테넌트에 보강 하나만 넣는 공통 흐름(--extras-only·--chat-calendar-extras·--app-extras).
 * prepare(로그인·조회만) → inspect(이미 들어간 표식, 선택) → 하나라도 있으면 SeedRefusal(쓴 것 없음) → step(쓰기).
 * 쓰기 전 조회 결과를 step 에 넘겨 다시 조회하지 않는다. 쓴 뒤 실패하면 failMsg 를 앞에 붙인 Error(SeedRefusal 은 그대로 던진다).
 * @param {{ prepare: () => Promise<{ membership: object }>, inspect?: (ctx: object) => Promise<{ present: string[] }>,
 *   what: string, step: (ctx: object, inspected?: object) => Promise<unknown>, failMsg: string, slug: string, log: (line: string) => void }} o
 */
async function runOnly({ prepare, inspect, what, step, failMsg, slug, log }) {
  const ctx = await prepare();
  const inspected = inspect ? await inspect(ctx) : undefined;
  if (inspected?.present.length) throw new SeedRefusal(`${what}이 이미 있습니다: ${inspected.present.join(', ')}`);
  log(`테넌트 ${ctx.membership.tenantName}(${slug}) 에 ${what}을 넣습니다.`);
  try {
    return await step(ctx, inspected);
  } catch (e) {
    if (e instanceof SeedRefusal) throw e;
    throw new Error(`${failMsg}: ${e.message}`);
  }
}

/** 커서 페이지를 끝까지 넘겨 항목을 모은다. fetchPage(cursor) 는 { items, hasMore, nextCursor } 를 돌려준다(첫 페이지는 cursor=null). */
async function allPages(fetchPage) {
  const items = [];
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor);
  return items;
}

const cursorParam = (cursor) => (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');

/** 프로젝트 이슈 전부. */
function projectIssues(client, token, projectKey) {
  return allPages((cursor) => client.call(token, 'GET', `/projects/${projectKey}/issues?size=100${cursorParam(cursor)}`));
}

/** 채널의 최상위 메시지 전부. */
function channelMessages(client, token, channelId) {
  return allPages((cursor) => client.call(token, 'GET', `/messaging/channels/${channelId}/messages?limit=100${cursorParam(cursor)}`));
}

/** 프로젝트의 TASK 유형 id(새 이슈를 만들 때 넘긴다). */
async function taskTypeId(client, token, projectKey) {
  const types = await client.call(token, 'GET', `/projects/${projectKey}/types`);
  const task = types.find((t) => (t.code ?? t.key ?? t.name)?.toUpperCase() === 'TASK');
  return task.typeId ?? task.id;
}

/** 등장인물 key 별 사용자 id — 사람 구성원 목록에서 아이디로 찾는다. 없는 사람이 있으면 SeedRefusal(쓴 것 없음). */
async function memberIds(client, token, people, slug) {
  const humans = await client.call(token, 'GET', '/users?kind=HUMAN&size=100');
  const ids = {};
  for (const p of people) {
    const u = humans.content.find((h) => h.username.toLowerCase() === p.username.toLowerCase());
    if (!u) throw new SeedRefusal(`${p.username} 이 테넌트 ${slug} 의 구성원이 아닙니다.`);
    ids[p.key] = u.id;
  }
  return ids;
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
  const typeId = await taskTypeId(client, admin, projectKey);
  const create = (fields) => call(admin, 'POST', `/projects/${projectKey}/issues`, { assigneeIds: [ids.pm], typeId, ...fields });
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
  const titles = (await projectIssues(client, admin, projectKey)).map((i) => i.title);
  const present = Object.values(EXTRAS).filter((t) => titles.includes(t));
  if (present.length) throw new SeedRefusal(`보강 이슈가 이미 있습니다: ${present.join(', ')}`);
  const me = await client.call(admin, 'GET', '/users/me');
  const { token: devToken } = await loginIntoSlug(client, { username: dev.username, password, slug });
  return { membership, ids: { pm: me.id }, tokens: { pm: admin, dev: devToken } };
}

/** 이미 채운 테넌트에 보강만 넣는다(--extras-only). 쓰기 전에 멈추면 SeedRefusal, 쓴 뒤 실패하면 손으로 확인할 것을 적은 Error. */
export function runExtrasOnly({ client, slug, password, people, projectKey, seedExtras = seedManualExtras, log = () => {} }) {
  return runOnly({
    prepare: () => prepareExtrasOnly({ client, slug, password, people, projectKey }), // 보강 이슈가 이미 있으면 여기서 멈춘다
    what: '홈 장면 보강',
    step: ({ ids, tokens }) => seedExtras({ client, ids, tokens, projectKey }),
    failMsg: `보강 단계 실패 — 보강 이슈 일부가 들어갔을 수 있습니다(${Object.values(EXTRAS).join(', ')}). 확인해 지운 뒤 다시 돌립니다`,
    slug,
    log,
  });
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
  markIf(present, dms.some((d) => d.lastMessage && d.participants.some((p) => p.userId === ids.dev)), '이준호와의 DM');
  markIf(present, root.replyCount > 0, '김서연 메시지의 스레드 답글');
  markIf(present, (react.reactions ?? []).length > 0, '시안 메시지의 이모지 반응');
  markIf(present, events.some((e) => e.title === CHAT_CAL.invite.title), `일정 「${CHAT_CAL.invite.title}」`);
  for (const t of CHAT_CAL.tags) markIf(present, tags.some((x) => x.name === t.name), `태그 「${t.name}」`);
  return { channelId: channel.id, root, react, events, present };
}

/**
 * 대화·캘린더 보강을 넣는다. ids·tokens 는 등장인물 key(pm·dev·design·mkt·qa)별 사용자 id·테넌트 토큰이다.
 * 이미 하나라도 들어갔으면 쓰기 전에 SeedRefusal 로 멈춘다(전체 시드에서 불려도 같은 판정을 거친다).
 * @returns {Promise<{ dmId: number, replies: number, reactions: number, inviteId: number, tagged: number }>}
 */
export async function seedChatCalendarExtras({ client, ids, tokens, now = new Date(), inspected }) {
  const { call } = client;
  // inspected: 호출자(runChatCalendarOnly)가 쓰기 전에 이미 조회한 결과 — 있으면 다시 조회하지 않는다.
  const target = inspected ?? (await inspectChatCalendar({ client, admin: tokens.pm, ids, now }));
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
export function runChatCalendarOnly({ client, slug, password, people, seedStep = seedChatCalendarExtras, now = new Date(), log = () => {} }) {
  return runOnly({
    async prepare() {
      const tokens = {};
      let membership;
      for (const p of people) {
        const r = await loginIntoSlug(client, { username: p.username, password, slug });
        tokens[p.key] = r.token;
        membership ??= r.membership;
      }
      return { membership, tokens, ids: await memberIds(client, tokens.pm, people, slug) };
    },
    inspect: ({ tokens, ids }) => inspectChatCalendar({ client, admin: tokens.pm, ids, now }),
    what: '대화·캘린더 보강',
    step: ({ ids, tokens }, inspected) => seedStep({ client, ids, tokens, now, inspected }),
    failMsg: '대화·캘린더 보강 도중 실패 — 일부(DM·스레드 답글·반응·초대 일정·태그)가 들어갔을 수 있습니다. 확인해 지운 뒤 다시 돌립니다',
    slug,
    log,
  });
}

// ── 매뉴얼 05~16장 앱 장면용 보강(WP-1197) ──────────────────────────────────────
// 채널 드라이브 파일·버전·첨부·노트 연습장·노트 링크 공유·조직도·내 그룹·사용자 정의 역할·외부 실행 에이전트와 키.
// 모두 김서연(관리자)의 토큰으로만 쓴다 — 김서연 자신의 동작은 김서연에게 알림·안 읽음을 만들지 않고, 다른 사람의 화면 숫자도 바꾸지 않게
// 남에게 알림이 가는 경로(지정한 사람 공유 등)는 쓰지 않는다. 메시지 첨부는 김서연만 있는 「공지」 채널에 둔다(모바일-주문앱 대화를 바꾸지 않게).

/** 앱 장면 보강의 내용 — 이미 넣었는지 알아보는 표식도 여기서 나온다. */
export const APP_EXTRAS = {
  /** 05 채널 파일 — 모바일-주문앱 채널 드라이브에 올릴 파일. */
  channel: '모바일-주문앱',
  channelFiles: [
    { name: '베타 빌드 배포 노트.pdf', type: 'application/pdf', pdf: ['Beta build 0.9 release notes', 'Reorder in one tap', 'Out-of-stock replacement hints', 'Known issue: iOS 17 cart badge (MOB-7)'] },
    { name: '재주문 버튼 최종 시안.png', type: 'image/png', png: { band: [79, 70, 229] } },
  ],
  /** 08 버전 — MOB 버전과 묶을 이슈(제목으로 찾는다). */
  version: { name: '베타 1.0', description: '사내 베타 테스터 200명 대상 첫 빌드', start: -14, release: 12 },
  versionIssues: [
    '사용자로서 지난 주문을 한 번에 장바구니에 담고 싶다',
    '재주문 버튼 디자인 시안',
    '품절 상품 대체 추천 로직',
    'iOS 17에서 재주문 후 장바구니 수량이 0으로 표시됨',
  ],
  /** 09 첨부 — 이슈 첨부(버그 이슈)와 「공지」 채널 메시지 첨부. */
  issueAttachment: { issue: 'iOS 17에서 재주문 후 장바구니 수량이 0으로 표시됨', name: 'iOS17 재주문 수량 화면.png', type: 'image/png', png: { band: [220, 38, 38] } },
  noticeChannel: '공지',
  noticeMessage: {
    body: '베타 테스트 운영 일정 공유합니다. 다음 주 월요일부터 2주간 진행합니다.',
    file: { name: '베타 테스트 일정표.pdf', type: 'application/pdf', pdf: ['Beta test schedule', 'Week 1: internal testers (200)', 'Week 2: feedback triage and fixes'] },
  },
  /** 10 촬영 전용 빈 페이지 — 김서연의 개인 스페이스(내 노트)에 둔다. */
  scratchPage: '연습장',
  /** 10·12·16 링크 공유 — 모바일 주문 앱 스페이스의 페이지를 워크스페이스 전체에 보기로(알림 없음), 30일 뒤 만료. */
  wikiSpace: '모바일 주문 앱',
  sharedPages: ['제품 요구사항 (PRD)', '출시 체크리스트'],
  shareDays: 30,
  /** 11 조직도(관리자가 만든 공유 그룹)와 김서연의 내 그룹. members 는 PEOPLE key. */
  departments: [
    { name: '제품개발팀', members: ['pm', 'dev', 'qa'] },
    { name: '디자인팀', members: ['design'] },
    { name: '마케팅팀', members: ['mkt'] },
  ],
  myGroup: { name: '베타 오픈 TF', members: ['dev', 'design', 'qa'] },
  /** 14 사용자 정의 역할 — 이름은 대문자 규칙(서버 검증), 뜻은 설명에. 권한은 아래 코드 중 있는 것만. */
  role: { name: 'PARTNER', description: '외부 협력사 — 프로젝트·구성원·연락처·일정을 보기만 한다', permissions: ['project:read', 'user:read', 'contact:read', 'calendar:read'] },
  /** 15 외부 실행 에이전트 — AI(LLM)를 부르지 않는다(토큰 미등록·외부 실행). 키는 발급만 하고 값은 버린다. */
  agent: { username: 'release-bot', name: '배포 알리미', email: 'release-bot@example.com', keyLabel: '빌드 서버' },
};

/** 공유·개인 그룹 트리에서 이름 목록. */
function groupNames(nodes) {
  return nodes.flatMap((n) => [n.name, ...groupNames(n.children ?? [])]);
}

/**
 * 앱 장면 보강을 넣기 전 조회 — 대상(채널·스페이스·페이지·이슈)을 찾고, 이미 들어간 표식을 모은다(읽기만).
 * 대상이 없으면(소개 자료 데이터가 없는 테넌트) SeedRefusal.
 */
export async function inspectAppExtras({ client, admin, projectKey }) {
  const { call } = client;
  const A = APP_EXTRAS;
  const channels = await call(admin, 'GET', '/messaging/channels');
  const list = channels.content ?? channels;
  const main = list.find((c) => c.name === A.channel);
  const notice = list.find((c) => c.name === A.noticeChannel);
  const spaces = await call(admin, 'GET', '/wiki/spaces');
  const teamSpace = spaces.find((s) => s.name === A.wikiSpace);
  const personal = spaces.find((s) => s.type === 'PERSONAL');
  const issues = await projectIssues(client, admin, projectKey);
  const byTitle = (t) => issues.find((i) => i.title === t);
  const missing = [
    !main && `채널 ${A.channel}`,
    !notice && `채널 ${A.noticeChannel}`,
    !teamSpace && `노트 스페이스 ${A.wikiSpace}`,
    !personal && '내 노트 스페이스',
    ...A.versionIssues.filter((t) => !byTitle(t)).map((t) => `이슈 「${t}」`),
  ].filter(Boolean);
  if (missing.length) throw new SeedRefusal(`앱 장면 보강을 넣을 대상이 없습니다(먼저 전체 시드를 돌립니다): ${missing.join(', ')}`);

  const teamPages = await call(admin, 'GET', `/wiki/spaces/${teamSpace.id}/pages`);
  const sharedPages = A.sharedPages.map((t) => teamPages.find((p) => p.title === t));
  if (sharedPages.some((p) => !p)) throw new SeedRefusal(`노트 스페이스 ${A.wikiSpace} 에서 공유할 페이지를 찾지 못했습니다.`);
  const personalPages = await call(admin, 'GET', `/wiki/spaces/${personal.id}/pages`);

  const present = [];
  // 05 채널 드라이브 — 공간은 채널의 파일 탭을 처음 열 때도 생기므로, 공간이 아니라 올린 파일 이름으로 본다.
  const driveSpaces = await call(admin, 'GET', '/drive/spaces');
  const chanSpace = driveSpaces.find((s) => s.type === 'CHANNEL' && s.name === A.channel);
  if (chanSpace) {
    const items = await call(admin, 'GET', `/drive/spaces/${chanSpace.id}/items`);
    markIf(present, items.files.some((f) => A.channelFiles.some((x) => x.name === (f.name ?? f.originalName))), '채널 드라이브 파일');
  }
  const versions = await call(admin, 'GET', `/projects/${projectKey}/versions`);
  markIf(present, versions.some((v) => v.name === A.version.name), `버전 「${A.version.name}」`);
  const bug = byTitle(A.issueAttachment.issue);
  const attachments = await call(admin, 'GET', `/projects/${projectKey}/issues/${bug.number}/attachments`);
  markIf(present, attachments.some((f) => f.originalName === A.issueAttachment.name), '이슈 첨부');
  const noticeMsgs = await call(admin, 'GET', `/messaging/channels/${notice.id}/messages?limit=100`);
  markIf(present, noticeMsgs.items.some((m) => m.body === A.noticeMessage.body), `${A.noticeChannel} 채널 첨부 메시지`);
  markIf(present, personalPages.some((p) => p.title === A.scratchPage), `노트 「${A.scratchPage}」`);
  for (const p of sharedPages) {
    const state = await call(admin, 'GET', `/wiki/pages/${p.id}/share`);
    markIf(present, state.share, `노트 「${p.title}」 링크 공유`);
  }
  const tree = await call(admin, 'GET', '/user-groups');
  const shared = groupNames(tree.shared ?? []);
  const mine = groupNames(tree.personal ?? []);
  for (const d of A.departments) markIf(present, shared.includes(d.name), `조직도 「${d.name}」`);
  markIf(present, mine.includes(A.myGroup.name), `내 그룹 「${A.myGroup.name}」`);
  const roles = await call(admin, 'GET', '/roles');
  markIf(present, roles.some((r) => r.name === A.role.name), `역할 ${A.role.name}`);
  const agents = await call(admin, 'GET', '/admin/agents');
  markIf(present, agents.some((a) => a.username === A.agent.username), `에이전트 ${A.agent.username}`);

  return {
    present,
    mainChannelId: main.id,
    noticeChannelId: notice.id,
    personalSpaceId: personal.id,
    sharedPages,
    issueNumbers: Object.fromEntries(A.versionIssues.map((t) => [t, byTitle(t).number])),
  };
}

/** 공유 만료 시각 — 넣는 날(한국 시간)로부터 days 일 뒤 18시. */
function shareExpiry(days, now) {
  return `${kstDay(days, now)}T18:00:00+09:00`;
}

/**
 * 앱 장면 보강을 넣는다. ids 는 등장인물 key 별 사용자 id, tokens.pm 은 김서연의 테넌트 토큰이다(다른 사람 토큰은 쓰지 않는다).
 * 이미 하나라도 들어갔으면 쓰기 전에 SeedRefusal. 쓰기 순서는 아이디 충돌(서버 전체에서 하나)이 날 수 있는 에이전트가 먼저다 —
 * 409 면 쓴 것 없이 멈춘다.
 * @returns {Promise<Record<string, unknown>>} 만든 것의 요약(키 값은 담지 않는다)
 */
export async function seedAppExtras({ client, ids, tokens, projectKey, now = new Date(), inspected }) {
  const { call, upload } = client;
  const admin = tokens.pm;
  const A = APP_EXTRAS;
  // inspected: 호출자(runAppExtrasOnly)가 쓰기 전에 이미 조회한 결과 — 있으면 다시 조회하지 않는다.
  const t = inspected ?? (await inspectAppExtras({ client, admin, projectKey }));
  if (t.present.length) throw new SeedRefusal(`앱 장면 보강이 이미 있습니다: ${t.present.join(', ')}`);

  // 15 외부 실행 에이전트 — 먼저 만든다(409 면 쓴 것 없음). AGENT 역할(없으면 키로 부를 때 403), 외부 실행, 키 1개.
  try {
    await call(admin, 'POST', '/admin/agents', { username: A.agent.username, name: A.agent.name, email: A.agent.email });
  } catch (e) {
    if (e.status === 409) {
      throw new SeedRefusal(`에이전트 아이디 ${A.agent.username} 또는 이메일 ${A.agent.email} 이 서버에 이미 있습니다 — APP_EXTRAS.agent 를 바꿔야 합니다.`);
    }
    throw e;
  }
  const agent = (await call(admin, 'GET', '/admin/agents')).find((a) => a.username === A.agent.username);
  const agentRole = (await call(admin, 'GET', '/roles')).find((r) => r.name === 'AGENT');
  await call(admin, 'PUT', `/users/${agent.id}/roles`, { roleIds: [agentRole.id] });
  await call(admin, 'PUT', `/admin/agents/${agent.id}/runtime`, { runtime: 'EXTERNAL' });
  // 키 값은 응답에만 한 번 실린다 — 받지 않은 것처럼 버린다(출력·저장하지 않는다).
  await call(admin, 'POST', `/admin/agents/${agent.id}/keys`, { label: A.agent.keyLabel });

  // 14 사용자 정의 역할 — 권한은 서버에 있는 코드만.
  const role = await call(admin, 'POST', '/roles', { name: A.role.name, description: A.role.description });
  const perms = await call(admin, 'GET', '/permissions');
  const permissionIds = perms.filter((p) => A.role.permissions.includes(p.code)).map((p) => p.id);
  await call(admin, 'PUT', `/roles/${role.id}/permissions`, { permissionIds });

  // 11 조직도(공유 그룹)·내 그룹
  const addMembers = async (groupId, keys) => {
    for (const k of keys) await call(admin, 'POST', `/user-groups/${groupId}/members`, { targetType: 'MEMBER', targetId: ids[k] });
  };
  for (const [i, d] of A.departments.entries()) {
    const g = await call(admin, 'POST', '/user-groups', { name: d.name, parentId: null, visibility: 'SHARED', sortOrder: i });
    await addMembers(g.id, d.members);
  }
  const mine = await call(admin, 'POST', '/user-groups', { name: A.myGroup.name, parentId: null, visibility: 'PERSONAL' });
  await addMembers(mine.id, A.myGroup.members);

  // 08 버전과 묶인 이슈
  const version = await call(admin, 'POST', `/projects/${projectKey}/versions`, {
    name: A.version.name,
    description: A.version.description,
    startDate: kstDay(A.version.start, now),
    releaseDate: kstDay(A.version.release, now),
  });
  for (const title of A.versionIssues) {
    await call(admin, 'PUT', `/projects/${projectKey}/issues/${t.issueNumbers[title]}/versions`, { fixVersionIds: [version.id], affectsVersionIds: [] });
  }

  // 10 연습장(빈 페이지)·10·12·16 링크 공유(워크스페이스 전체 보기, 알림 없음)
  await call(admin, 'POST', `/wiki/spaces/${t.personalSpaceId}/pages`, { parentId: null, title: A.scratchPage });
  for (const p of t.sharedPages) {
    await call(admin, 'PUT', `/wiki/pages/${p.id}/share`, {
      audience: 'WORKSPACE',
      permission: 'VIEW',
      includeChildren: false,
      userIds: [],
      groupIds: [],
      expiresAt: shareExpiry(A.shareDays, now),
      notify: null,
    });
  }

  // 05 채널 드라이브 — 공간을 열고(있으면 그대로) 파일을 올린다.
  const fileBytes = (f) => (f.pdf ? makePdf(f.pdf) : makePng(f.png));
  const space = await call(admin, 'POST', `/messaging/channels/${t.mainChannelId}/drive-space`);
  for (const f of A.channelFiles) await upload(admin, `/drive/spaces/${space.spaceId}/files`, f.name, fileBytes(f), { type: f.type });

  // 09 이슈 첨부·메시지 첨부(김서연만 있는 공지 채널)
  const ia = A.issueAttachment;
  await upload(admin, `/projects/${projectKey}/issues/${t.issueNumbers[ia.issue]}/attachments`, ia.name, fileBytes(ia), { field: 'files', type: ia.type });
  const nf = A.noticeMessage.file;
  const uploaded = await upload(admin, `/messaging/channels/${t.noticeChannelId}/attachments`, nf.name, fileBytes(nf), { field: 'files', type: nf.type });
  await call(admin, 'POST', `/messaging/channels/${t.noticeChannelId}/messages`, {
    body: A.noticeMessage.body,
    parentMessageId: null,
    fileIds: uploaded.map((u) => u.fileId),
  });

  return {
    agent: A.agent.username,
    role: A.role.name,
    permissions: permissionIds.length,
    groups: A.departments.length + 1,
    version: A.version.name,
    versionIssues: A.versionIssues.length,
    shares: t.sharedPages.length,
    files: A.channelFiles.length + 2,
  };
}

/**
 * 이미 채운 테넌트에 앱 장면 보강만 넣는다(--app-extras). 김서연만 slug 테넌트로 한 번 로그인하고, 등장인물 id 를 구성원 목록에서 찾고,
 * 대상·표식을 조회한다 — 하나라도 실패하거나 이미 있으면 SeedRefusal(쓴 것 없음). 쓴 뒤 실패하면 이미 쓴 것을 확인하라는 Error.
 */
export function runAppExtrasOnly({ client, slug, password, people, projectKey, seedStep = seedAppExtras, now = new Date(), log = () => {} }) {
  return runOnly({
    async prepare() {
      const { token: admin, membership } = await loginIntoSlug(client, { username: people[0].username, password, slug });
      return { membership, admin, ids: await memberIds(client, admin, people, slug) };
    },
    inspect: ({ admin }) => inspectAppExtras({ client, admin, projectKey }),
    what: '앱 장면 보강',
    step: ({ admin, ids }, inspected) => seedStep({ client, ids, tokens: { pm: admin }, projectKey, now, inspected }),
    failMsg: '앱 장면 보강 도중 실패 — 일부(에이전트·역할·그룹·버전·노트·공유·파일·첨부)가 들어갔을 수 있습니다. 확인해 지운 뒤 다시 돌립니다',
    slug,
    log,
  });
}

// ── 매뉴얼 04장 AI 장면용 사전 데이터(--ai-run, WP-1197) ───────────────────────────
// 지니가 실제로 일한 이슈(착수·결과 코멘트, 상태 이력)와 외부 실행 에이전트(release-bot)에 맡긴 이슈 2건.
// 지니를 담당에 넣는 순간 서버가 지니를 깨워 LLM 을 부른다 — 이 단계는 전체 시드에 넣지 않고 따로, 한 번만 돈다(실패해도 다시 하지 않는다).
// 김서연에게 알림이 가지 않게: 지니 이슈는 박지민이 만들고 맡긴다(보고자·담당·구독자에 김서연 없음 — 구독은 보고자·담당자만 자동 등록).
// release-bot 담당 추가는 김서연이 한다(본인 동작은 본인에게 알리지 않는다). 사람 담당은 그대로 두고 AI 를 더한다(assignees 는 교체라 둘 다 넘김).

/** AI 장면 사전 데이터의 내용 — 이미 넣었는지 알아보는 표식도 여기서 나온다. */
export const AI_RUN = {
  issue: {
    title: '베타 오픈 회귀 테스트 체크리스트 작성',
    body: '베타 1.0 출시 전 회귀 테스트 항목을 체크리스트로 정리해 주세요. 대상: 간편 재주문, 포인트·쿠폰 통합, 배송 추적.',
    priority: 'MID',
    author: 'design', // 박지민
  },
  genie: 'genie',
  bot: 'release-bot',
  /** release-bot 에 맡길 이슈 수. 다른 그림에 쓰이는 이슈(SCENE_ISSUES·버전 이슈)는 고르지 않는다(pickBotIssues). */
  botIssues: 2,
  /** 지니가 끝났다고 보는 작업 상태, 실패로 보고 멈추는 상태. */
  doneStates: ['REVIEW', 'COMPLETED'],
  failStates: ['FAILED', 'CANCELED', 'REJECTED', 'INPUT_REQUIRED', 'AUTH_REQUIRED', 'BLOCKED'],
  waitMs: 15 * 60 * 1000,
  pollMs: 15 * 1000,
};

/**
 * 장면이 번호로 여는 MOB 이슈 — 한곳에 모은다(scenes/user.mjs 가 쓰고, openIssue 가 제목으로 번호가 맞는지 확인한다).
 * 번호는 시드가 넣는 순서에서 정해진다(소개 자료 시드 1~13, 홈 보강 14·15, --ai-run 16). 시드를 바꾸면 여기만 고친다.
 */
export const SCENE_ISSUES = {
  aiSummary: { number: 6, title: '품절 상품 대체 추천 로직' }, // 08 AI 현황 요약(once)
  bug: { number: 7, title: APP_EXTRAS.issueAttachment.issue }, // 08 이슈 상세·상태 목록
  picker: { number: 8, title: '베타 테스터 안내 메일 문구 작성' }, // 04 담당자 선택창
  dueToday: { number: 14, title: EXTRAS.dueToday }, // 07 일정 목록·08 보드 카드
  overdue: { number: 15, title: EXTRAS.overdue }, // 07 일정 목록
  aiRun: { number: 16, title: AI_RUN.issue.title }, // 04 AI 코멘트·이력(once)
};

/**
 * --ai-run 의 기다리는 시간(MANUAL_AI_WAIT_MS)을 읽는다(순수 함수). 비어 있으면 undefined(기본값), 양의 정수(ms)가 아니면 오류 —
 * 숫자가 아니면 NaN 이 되어 폴링이 끝나지 않으므로 쓰기 전에 거부한다.
 * @returns {{ ok: true, value: number | undefined } | { ok: false, reason: string }}
 */
export function parseWaitMs(raw) {
  if (raw == null || raw === '') return { ok: true, value: undefined };
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(n) || n <= 0) {
    return { ok: false, reason: 'MANUAL_AI_WAIT_MS 는 1 이상의 정수(밀리초)여야 합니다.' };
  }
  return { ok: true, value: n };
}

/** 김서연의 안 읽은 알림 수(01~03장 레일 종 배지와 같은 값). */
export async function unreadNotifications(client, token) {
  return (await client.call(token, 'GET', '/notifications/unread-count')).count;
}

/** release-bot 이 맡지 않을 이슈 제목 — 다른 그림에 쓰이는 이슈(버전 「베타 1.0」 이슈, 장면이 여는 이슈). 번호가 아니라 제목으로 고른다. */
export const BOT_EXCLUDE_TITLES = [...new Set([...APP_EXTRAS.versionIssues, ...Object.values(SCENE_ISSUES).map((i) => i.title)])];

/**
 * release-bot 에 맡길 MOB 이슈를 고른다(순수 함수) — 에픽이 아니고, 끝나지 않았고, 사람 담당이 있고, AI 담당이 없고, 제외 제목이 아닌 것 중 번호 순 앞의 count 건.
 * @param {object[]} issues 프로젝트 이슈 목록 응답 항목
 */
export function pickBotIssues(issues, { count = AI_RUN.botIssues, excludeTitles = BOT_EXCLUDE_TITLES } = {}) {
  return issues
    .filter((i) => (i.type?.code ?? i.type?.name ?? '').toUpperCase() !== 'EPIC')
    .filter((i) => !['DONE', 'CANCELED'].includes(i.status))
    .filter((i) => !excludeTitles.includes(i.title))
    .filter((i) => (i.assignees ?? []).length > 0 && (i.assignees ?? []).every((a) => a.kind !== 'AGENT'))
    .sort((a, b) => a.number - b.number)
    .slice(0, count);
}

/** 지니 작업이 어디까지 왔는지 판정(순수 함수) — done·failed·pending 중 하나와 사람이 읽을 요약. */
export function judgeGenie({ detail, comments, genieId }) {
  const work = (detail.agentWork ?? []).find((w) => w.worker?.id === genieId);
  const genieComments = comments.filter((c) => c.authorId === genieId).length;
  const summary = `지니 작업 ${work?.state ?? '없음'}${work?.note ? `(${work.note})` : ''}, 지니 코멘트 ${genieComments}건, 이슈 상태 ${detail.status}`;
  if (work && AI_RUN.failStates.includes(work.state)) return { verdict: 'failed', summary };
  if ((work && AI_RUN.doneStates.includes(work.state)) || genieComments >= 2) return { verdict: 'done', summary };
  return { verdict: 'pending', summary };
}

/**
 * --ai-run 전 준비 — 김서연·박지민을 slug 테넌트로 한 번씩 로그인하고, 지니·release-bot·대상 이슈를 찾고, 이미 들어갔는지 본다(읽기만).
 * @returns {Promise<object>} 쓰기에 필요한 토큰·id·고른 이슈
 */
export async function prepareAiRun({ client, slug, password, people, projectKey }) {
  const owner = people[0];
  const author = people.find((p) => p.key === AI_RUN.issue.author);
  const { token: admin, membership } = await loginIntoSlug(client, { username: owner.username, password, slug });
  const { token: authorToken } = await loginIntoSlug(client, { username: author.username, password, slug });
  const agents = await client.call(admin, 'GET', '/admin/agents');
  const genie = agents.find((a) => a.username === AI_RUN.genie);
  const bot = agents.find((a) => a.username === AI_RUN.bot);
  if (!genie || !bot) {
    throw new SeedRefusal(`에이전트 ${[!genie && AI_RUN.genie, !bot && AI_RUN.bot].filter(Boolean).join(', ')} 가 없습니다 — 전체 시드와 --app-extras 를 먼저 넣습니다.`);
  }
  const issues = await projectIssues(client, admin, projectKey);
  const present = [];
  markIf(present, issues.some((i) => i.title === AI_RUN.issue.title), `이슈 「${AI_RUN.issue.title}」`);
  markIf(present, issues.some((i) => (i.assignees ?? []).some((a) => a.id === bot.id)), `${AI_RUN.bot} 담당 이슈`);
  if (present.length) throw new SeedRefusal(`AI 장면 사전 데이터가 이미 있습니다: ${present.join(', ')}`);
  const botIssues = pickBotIssues(issues);
  if (botIssues.length < AI_RUN.botIssues) throw new SeedRefusal(`${AI_RUN.bot} 에 맡길 이슈가 ${AI_RUN.botIssues}건 없습니다(고른 것 ${botIssues.length}건).`);
  const authorId = (await client.call(authorToken, 'GET', '/users/me')).id;
  // 담당자는 프로젝트 멤버만 될 수 있다 — release-bot 은 앱 장면 보강에서 만들어 아직 MOB 멤버가 아니다(지니는 전체 시드에서 멤버가 됐다).
  const members = await client.call(admin, 'GET', `/projects/${projectKey}/members`);
  const botIsMember = members.some((m) => m.userId === bot.id);
  if (!members.some((m) => m.userId === genie.id)) throw new SeedRefusal(`지니가 프로젝트 ${projectKey} 멤버가 아닙니다.`);
  return { admin, authorToken, authorId, membership, genieId: genie.id, botId: bot.id, botIsMember, botIssues };
}

/**
 * AI 장면 사전 데이터를 넣는다(--ai-run). 순서: 준비(로그인·조회) → release-bot 담당 2건(LLM 안 부름) → 박지민 이슈 → 지니 담당 추가(지니 1회 실행)
 * → 끝날 때까지 폴링. 지니가 실패하거나 시간이 다 되면 다시 시도하지 않고 상태를 담은 Error 로 멈춘다.
 * 김서연 알림 수를 실행 전후로 log 에 남긴다.
 */
export async function runAiRun({ client, slug, password, people, projectKey, waitMs = AI_RUN.waitMs, pollMs = AI_RUN.pollMs, sleep, log = () => {} }) {
  const p = await prepareAiRun({ client, slug, password, people, projectKey });
  const { call } = client;
  const pause = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const before = await unreadNotifications(client, p.admin);
  log(`테넌트 ${p.membership.tenantName}(${slug}) 에 AI 장면 사전 데이터를 넣습니다. 김서연 안 읽은 알림(전): ${before}`);

  // 1) release-bot 을 MOB 멤버로 넣고(김서연, 아직 아니면) 담당에 더한다 — 사람 담당은 그대로.
  if (!p.botIsMember) await call(p.admin, 'POST', `/projects/${projectKey}/members`, { userId: p.botId, role: 'MEMBER' });
  for (const i of p.botIssues) {
    const userIds = [...i.assignees.map((a) => a.id), p.botId];
    await call(p.admin, 'PUT', `/projects/${projectKey}/issues/${i.number}/assignees`, { userIds });
  }
  log(`${AI_RUN.bot} 담당 추가: ${p.botIssues.map((i) => `${projectKey}-${i.number}`).join(', ')}`);

  // 2) 박지민이 이슈를 만들고(보고자·담당 박지민), 3) 지니를 담당에 더한다 — 이때 서버가 지니를 깨운다.
  const typeId = await taskTypeId(client, p.authorToken, projectKey);
  const issue = await call(p.authorToken, 'POST', `/projects/${projectKey}/issues`, {
    title: AI_RUN.issue.title,
    body: AI_RUN.issue.body,
    priority: AI_RUN.issue.priority,
    assigneeIds: [p.authorId],
    typeId,
  });
  const key = `${projectKey}-${issue.number}`;
  await call(p.authorToken, 'PUT', `/projects/${projectKey}/issues/${issue.number}/assignees`, { userIds: [p.authorId, p.genieId] });
  log(`${key} 「${AI_RUN.issue.title}」 을 만들고 지니에게 맡겼습니다. 끝날 때까지 기다립니다(최대 ${Math.ceil(waitMs / 60000)}분).`);

  // 4) 폴링 — 다시 시도하지 않는다.
  const deadline = Date.now() + waitMs;
  let judged;
  for (;;) {
    // 이슈 상세는 summary(목록과 같은 이슈 요약 — 상태·agentWork)와 코멘트·이력 등으로 나뉘어 온다.
    const raw = await call(p.authorToken, 'GET', `/projects/${projectKey}/issues/${issue.number}`);
    const detail = raw.summary ?? raw;
    const comments = await call(p.authorToken, 'GET', `/issues/${issue.id}/comments`);
    judged = judgeGenie({ detail, comments, genieId: p.genieId });
    if (judged.verdict !== 'pending' || Date.now() >= deadline) break;
    await pause(pollMs);
  }
  const after = await unreadNotifications(client, p.admin);
  log(`김서연 안 읽은 알림(후): ${after}${after !== before ? ` — ${after - before > 0 ? '+' : ''}${after - before}` : ' (변화 없음)'}`);
  if (judged.verdict !== 'done') {
    const why = judged.verdict === 'failed' ? '지니 실행이 실패했습니다' : '시간 안에 끝나지 않았습니다';
    throw new Error(`${key}: ${why} — 다시 시도하지 않습니다. 상태: ${judged.summary}. release-bot 담당 2건은 들어갔습니다.`);
  }
  return { issueKey: key, botIssues: p.botIssues.map((i) => `${projectKey}-${i.number}`), status: judged.summary, before, after };
}
