#!/usr/bin/env node
/**
 * 소개 자료 촬영용 가상 회사 데이터를 격리 스택에 넣는다.
 *
 *   INTRO_API=http://localhost:6160 node docs/intro/scripts/seed-demo.mjs
 *
 * 왜 가상 데이터인가: 소개 자료는 고객에게 나가므로 운영(실 이슈·실 구성원 이름)을 찍지 않는다.
 * 빈 DB(첫 가입 전)에서만 돈다 — 첫 가입자가 ADMIN 이 되는 규칙을 그대로 이용하고,
 * 이미 사용자가 있으면 공유 DB 를 오염시키지 않도록 즉시 멈춘다.
 *
 * 계정 도메인은 예약 도메인 example.com 이라 실계정과 겹치지 않는다(smart-dcim 매뉴얼 촬영과 같은 규약).
 * AI 가 실제로 일하는 장면(이슈 위임 → AI 코멘트)은 ai-agent 가 떠 있어야 하므로 seed-ai.mjs 가 따로 맡는다.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = (process.env.INTRO_API ?? 'http://localhost:6160') + '/api/v1';
const PASSWORD = process.env.INTRO_PASS ?? 'IntroShot1!';
const DOMAIN = 'example.com';

/** 등장인물 — 첫 항목이 첫 가입자(ADMIN)이자 촬영 계정이다. */
export const PEOPLE = [
  { key: 'pm', username: `seoyeon@${DOMAIN}`, name: '김서연', role: 'ADMIN' },
  { key: 'dev', username: `junho@${DOMAIN}`, name: '이준호', role: 'USER' },
  { key: 'design', username: `jimin@${DOMAIN}`, name: '박지민', role: 'USER' },
  { key: 'mkt', username: `yuna@${DOMAIN}`, name: '최유나', role: 'USER' },
  { key: 'qa', username: `doyun@${DOMAIN}`, name: '정도윤', role: 'USER' },
];
export const AGENT = { username: 'genie', name: '지니', email: `genie@${DOMAIN}` };
export const PROJECT_KEY = 'MOB';

/** JSON API 호출. 실패하면 응답 본문을 붙여 던져 원인을 바로 보이게 한다. */
async function call(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function login(username, password = PASSWORD) {
  return (await call(null, 'POST', '/auth/login', { username, password })).accessToken;
}

/** 오늘 기준 상대 날짜(YYYY-MM-DD). 촬영 시점이 달라도 타임라인이 "지금" 주변에 놓이게 한다. */
function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** 오늘 기준 상대 일시(KST ISO). 캘린더 일정용. */
function at(offset, hour, minute = 0) {
  return `${day(offset)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
}

/** 드라이브 팀 공간과 기획 문서 업로드. 업로드는 multipart 라 call() 대신 fetch 를 직접 쓴다. */
export async function seedDrive(admin, ids) {
  const space = await call(admin, 'POST', '/drive/spaces', { name: '모바일 주문 앱' });
  for (const k of ['dev', 'design', 'mkt', 'qa', 'agent']) {
    await call(admin, 'POST', `/drive/spaces/${space.id}/members`, { userId: ids[k], role: 'EDITOR' }).catch(() => {});
  }
  const folder = await call(admin, 'POST', `/drive/spaces/${space.id}/folders`, { parentId: null, name: '기획' });
  for (const name of ['모바일 주문 앱 2.0 요구사항 정의서.pdf', '베타 테스트 운영 계획.docx']) {
    const buf = await readFile(new URL(`../content/drive/${name}`, import.meta.url));
    const form = new FormData();
    form.append('file', new Blob([buf]), name);
    const res = await fetch(`${API}/drive/spaces/${space.id}/files?folderId=${folder.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    });
    if (!res.ok) throw new Error(`드라이브 업로드 실패 ${name} → ${res.status} ${await res.text()}`);
  }
  return space;
}

async function main() {
  // 1) 첫 가입 → ADMIN. 이미 가입자가 있으면 깨끗한 DB 가 아니므로 중단한다.
  const [pm, ...others] = PEOPLE;
  const signup = await fetch(API + '/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pm.username, email: pm.username, password: PASSWORD, name: pm.name }),
  });
  if (!signup.ok) throw new Error(`첫 가입 실패(${signup.status}) — 빈 DB 에서만 실행한다: ${await signup.text()}`);
  const admin = await login(pm.username);

  const ids = { pm: (await call(admin, 'GET', '/users/me')).id };
  for (const p of others) {
    const u = await call(admin, 'POST', '/users', {
      username: p.username,
      email: p.username,
      name: p.name,
      password: PASSWORD,
      role: p.role,
    });
    ids[p.key] = u.userId ?? u.id;
  }
  const tokens = { pm: admin };
  for (const p of others) tokens[p.key] = await login(p.username);

  // 2) AI 에이전트 — 이슈 담당자로 지정 가능한 "팀원". 토큰 등록은 seed-ai.mjs 가 한다.
  // 생성 응답 형태에 기대지 않고 목록에서 username 으로 id 를 찾는다.
  await call(admin, 'POST', '/admin/agents', AGENT);
  ids.agent = (await call(admin, 'GET', '/admin/agents')).find((a) => a.username === AGENT.username).id;
  // 관리자 API 로 만든 에이전트에는 역할이 붙지 않아 모든 도구 호출이 403 이 된다(WP-252) — AGENT 역할을 직접 붙인다.
  // /admin/agents 생성은 역할을 부여하지 않는다 — 역할이 없으면 에이전트의 on-behalf API 호출이
  // 전부 403(project:read 등)으로 막혀 코멘트·상태 변경을 못 한다. AGENT 역할을 명시 부여한다.
  const agentRole = (await call(admin, 'GET', '/roles')).find((r) => r.name === 'AGENT');
  await call(admin, 'PUT', `/users/${ids.agent}/roles`, { roleIds: [agentRole.id] });

  // 3) 프로젝트·사이클·마일스톤·이슈
  await call(admin, 'POST', '/projects', {
    key: PROJECT_KEY,
    name: '모바일 주문 앱 2.0',
    description: '11월 말 출시 목표. 간편 재주문·포인트 통합·배송 추적 개편.',
    type: 'TEAM',
  });
  // 담당자는 프로젝트 멤버만 될 수 있다 — AI 에이전트도 팀원으로 합류시킨다.
  for (const k of ['dev', 'design', 'mkt', 'qa', 'agent']) {
    await call(admin, 'POST', `/projects/${PROJECT_KEY}/members`, { userId: ids[k], role: 'MEMBER' });
  }
  const types = await call(admin, 'GET', `/projects/${PROJECT_KEY}/types`);
  const typeId = (code) => {
    const t = types.find((x) => (x.code ?? x.key ?? x.name)?.toUpperCase() === code);
    if (!t) throw new Error(`이슈 유형 ${code} 없음: ${JSON.stringify(types).slice(0, 300)}`);
    return t.typeId ?? t.id;
  };

  const cycle = await call(admin, 'POST', `/projects/${PROJECT_KEY}/cycles`, {
    name: '스프린트 7',
    goal: '재주문 플로우 베타 배포',
    startDate: day(-4),
    endDate: day(10),
    status: 'ACTIVE',
  }).catch(() =>
    call(admin, 'POST', `/projects/${PROJECT_KEY}/cycles`, {
      name: '스프린트 7',
      goal: '재주문 플로우 베타 배포',
      startDate: day(-4),
      endDate: day(10),
    }),
  );
  for (const m of [
    { name: '베타 오픈', dueDate: day(12), description: '사내 베타 테스터 200명 대상' },
    { name: '정식 출시', dueDate: day(52), description: '앱스토어·플레이스토어 동시 출시' },
  ]) {
    await call(admin, 'POST', `/projects/${PROJECT_KEY}/milestones`, m);
  }

  /** 이슈 정의 — 상태는 생성 후 PATCH 로 옮긴다(생성 API 는 상태를 받지 않는다). */
  const ISSUES = [
    { t: 'EPIC', title: '간편 재주문', s: -20, d: 12, st: 'IN_PROGRESS', who: ['pm'], pr: 'HIGH',
      body: '최근 주문을 한 번에 다시 담는 흐름. 베타 오픈 핵심 기능.' },
    { t: 'EPIC', title: '포인트·쿠폰 통합', s: -6, d: 30, st: 'IN_PROGRESS', who: ['pm'], pr: 'MID',
      body: '흩어진 포인트·쿠폰 화면을 결제 단계 한 곳으로 모은다.' },
    { t: 'EPIC', title: '배송 추적 개편', s: 8, d: 45, st: 'TODO', who: ['pm'], pr: 'MID',
      body: '택배사 연동 확대와 실시간 위치 표시.' },
    { t: 'STORY', parent: 1, title: '사용자로서 지난 주문을 한 번에 장바구니에 담고 싶다', s: -18, d: -5, st: 'DONE', who: ['dev'], pr: 'HIGH' },
    { t: 'TASK', parent: 1, title: '재주문 버튼 디자인 시안', s: -16, d: -9, st: 'DONE', who: ['design'], pr: 'MID' },
    { t: 'TASK', parent: 1, title: '품절 상품 대체 추천 로직', s: -6, d: 4, st: 'IN_PROGRESS', who: ['dev'], pr: 'HIGH',
      body: '재주문 시 품절 상품은 같은 카테고리의 대체 상품을 제안한다.' },
    { t: 'BUG', parent: 1, title: 'iOS 17에서 재주문 후 장바구니 수량이 0으로 표시됨', s: -2, d: 2, st: 'IN_PROGRESS', who: ['dev', 'qa'], pr: 'HIGH',
      body: '재현: iOS 17.5, 최근 주문 > 재주문 > 장바구니 진입. 수량 배지가 0으로 보이고 새로고침하면 정상.' },
    { t: 'TASK', parent: 1, title: '베타 테스터 안내 메일 문구 작성', s: 2, d: 9, st: 'TODO', who: ['mkt'], pr: 'MID' },
    { t: 'TASK', parent: 2, title: '결제 단계 포인트 사용 UI', s: -3, d: 14, st: 'IN_PROGRESS', who: ['design'], pr: 'MID' },
    { t: 'TASK', parent: 2, title: '쿠폰 중복 적용 정책 정리', s: 0, d: 7, st: 'TODO', who: ['pm'], pr: 'MID' },
    { t: 'TASK', parent: 2, title: '포인트 API 연동', s: 5, d: 24, st: 'TODO', who: ['dev'], pr: 'MID' },
    { t: 'TASK', parent: 3, title: '택배사 API 비교 조사', s: 8, d: 18, st: 'TODO', who: ['dev'], pr: 'LOW' },
    { t: 'TASK', parent: 1, title: '재주문 회귀 테스트 시나리오 작성', s: -1, d: 6, st: 'IN_PROGRESS', who: ['qa'], pr: 'MID' },
  ];
  const created = [];
  for (const i of ISSUES) {
    const issue = await call(admin, 'POST', `/projects/${PROJECT_KEY}/issues`, {
      title: i.title,
      body: i.body ?? '',
      priority: i.pr,
      startDate: day(i.s),
      dueDate: day(i.d),
      assigneeIds: i.who.map((k) => ids[k]),
      typeId: typeId(i.t),
      parentNumber: i.parent,
    });
    if (i.st !== 'TODO') {
      await call(admin, 'PATCH', `/projects/${PROJECT_KEY}/issues/${issue.number}/status`, { status: i.st });
    }
    if (i.t !== 'EPIC' && cycle?.id) {
      await call(admin, 'PUT', `/projects/${PROJECT_KEY}/issues/${issue.number}/cycles`, { cycleIds: [cycle.id] }).catch(() => {});
    }
    created.push(issue);
  }

  // 사람 사이의 대화가 있는 이슈 — 버그 이슈에 QA·개발 코멘트
  const bug = created[6];
  await call(tokens.qa, 'POST', `/issues/${bug.id}/comments`, {
    body: 'iOS 17.5 / 17.6 두 기기에서 재현됩니다. Android 는 정상입니다. 화면 녹화 첨부했습니다.',
  });
  await call(tokens.dev, 'POST', `/issues/${bug.id}/comments`, {
    body: '장바구니 배지 갱신이 재주문 API 응답보다 먼저 일어나는 것 같습니다. 오늘 중 수정해서 올리겠습니다.',
  });

  // 4) 채널 대화
  const channel = await call(admin, 'POST', '/messaging/channels', { name: '모바일-주문앱', visibility: 'PUBLIC' });
  for (const k of ['dev', 'design', 'mkt', 'qa', 'agent']) {
    await call(admin, 'POST', `/messaging/channels/${channel.id}/members`, { userId: ids[k] }).catch(() => {});
  }
  const say = (k, body, parentMessageId = null) =>
    call(tokens[k], 'POST', `/messaging/channels/${channel.id}/messages`, { body, parentMessageId });
  await say('pm', '이번 주 목표는 재주문 베타 빌드입니다. 막히는 부분 있으면 여기 공유해 주세요.');
  await say('design', '재주문 버튼 최종 시안 올렸습니다. 홈 상단과 주문 내역 두 곳에 배치했어요.');
  const q = await say('qa', 'iOS 17 에서 재주문 후 수량이 0으로 보이는 버그 발견해서 이슈로 등록했습니다 (MOB-7).');
  await say('dev', '확인했습니다. 원인 파악됐고 오늘 오후에 수정 빌드 드릴게요.', q?.id ?? null).catch(() => {});
  await say('mkt', '베타 테스터 모집 공지는 다음 주 월요일에 나갈 예정입니다. 안내 문구 초안 준비할게요.');
  await call(admin, 'POST', '/messaging/channels', { name: '공지', visibility: 'PUBLIC' });

  // "놓친 대화 요약" 장면용 — 김서연(촬영 계정)은 채널을 만든 뒤 자리를 비웠고, 그 사이 대화가 5건 이상 쌓인다.
  // 5건 이상이면 채널 진입 시 요약 카드가 자동으로 열린다(web lib/catchupGate.ts).
  const review = await call(admin, 'POST', '/messaging/channels', { name: '디자인-리뷰', visibility: 'PUBLIC' });
  for (const k of ['dev', 'design', 'mkt', 'qa']) {
    await call(admin, 'POST', `/messaging/channels/${review.id}/members`, { userId: ids[k] });
  }
  const post = (k, body) => call(tokens[k], 'POST', `/messaging/channels/${review.id}/messages`, { body });
  // 김서연의 첫 메시지가 읽음 기준점(lastReadMessageId)이 된다 — 빈 채널을 만든 직후엔 기준점이 null 이라
  // 웹이 미읽음을 세지 않고 요약 카드도 띄우지 않는다(ChannelPage.tsx: watermark != null 조건).
  const opening = await post('pm', '포인트·쿠폰 결제 UI 시안은 여기서 리뷰해요. 저는 오후에 파트너사 미팅이라 끝나고 볼게요.');
  // 내가 보낸 메시지만으로는 읽음 기준점이 잡히지 않으므로 명시적으로 읽음 처리한다(WP-256).
  await call(admin, 'POST', `/messaging/channels/${review.id}/read`, { uptoMessageId: opening.id });
  await post('design', '결제 단계 포인트 사용 UI 시안 2안 올렸습니다. A안은 토글, B안은 슬라이더예요.');
  await post('dev', 'B안 슬라이더는 포인트 단위가 10원이라 조작이 어려울 수 있어요. A안이 구현도 단순합니다.');
  await post('mkt', '고객 인터뷰에서 "포인트 전액 사용" 버튼 요청이 많았어요. A안에 전액 사용 버튼 추가하면 좋겠습니다.');
  await post('qa', 'A안 기준이면 쿠폰과 포인트 동시 적용 케이스 테스트를 추가해야 합니다.');
  await post('design', '그럼 A안 + 전액 사용 버튼으로 정리하겠습니다. 서연님 최종 확인 부탁드려요!');
  await post('dev', '확정되면 포인트 API 연동(MOB-11) 일정 당겨서 시작할게요.');

  // 5) 노트(위키)
  const space = await call(admin, 'POST', '/wiki/spaces', { name: '모바일 주문 앱' });
  // 노트 스페이스는 멤버만 읽는다 — AI 에이전트도 멤버로 넣어야 PRD·회의록을 근거로 일할 수 있다.
  for (const k of ['dev', 'design', 'mkt', 'qa', 'agent']) {
    await call(admin, 'POST', `/wiki/spaces/${space.id}/members`, { userId: ids[k], role: 'EDITOR' });
  }
  const pages = [
    ['제품 요구사항 (PRD)', await readFile(new URL('../content/wiki-prd.md', import.meta.url), 'utf8')],
    ['주간 회의록 10월 1주', await readFile(new URL('../content/wiki-meeting.md', import.meta.url), 'utf8')],
    ['출시 체크리스트', '- [x] 베타 빌드 배포 채널 확정\n- [ ] 앱스토어 심사 자료\n- [ ] 고객센터 FAQ 갱신\n- [ ] 장애 대응 당번표'],
  ];
  for (const [title, body] of pages) {
    const page = await call(admin, 'POST', `/wiki/spaces/${space.id}/pages`, { parentId: null, title });
    await call(admin, 'PUT', `/wiki/pages/${page.id}`, { title, body, version: page.version ?? 0, snapshot: true });
  }

  // 6) 캘린더 일정
  const team = ['dev', 'design', 'mkt', 'qa'].map((k) => ids[k]);
  for (const e of [
    { title: '스프린트 7 데일리', s: at(0, 10), e: at(0, 10, 15), loc: '회의실 A' },
    { title: '재주문 디자인 리뷰', s: at(1, 14), e: at(1, 15), loc: '회의실 B' },
    { title: '베타 오픈 Go/No-Go', s: at(3, 16), e: at(3, 17), loc: '대회의실' },
    { title: '스프린트 7 데일리', s: at(1, 10), e: at(1, 10, 15), loc: '회의실 A' },
    { title: '파트너사 결제 연동 미팅', s: at(2, 11), e: at(2, 12), loc: '온라인' },
  ]) {
    await call(admin, 'POST', '/calendar/events', {
      title: e.title, startsAt: e.s, endsAt: e.e, allDay: false, location: e.loc, attendeeUserIds: team,
    });
  }

  // 7) 외부 연락처
  for (const c of [
    { name: '한지우', email: 'jiwoo.han@partner.example.com', phone: '010-1234-5678', organization: '페이링크', title: '제휴 매니저' },
    { name: '오세훈', email: 'sehoon.oh@logis.example.com', phone: '010-2345-6789', organization: '빠른물류', title: 'API 담당' },
  ]) {
    await call(admin, 'POST', '/contacts/external', { ...c, notes: '', visibility: 'SHARED' });
  }

  // 8) 드라이브 — 팀 공간에 기획 문서 2개. 문서 처리 워커가 떠 있으면 본문 추출 후 미리보기에서 AI 요약이 된다.
  await seedDrive(admin, ids);

  // 9) 개인 API 토큰 — "쓰던 AI 도구에서도" 장면의 토큰 목록이 비어 보이지 않게(평문은 버린다).
  await call(admin, 'POST', '/users/me/api-tokens', { name: '내 AI 도구 연동', expiresAt: null });

  console.log(JSON.stringify({ ids, channelId: channel.id, wikiSpaceId: space.id, cycleId: cycle?.id }, null, 2));
}

// seed-ai.mjs 가 상수·login 을 가져다 쓰므로, 직접 실행할 때만 시드를 돈다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
