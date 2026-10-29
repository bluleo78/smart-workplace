#!/usr/bin/env node
/**
 * 운영자 매뉴얼 촬영용 가상 테넌트를 격리 스택에 넣는다.
 *
 *   MANUAL_API=http://localhost:6166 MANUAL_PASS=... node docs/manual/scripts/seed-operator.mjs
 *
 * 왜 격리 스택인가: 운영 슈퍼어드민 화면에는 실제 고객사 이름이 보이므로 운영에서 찍지 않는다(집필 스킬 「촬영 환경」).
 * 데이터는 API 로만 넣는다(DB 직접 쓰기 금지):
 *   1) 빈 DB 의 첫 가입자(POST /api/v1/auth/signup)가 플랫폼 슈퍼어드민이 된다 — 이 계정이 촬영 계정이다.
 *   2) 나머지는 운영자 콘솔과 같은 플랫폼 API(/api/platform)로 만든다 — 테넌트 생성, 구성원(계정) 추가, 상태 전환.
 *
 * 대상은 격리 로컬 스택만 허용한다: MANUAL_API 가 localhost 의 운영자 매뉴얼 스택 포트(6166)여야 한다(checkIsolatedApi).
 *
 * 다시 돌려도 되게(멱등) 만들었다: 테넌트는 이름으로, 사용자는 이메일 조회로 이미 있는지 보고 건너뛴다.
 * 상태(정지·삭제)도 지금 상태를 보고 필요한 전환만 한다. 단, 첫 가입이 이미 닫힌 DB 에서 운영자 계정이 없으면
 * (다른 데이터가 든 DB) 멈춘다 — 공유 DB 를 오염시키지 않기 위해서다.
 *
 * 계정 도메인은 예약 도메인 example.com 이라 실계정과 겹치지 않는다. 비밀번호는 MANUAL_PASS 하나를 모든 가상 계정에
 * 쓰고 출력하지 않는다(대문자·소문자·숫자를 섞은 8자 이상 — 가입·구성원 추가의 비밀번호 규칙).
 */
import { checkIsolatedApi, DOMAIN, OPERATOR, TENANTS } from './lib/operator-seed.mjs';

const BASE = process.env.MANUAL_API;
const PASS = process.env.MANUAL_PASS;
if (!BASE || !PASS) {
  console.error('환경변수가 필요합니다: MANUAL_API, MANUAL_PASS'); // 값은 출력하지 않는다
  process.exit(1);
}
// 격리 스택에서만 돈다 — 공유 개발 DB 의 첫 가입(슈퍼어드민) 자리를 가상 계정이 차지하지 않게.
const target = checkIsolatedApi(BASE);
if (!target.ok) {
  console.error(target.reason);
  process.exit(1);
}

/** JSON API 호출. 실패하면 응답 본문을 붙여 던진다. allow 에 든 상태 코드는 null 로 돌려준다(없음·이미 있음 판정용). */
async function call(token, method, path, body, { allow = [] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allow.includes(res.status)) return null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 첫 가입으로 슈퍼어드민을 만든다. 가입이 닫혀 있으면(이미 사용자가 있음) 운영자 계정이 이미 있는지 로그인으로 확인한다. */
async function ensureOperator() {
  const { available } = await call(null, 'GET', '/api/v1/auth/signup-available');
  if (available) {
    await call(null, 'POST', '/api/v1/auth/signup', {
      username: OPERATOR.username,
      email: OPERATOR.username,
      password: PASS,
      name: OPERATOR.name,
    });
    console.log(`운영자 계정을 만들었습니다: ${OPERATOR.username}`);
  }
  // 로그인 실패는 한 번만 시도하고 멈춘다(잘못된 비밀번호로 반복하면 계정 잠금에 걸린다).
  const res = await call(null, 'POST', '/api/platform/auth/login', { username: OPERATOR.username, password: PASS }, { allow: [401, 403] });
  if (!res) {
    console.error('운영자 로그인 실패 — 빈 DB 가 아니거나 MANUAL_PASS 가 다릅니다. 매번 깨끗한 DB 에서 돌립니다.');
    process.exit(1);
  }
  return res.accessToken;
}

/** 이메일로 사용자를 찾는다(없으면 null). */
async function lookup(token, email) {
  return call(token, 'GET', `/api/platform/users/lookup?email=${encodeURIComponent(email)}`, undefined, { allow: [404] });
}

/** 구성원 하나를 넣는다 — 계정이 없으면 만들어 추가, 있으면 기존 사용자로 추가(이미 구성원이면 건너뜀). */
async function ensureMember(token, tenantId, m) {
  const email = `${m.email}@${DOMAIN}`;
  const user = await lookup(token, email);
  if (!user) {
    await call(token, 'POST', `/api/platform/tenants/${tenantId}/members`, { email, name: m.name, password: PASS, role: m.role });
    return 'new';
  }
  const added = await call(token, 'POST', `/api/platform/tenants/${tenantId}/members/existing`, { userId: user.userId, role: m.role }, { allow: [409] });
  return added ? 'existing' : 'skip';
}

/**
 * 시드가 끝났을 때의 상태로 맞춘다. status 는 지금 상태(목록·생성·복원 결과로 이미 안다 — 다시 조회하지 않는다).
 * 호출 전에 삭제된 테넌트는 복원해 두므로 여기 오는 상태는 ACTIVE·SUSPENDED 뿐이다.
 */
async function ensureStatus(token, tenantId, status, want) {
  const post = (action) => call(token, 'POST', `/api/platform/tenants/${tenantId}/${action}`);
  if (status === 'SUSPENDED' && want === 'ACTIVE') await post('activate');
  if (status === 'ACTIVE' && want === 'SUSPENDED') await post('suspend');
  if (want === 'DELETED') await post('delete'); // 운영 중(활성·정지)이면 어느 쪽에서든 삭제된다
}

const token = await ensureOperator();
const existing = await call(token, 'GET', '/api/platform/tenants');
for (const t of TENANTS) {
  let tenant = existing.find((e) => e.name === t.name);
  if (tenant && tenant.status === 'PURGING') throw new Error(`${t.name} 이 영구 삭제 중입니다 — 깨끗한 DB 에서 다시 돌립니다.`);
  if (!tenant) tenant = await call(token, 'POST', '/api/platform/tenants', { name: t.name, slug: t.slug });
  let status = tenant.status;
  // 구성원 추가는 운영 중인 테넌트에만 된다 — 삭제된 채 남은 테넌트(재실행)는 먼저 복원(→ ACTIVE)한 뒤 넣고 다시 맞춘다.
  if (status === 'DELETED') {
    await call(token, 'POST', `/api/platform/tenants/${tenant.id}/restore`);
    status = 'ACTIVE';
  }
  const kinds = [];
  for (const m of t.members) kinds.push(`${m.name}(${await ensureMember(token, tenant.id, m)})`);
  await ensureStatus(token, tenant.id, status, t.status);
  console.log(`${t.name} [${t.status}] ${kinds.join(', ')}`);
}
console.log('시드 완료');
