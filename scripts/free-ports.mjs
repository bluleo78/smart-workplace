// dev 서버 기동 전, 지정한 포트를 LISTEN 중인 프로세스를 종료한다.
// 이전 dev 스택이 남아 있을 때 EADDRINUSE(gradle bootRun/tsx) 로 실패하는 것을 방지한다.
// macOS/Linux 의 lsof 에 의존한다(이 레포는 darwin 로컬 개발 전제). lsof 가 없거나
// 점유 프로세스가 없으면 조용히 통과한다.
import { execSync } from 'node:child_process';

const ports = process.argv.slice(2);

/** 포트를 LISTEN 중인 PID 목록(없으면 빈 배열). */
function listeningPids(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? out.split('\n').map(Number).filter(Boolean) : [];
  } catch {
    // lsof 미설치 또는 점유 프로세스 없음 → exit code != 0. 무시.
    return [];
  }
}

function kill(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** 짧게 동기 대기(폴링 간격). */
function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy-wait: predev 단계 짧은 정착 대기용 */
  }
}

for (const port of ports) {
  const pids = listeningPids(port);
  if (pids.length === 0) continue;

  // 1) 정상 종료 시도.
  for (const pid of pids) {
    if (kill(pid, 'SIGTERM')) console.log(`[free-ports] ${port} 점유 프로세스 종료(SIGTERM) pid=${pid}`);
  }

  // 2) 최대 ~2초간 정착 대기 후, 살아남은 프로세스는 강제 종료.
  for (let i = 0; i < 10; i++) {
    if (listeningPids(port).length === 0) break;
    sleep(200);
  }
  for (const pid of listeningPids(port)) {
    if (kill(pid, 'SIGKILL')) console.log(`[free-ports] ${port} 강제 종료(SIGKILL) pid=${pid}`);
  }
}
