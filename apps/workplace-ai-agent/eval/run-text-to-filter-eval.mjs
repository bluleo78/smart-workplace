#!/usr/bin/env node
/**
 * #519 NL→이슈 필터 라이브 eval runner.
 * ai-agent 서버(기본 http://localhost:7070)에 질의 → SSE 응답의 done 이벤트에서 show_issue_list params 캡처 → eval.json 기대값과 대조.
 *
 * 사용법:
 *   EVAL_BASE_URL=http://localhost:7070/ai/chat EVAL_TOKEN=<bearer-token> node eval/run-text-to-filter-eval.mjs
 *   또는 기본값 사용(ai-agent:7070, 테스트 토큰):
 *   EVAL_TOKEN=test node eval/run-text-to-filter-eval.mjs
 *
 * 환경변수:
 *   EVAL_BASE_URL       — ai-agent chat 엔드포인트 (기본: http://localhost:7070/ai/chat)
 *   EVAL_TOKEN          — Bearer 토큰 (필수)
 *   EVAL_AGENT_ID     — 대행 에이전트 ID (기본: 1)
 *   EVAL_USER_ID      — 요청 사용자 ID (기본: 1)
 *   EVAL_MODEL        — LLM 모델 (기본: claude-3-5-sonnet-20241022)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dir, 'text-to-filter-eval.json'), 'utf8'));

const CHAT_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:7070/ai/chat';
const TOKEN = process.env.EVAL_TOKEN;
const AGENT_ID = Number(process.env.EVAL_AGENT_ID ?? '1');
const USER_ID = Number(process.env.EVAL_USER_ID ?? '1');
const MODEL = process.env.EVAL_MODEL ?? 'claude-3-5-sonnet-20241022';
// 도구 호출(turn 1) 후 최종 응답(turn 2+)까지 완료하려면 maxTurns ≥ 2 필요.
// maxTurns:1 이면 도구 호출 직후 chat_failed 로 끊겨 done 이벤트가 안 옴.
const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? '6');

if (!TOKEN) {
  console.error('❌ EVAL_TOKEN 환경변수 필수');
  process.exit(1);
}

console.log(`📊 #519 NL→이슈 필터 eval runner`);
console.log(`   URL: ${CHAT_URL}`);
console.log(`   Agent: ${AGENT_ID}, User: ${USER_ID}, Model: ${MODEL}`);
console.log(`\n총 ${spec.cases.length}개 케이스\n`);

/**
 * 이번 주 월~일(Asia/Seoul) ISO 범위 계산.
 * 결과: { from: "2026-06-22", to: "2026-06-28" } (월~일)
 */
function thisWeekRange() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  // Seoul 달력일을 그대로 쓰려면 UTC 자정으로 파싱한다(+09:00 으로 파싱하면 UTC 로 전날 시프트돼
  // getUTCDay 가 하루 밀려 전주를 계산하는 버그가 생긴다).
  const d = new Date(today + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { from: iso(mon), to: iso(sun) };
}

/**
 * SSE 응답에서 done 이벤트의 fullText(prose)와 widgets 추출.
 */
async function ask(query) {
  const body = JSON.stringify({
    query,
    assistantAgentId: AGENT_ID,
    userId: USER_ID,
    model: MODEL,
    thinkingDepth: 'NONE',
    maxTurns: MAX_TURNS,
    timeoutMs: 60000,
  });

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Internal ${TOKEN}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const text = await res.text();
  let prose = '';
  let widgets = [];

  // SSE 라인 파싱
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const dataStr = line.slice(5).trim();
    if (!dataStr) continue;

    try {
      const ev = JSON.parse(dataStr);

      // delta 이벤트 — 점진 텍스트
      if (ev.text && typeof ev.text === 'string') {
        prose += ev.text;
      }

      // done 이벤트 — fullText + widgets
      if (ev.fullText && typeof ev.fullText === 'string') {
        prose = ev.fullText; // 최종 텍스트로 덮어씀
      }
      if (Array.isArray(ev.widgets)) {
        widgets = ev.widgets;
      }
    } catch {
      // 비-JSON 라인 무시
    }
  }

  return { prose, widgets };
}

/**
 * 기대값과 실제 결과 비교.
 * expect 필드:
 *   - degraded: true — 필터 0~1개 필드 + "지원하지 않" 류 안내
 *   - dueRange: "thisWeek" — dueFrom/dueTo 이번 주 범위 검증
 *   - 기타 필드: 정확 일치
 */
function checkExpect(expectObj, got, week) {
  const issueListWidget = got.widgets?.find((w) => w.type === 'issue_list');
  const params = issueListWidget?.params ?? {};

  // 1. degradation 케이스 — 필터 최소화 + 안내 prose
  if (expectObj.degraded) {
    const hasNoDateFilter = !params.dueFrom && !params.dueTo;
    // 미지원 차원을 정직하게 안내했는지 — 동의어 허용(지원하지 않/미지원/불가/어렵).
    const hasExplanation = /지원(하지\s*않|되지\s*않|안\s*[함됨됩]|불가)|미지원|할\s*수\s*없|어렵습니다/.test(got.prose);
    const fieldCount = Object.keys(params).length;

    // vacuous 통과 방지: 위젯 없음만으로는 불충분 — 반드시 안내 prose 가 있어야 한다.
    if (hasNoDateFilter && hasExplanation) {
      return { pass: true, detail: `정직한 거절 안내 확인(필드 ${fieldCount}개)` };
    }
    return {
      pass: false,
      detail: `degradation 실패: hasNoDateFilter=${hasNoDateFilter}, hasExplanation=${hasExplanation}, fieldCount=${fieldCount}, prose="${got.prose.slice(0, 80)}"`,
    };
  }

  // 2. 일반 케이스 — 필드 대조
  const failures = [];

  for (const [key, expectedValue] of Object.entries(expectObj)) {
    // dueRange 는 special case — week 범위 검증
    if (key === 'dueRange') {
      const dueFrom = params.dueFrom;
      const dueTo = params.dueTo;

      if (!dueFrom || !dueTo) {
        failures.push(`필드 누락: dueFrom=${dueFrom}, dueTo=${dueTo}`);
      } else if (dueFrom < week.from || dueTo > week.to) {
        failures.push(`범위 오류: dueFrom=${dueFrom}, dueTo=${dueTo} ∉ [${week.from}, ${week.to}]`);
      }
      continue;
    }

    // status 는 CSV 문자열 필드(z.string) — 토큰 집합으로 순서 무관 비교.
    if (key === 'status') {
      const toSet = (v) =>
        (Array.isArray(v) ? v : String(v ?? '').split(','))
          .map((s) => s.trim())
          .filter(Boolean)
          .sort();
      const expSet = toSet(expectedValue);
      const actSet = toSet(params[key]);
      if (JSON.stringify(expSet) !== JSON.stringify(actSet)) {
        failures.push(`status: expected {${expSet}}, got {${actSet}}`);
      }
      continue;
    }

    // 배열 비교 (정렬 후)
    if (Array.isArray(expectedValue)) {
      const actualValue = params[key] ?? [];
      const exp = Array.isArray(actualValue) ? actualValue : [actualValue];
      const sorted_exp = exp.slice().sort();
      const sorted_expected = expectedValue.slice().sort();

      if (JSON.stringify(sorted_exp) !== JSON.stringify(sorted_expected)) {
        failures.push(`${key}: expected ${JSON.stringify(sorted_expected)}, got ${JSON.stringify(sorted_exp)}`);
      }
      continue;
    }

    // 스칼라 비교
    const actualValue = params[key];
    if (actualValue !== expectedValue) {
      failures.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }

  if (failures.length === 0) {
    return { pass: true, detail: '전 필드 일치' };
  }
  return { pass: false, detail: failures.join('; ') };
}

// ===== Main =====

const week = thisWeekRange();
console.log(`📅 이번 주: ${week.from} ~ ${week.to}\n`);

let passed = 0;
let failed = 0;

for (const caseObj of spec.cases) {
  process.stdout.write(`[${caseObj.id}] "${caseObj.query}"`);

  try {
    const got = await ask(caseObj.query);
    const result = checkExpect(caseObj.expect, got, week);

    if (result.pass) {
      console.log(` ✅ PASS — ${result.detail}`);
      passed++;
    } else {
      console.log(`\n    ❌ FAIL — ${result.detail}`);
      if (got.widgets.length > 0) {
        const w = got.widgets.find((x) => x.type === 'issue_list');
        if (w) console.log(`    실제 params: ${JSON.stringify(w.params)}`);
      } else {
        console.log(`    (위젯 없음)`);
      }
      failed++;
    }
  } catch (e) {
    console.log(`\n    ❌ ERROR — ${e.message}`);
    failed++;
  }

  // 여유(rate limiting 회피) — 구독 토큰은 빠른 연속 호출에서 간헐적으로
  // 도구 호출을 건너뛰는 경향이 있어 케이스 간 충분히 띄운다.
  await new Promise((r) => setTimeout(r, Number(process.env.EVAL_GAP_MS ?? '3000')));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`✓ ${passed}/${spec.cases.length} 통과`);

if (failed > 0) {
  console.log(`✗ ${failed}/${spec.cases.length} 실패`);
  process.exit(1);
} else {
  console.log('🎉 전체 통과!');
  process.exit(0);
}
