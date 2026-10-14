#!/usr/bin/env node
/**
 * WP-383 스펙 3.8 저장 판단 라이브 확인 — 실제 모델로 "자기 취향·사실은 묻지 않고 저장, 잡담은 저장 안 함"을 본다.
 * ai-agent(기본 http://localhost:6070/ai/chat)에 메모리 켜짐·빈 메모리로 질의 → SSE 의 tool 이벤트에서 remember_memory 결과(성공)를 찾고,
 * 답 본문에 "저장할까요"류 되묻기가 있는지 본다. remember_memory 는 실제 API 에 저장하므로 끝나면 설정 > AI 비서 > 메모리에서 지운다.
 *
 * 사용법:
 *   EVAL_TOKEN=<내부 토큰> EVAL_AGENT_ID=<비서 에이전트 id> EVAL_USER_ID=<사용자 id> EVAL_MODEL=claude-haiku-5-5 node eval/run-memory-save-eval.mjs
 *
 * 환경변수:
 *   EVAL_BASE_URL — ai-agent chat 엔드포인트 (기본: http://localhost:6070/ai/chat)
 *   EVAL_TOKEN    — 내부 토큰(Authorization: Internal …, 필수)
 *   EVAL_AGENT_ID — 비서 에이전트 id (기본 1)
 *   EVAL_USER_ID  — 요청 사용자 id — 메모리가 저장될 사람 (기본 1)
 *   EVAL_MODEL    — 모델 (기본 claude-haiku-5-5)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dir, 'memory-save-eval.json'), 'utf8'));

const CHAT_URL = process.env.EVAL_BASE_URL ?? 'http://localhost:6070/ai/chat';
const TOKEN = process.env.EVAL_TOKEN;
const AGENT_ID = Number(process.env.EVAL_AGENT_ID ?? '1');
const USER_ID = Number(process.env.EVAL_USER_ID ?? '1');
const MODEL = process.env.EVAL_MODEL ?? 'claude-haiku-5-5';

/** 되묻기 문장 — 저장 여부를 사용자에게 넘기는 표현(스펙 3.8 증상). */
const ASK_BACK = /(기억|저장)(해\s*(드릴|둘)까요|할까요)|기억해\s*줘?라고|원하시면\s*(기억|저장)/;

if (!TOKEN) {
  console.error('EVAL_TOKEN 환경변수가 필요합니다');
  process.exit(1);
}

/** Asia/Seoul 오늘(yyyy-MM-dd) — 블록의 오늘 줄. */
function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** 한 질의 → { savedKinds: string[], prose: string } — tool 이벤트의 remember_memory 성공 결과와 done 의 fullText. */
async function ask(query) {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Internal ${TOKEN}` },
    body: JSON.stringify({
      query,
      assistantAgentId: AGENT_ID,
      userId: USER_ID,
      model: MODEL,
      thinkingDepth: 'NONE',
      maxTurns: 6,
      timeoutMs: 90000,
      memories: [],
      memoryEnabled: true,
      today: seoulToday(),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  const savedKinds = [];
  let prose = '';
  let event = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    let data;
    try {
      data = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (event === 'tool' && data.phase === 'result' && !data.isError && String(data.toolName).endsWith('remember_memory')) {
      savedKinds.push(data.memory?.kind ?? '?');
    }
    if (event === 'delta' && typeof data.text === 'string') prose += data.text;
    if (event === 'done' && typeof data.fullText === 'string') prose = data.fullText;
  }
  return { savedKinds, prose };
}

console.log(`WP-383 저장 판단 라이브 확인 — model=${MODEL} user=${USER_ID}`);
let failed = 0;
for (const c of spec.cases) {
  const got = await ask(c.query);
  const saved = got.savedKinds.length > 0;
  const askedBack = ASK_BACK.test(got.prose);
  const pass = saved === c.expect.saved && !askedBack;
  const kindNote = c.expect.kind && saved && !got.savedKinds.includes(c.expect.kind) ? ` (종류 ${got.savedKinds.join(',')} — 기대 ${c.expect.kind})` : '';
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.id}: "${c.query}" → 저장 ${saved ? got.savedKinds.join(',') : '없음'}, 되묻기 ${askedBack ? '있음' : '없음'}${kindNote}`);
  if (!pass) {
    failed++;
    console.log(`     답: ${got.prose.slice(0, 160)}`);
  }
}
console.log(failed === 0 ? '모두 통과' : `${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
