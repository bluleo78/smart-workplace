// 요청 단위 전체 AI 트랜스크립트 로거(#458) — AI 요청 본문 + claude CLI 스트림 응답 전체를
// 라인별 "수신 시각"과 함께 logs/ai-transcript/<requestId>.jsonl 에 덤프한다.
// 목적: (1) 레이턴시 분석 — 라인 간 ts 간격으로 어디서 시간을 쓰는지(LLM 추론/도구/재시도) 분해,
//      (2) 모델 동작 추적 — 어떤 도구(show_/list_)를 어떤 순서로 호출하고 무엇을 응답했는지.
// 의존성 없는 never-throw(파일 I/O 실패가 요청을 멈추면 안 됨). logger.ts 패턴 차용.
// 활성: WORKPLACE_AI_TRANSCRIPT=on/off 명시가 우선, 미설정이면 비-prod 에서 기본 on
//      (전체 트랜스크립트는 사용자 데이터·프롬프트를 통째로 남기므로 prod 기본 off).
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// dev=src/, prod=dist/ 어디서 실행되든 앱 루트의 logs/ai-transcript/ 를 가리킨다.
const DIR = path.resolve(here, '..', '..', 'logs', 'ai-transcript');

// 활성 조건 — 명시 override 우선, 미설정 시 비-prod 기본 on.
export function transcriptEnabled(): boolean {
  const v = process.env.WORKPLACE_AI_TRANSCRIPT;
  if (v === 'on' || v === '1' || v === 'true') return true;
  if (v === 'off' || v === '0' || v === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

// 한 레코드를 <requestId>.jsonl 에 append. requestId 없거나 비활성이면 no-op. 절대 throw 안 함.
function append(requestId: string | undefined, rec: Record<string, unknown>): void {
  if (!requestId || !transcriptEnabled()) return;
  let line: string;
  try {
    line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
  } catch {
    // 직렬화 실패(순환참조 등) — kind 만 남긴 최소 안전 라인으로 폴백.
    line = JSON.stringify({ ts: new Date().toISOString(), kind: rec.kind, _err: 'serialize_failed' });
  }
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(path.join(DIR, `${requestId}.jsonl`), line + '\n', 'utf8');
  } catch {
    // 파일 write 실패 — 조용히 무시(요청 흐름 보호).
  }
}

// 요청 시작 — ai-agent 가 claude CLI 로 보낸 본문(쿼리·맥락·모델·예산·시스템프롬프트 길이) 기록.
export function transcriptRequest(requestId: string | undefined, meta: Record<string, unknown>): void {
  append(requestId, { kind: 'request', ...meta });
}

// 스트림 라인 — claude CLI stream-json 한 줄을 "수신 즉시" 기록(파싱 성공 시 객체, 실패 시 raw 문자열).
// 라인마다 ts 가 찍히므로 라인 간 간격이 곧 단계별 지연이 된다.
export function transcriptStreamLine(requestId: string | undefined, raw: string): void {
  if (!requestId || !transcriptEnabled()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw; // 비-JSON 라인은 원문 그대로.
  }
  append(requestId, { kind: 'stream', line: parsed });
}

// 요청 종료 — 최종 답 텍스트·위젯 수·사용량·소요시간·fallback 사유 요약.
export function transcriptResult(requestId: string | undefined, summary: Record<string, unknown>): void {
  append(requestId, { kind: 'result', ...summary });
}
