#!/usr/bin/env node
/**
 * 사용자 매뉴얼 촬영 테넌트를 가상 회사 데이터로 채운다 — 이미 만든 테넌트에 HTTP API 로만(WP-1194).
 *
 *   MANUAL_API=https://genia-works.iacloud.kr MANUAL_TENANT_SLUG=nuri-demo MANUAL_SEED_CONFIRM=nuri-demo \
 *     MANUAL_PASS="$(security find-generic-password -s genia-works-manual-demo -w)" node docs/manual/scripts/seed-user.mjs
 *
 * 전제: 사람이 운영자 콘솔에서 테넌트(누리커머스)와 소유자 seoyeon@example.com(김서연)을 만들어 둔다. 시드는 그 소유자로 로그인해
 * 나머지 등장인물 계정(POST /users)과 콘텐츠(이슈·채널·노트·일정·연락처·드라이브)를 넣는다. 데이터와 단계는 소개 자료 시드
 * (docs/intro/scripts/seed-demo.mjs 의 createPeople·seedContent)를 그대로 쓴다 — 두 촬영물이 같은 가상 회사를 보여 준다.
 *
 * 쓰기 전 가드(하나라도 걸리면 아무것도 쓰지 않고 멈춘다 — 판정과 순서는 lib/user-seed.mjs):
 *   a) 서버 루트 주소여야 하고, localhost 가 아니면 https 이고 MANUAL_SEED_CONFIRM 이 MANUAL_TENANT_SLUG 와 같아야 한다(아니면 exit 2).
 *   b) 소유자를 slug 의 테넌트로 로그인한다(소속이 여럿이면 테넌트를 고른 뒤, 토큰의 테넌트 확인).
 *   c) 빈 테넌트여야 한다 — 프로젝트 MOB 가 없고, 사람 구성원이 소유자·등장인물뿐이어야 한다.
 *   이미 구성원인 등장인물(초기화 뒤 「기존 사용자 추가」로 넣은 사람)도 이때 한 번씩 로그인해 둔다 — 실패하면 쓰기 전에 멈춘다.
 * 쓰기 순서: 에이전트(이름 충돌이 가장 흔해 먼저) → 등장인물 계정 → 콘텐츠. 아이디가 서버에 이미 있는지 테넌트 관리자가 미리 볼 API 는 없어,
 * 계정 단계에서 409 가 나면 그때까지 쓴 것을 알리고 멈춘다(다시 돌리면 이미 만든 계정·에이전트는 건너뛰고 이어 한다).
 * TLS 는 Node 기본 검증 그대로 쓴다(NODE_TLS_REJECT_UNAUTHORIZED 를 건드리지 않는다).
 *
 * MANUAL_PASS 는 소유자와 새로 만드는 모든 등장인물의 비밀번호다. 환경변수로만 받고 파일·로그에 남기지 않는다.
 * AI 가 실제로 일하는 장면(seed-ai)은 여기서 돌리지 않는다 — 운영에서 AI 를 부리는 일은 따로 확인하고 한다.
 */
import { AGENT, createPeople, ensureAgent, makeClient, PEOPLE, PROJECT_KEY, seedContent } from '../../intro/scripts/seed-demo.mjs';
import { checkManualTarget, runManualSeed, SeedRefusal } from './lib/user-seed.mjs';

const USAGE =
  '사용법: MANUAL_API=<https://서버 | http://localhost:포트 — 경로 없이> MANUAL_TENANT_SLUG=<slug> MANUAL_PASS=<비밀번호> ' +
  '[MANUAL_SEED_CONFIRM=<slug — localhost 가 아니면 필수>] node docs/manual/scripts/seed-user.mjs';

/** 사용법 오류로 멈춘다(exit 2). 값은 출력하지 않는다. */
function usage(reason) {
  console.error(reason);
  console.error(USAGE);
  process.exit(2);
}

const SLUG = process.env.MANUAL_TENANT_SLUG;
const missing = ['MANUAL_API', 'MANUAL_TENANT_SLUG', 'MANUAL_PASS'].filter((k) => !process.env[k]);
if (missing.length) usage(`환경변수가 필요합니다: ${missing.join(', ')}`);

// a) 대상 서버
const target = checkManualTarget({ api: process.env.MANUAL_API, slug: SLUG, confirm: process.env.MANUAL_SEED_CONFIRM });
if (!target.ok) usage(target.reason);

try {
  const out = await runManualSeed({
    client: makeClient(target.base),
    slug: SLUG,
    password: process.env.MANUAL_PASS,
    people: PEOPLE,
    agent: AGENT,
    projectKey: PROJECT_KEY,
    steps: { ensureAgent, createPeople, seedContent },
    log: (line) => console.log(line),
  });
  console.log(`시드 완료 — ${target.base}, 프로젝트 ${PROJECT_KEY}, 채널 ${out.channelId}, 노트 스페이스 ${out.wikiSpaceId}, 사이클 ${out.cycleId}`);
} catch (e) {
  // SeedRefusal 은 쓰기 전에 멈춘 것, 그 밖은 쓴 뒤 실패(메시지에 이미 쓴 것을 적는다). 비밀번호는 오류 응답에 실리지 않는다.
  console.error(e instanceof SeedRefusal ? `멈춤(쓴 것 없음): ${e.message}` : `실패: ${e.message}`);
  process.exit(1);
}
