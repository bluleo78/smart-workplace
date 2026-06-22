// 의존성 없는 JSONL 파일 로거 — AI 응답 실패 원인의 사후 추적용.
// 날짜별 파일(logs/ai-agent-YYYY-MM-DD.log)에 한 줄씩 append 하고 console 에도 병행 출력한다.
// 파일 write 실패가 프로세스를 멈추면 안 되므로 모든 I/O 는 try/catch + console fallback.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// dev=src/, prod=dist/ 어디서 실행되든 앱 루트의 logs/ 를 가리킨다(모듈 위치의 부모).
const LOG_DIR = path.resolve(here, '..', 'logs');

type Level = 'INFO' | 'WARN' | 'ERROR';

// 날짜(local)를 YYYY-MM-DD 로 만들어 날짜별 로그 파일 절대경로를 반환한다.
export function logFilePathFor(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `ai-agent-${y}-${m}-${d}.log`);
}

// 로그 한 줄(JSONL)을 만든다. ts 는 호출 시각(ISO-8601)으로 자동 주입.
export function formatEntry(
  level: Level,
  tag: string,
  event: string,
  fields?: Record<string, unknown>,
): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, tag, event, ...fields });
}

// 파일 write 억제 여부 — DISABLE_FILE_LOG=true 환경변수로 제어.
// 테스트에서는 node:fs 를 vi.mock 으로 대체하므로 VITEST 체크 불필요.
function fileLoggingDisabled(): boolean {
  return process.env.DISABLE_FILE_LOG === 'true';
}

// 한 엔트리를 파일에 append + console 에 출력한다. 파일 I/O 실패는 삼킨다.
function write(level: Level, tag: string, event: string, fields?: Record<string, unknown>): void {
  // 직렬화 실패(순환참조·BigInt·throwing toString 등)도 호출자에게 전파되지 않게 보호한다.
  // 실패 시 fields 를 버린 최소 안전 라인으로 폴백한다(고정 형태 + 원시값뿐이라 다시 던지지 않음).
  let line: string;
  try {
    line = formatEntry(level, tag, event, fields);
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, tag, event, _logError: 'serialize_failed' });
  }
  // console 은 항상(레벨에 맞는 스트림). 기존 디버깅 경험 보존.
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  if (fileLoggingDisabled()) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(logFilePathFor(new Date()), line + '\n', 'utf8');
  } catch {
    // 파일 write 실패(권한·디스크) — console 출력은 이미 했으므로 조용히 무시.
  }
}

export const log = {
  info: (tag: string, event: string, fields?: Record<string, unknown>) =>
    write('INFO', tag, event, fields),
  warn: (tag: string, event: string, fields?: Record<string, unknown>) =>
    write('WARN', tag, event, fields),
  error: (tag: string, event: string, fields?: Record<string, unknown>) =>
    write('ERROR', tag, event, fields),
};
