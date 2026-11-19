// DinD 정리 스크립트(WP-1581)를 가짜 du·docker·sleep 으로 실제 sh 에서 돌려 본다 — 임계값 아래면 아무것도 지우지 않고,
// 넘으면 이미지보다 컨테이너·볼륨·빌드 캐시를 먼저 지우며, 그래도 넘을 때만 이미지를 지우는지. TERM 이면 바로 끝나는지도.
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { DIND_GC_SCRIPT } from './dind-gc.js';

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * 가짜 명령을 둔 폴더를 만든다.
 * - du: `$dir/used` 의 KiB 를 낸다
 * - docker: 인자를 `$dir/calls` 에 한 줄씩 적고, `$dir/after-<하위명령>` 이 있으면 그 값을 `used` 로 옮긴다(지워 줄어든 사용량)
 * - sleep: rounds 번째 대기에서 부모 sh 에 TERM 을 보낸다 — 정한 바퀴만 돌고 trap 으로 끝나는지 본다
 */
function fakeBin(usedKib: number, after: Record<string, number> = {}, rounds = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'dind-gc-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'used'), String(usedKib));
  for (const [sub, kib] of Object.entries(after)) writeFileSync(join(dir, `after-${sub}`), String(kib));
  const bin = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  bin('du', `printf '%s\\t%s\\n' "$(cat ${dir}/used)" "$2"`);
  bin('docker', `echo "$*" >>${dir}/calls\n[ -f ${dir}/after-$1 ] && cp ${dir}/after-$1 ${dir}/used\nexit 0`);
  bin('sleep', `echo "$1" >>${dir}/sleeps\nn=$(($(cat ${dir}/slept 2>/dev/null || echo 0) + 1)); echo $n >${dir}/slept\n[ $n -ge ${rounds} ] && kill -TERM $PPID\nexit 0`);
  return dir;
}

async function runOnce(
  dir: string,
  thresholdKib: number,
  imageCooldownSeconds = 3600,
  criticalKib = thresholdKib * 2,
  criticalCooldownSeconds = 3600,
) {
  const { stdout } = await run('sh', ['-c', DIND_GC_SCRIPT], {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      DIND_GC_THRESHOLD_KIB: String(thresholdKib),
      DIND_GC_CRITICAL_KIB: String(criticalKib),
      DIND_GC_INTERVAL_SECONDS: '60',
      DIND_GC_FAST_INTERVAL_SECONDS: '15',
      DIND_GC_IMAGE_COOLDOWN_SECONDS: String(imageCooldownSeconds),
      DIND_GC_CRITICAL_COOLDOWN_SECONDS: String(criticalCooldownSeconds),
    },
    timeout: 5000,
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
  } catch {
    // docker 를 한 번도 부르지 않았다
  }
  let sleeps: string[] = [];
  try {
    sleeps = readFileSync(join(dir, 'sleeps'), 'utf8').trim().split('\n');
  } catch {
    // sleep 을 한 번도 부르지 않았다
  }
  return { stdout, calls, sleeps };
}

describe('DIND_GC_SCRIPT', () => {
  it('logsAndSkips_whenUsageCannotBeMeasured', async () => {
    // du 가 아무것도 내지 못하면(권한·경로) 정리가 조용히 꺼진다 — 로그로 드러낸다
    const dir = fakeBin(0);
    writeFileSync(join(dir, 'du'), '#!/bin/sh\nexit 1\n');
    const { calls, stdout } = await runOnce(dir, 1000);
    expect(calls).toEqual([]);
    expect(stdout).toContain('잴 수 없습니다');
  });

  it('doesNothing_whenUsageBelowThreshold', async () => {
    const { calls } = await runOnce(fakeBin(500), 1000);
    expect(calls).toEqual([]);
  });

  it('prunesContainersVolumesAndBuildCacheButKeepsImages_whenThatIsEnough', async () => {
    const { calls, stdout } = await runOnce(fakeBin(1500, { volume: 400 }), 1000);
    // 막 만든(아직 시작 전) 컨테이너는 남긴다 — Testcontainers 의 create→start 사이를 지우지 않게.
    // 볼륨은 이름 있는 것도 지운다(-af) — 멈춘 컨테이너를 먼저 지웠으니 남은 볼륨은 쓰지 않는 스택의 찌꺼기다.
    expect(calls).toEqual(['container prune -f --filter until=10m', 'volume prune -af']);
    expect(stdout).toContain('1500');
    expect(stdout).toContain('400');
  });

  it('alsoPrunesUnusedImages_whenStillOverThreshold', async () => {
    const { calls } = await runOnce(fakeBin(1500, { volume: 1200, image: 300 }), 1000);
    // 빌드 캐시·이미지는 다시 만들거나 받는 값이 커서 그래도 넘을 때만, 쿨다운 안에서 한 번
    expect(calls).toEqual([
      'container prune -f --filter until=10m',
      'volume prune -af',
      'builder prune -af',
      'image prune -af',
    ]);
  });

  it('prunesImagesAtMostOncePerCooldown_whenUsageStaysOverThreshold', async () => {
    // 실행 중인 것만으로 임계값을 넘는 동안 매번 이미지를 지우면 테스트가 이미지를 거듭 다시 받는다 — 쿨다운 안에서는 한 번만
    const { calls, stdout } = await runOnce(fakeBin(1500, {}, 2), 1000);
    expect(calls.filter((c) => c.startsWith('image prune'))).toEqual(['image prune -af']);
    expect(calls.filter((c) => c.startsWith('builder prune'))).toEqual(['builder prune -af']);
    expect(calls.filter((c) => c.startsWith('volume prune'))).toHaveLength(2);
    expect(stdout).toContain('쿨다운');
  });

  it('prunesImagesAgain_afterCooldown', async () => {
    const { calls } = await runOnce(fakeBin(1500, {}, 2), 1000, 0);
    expect(calls.filter((c) => c.startsWith('image prune'))).toHaveLength(2);
  });

  it('prunesImagesOncePerCriticalCooldown_whenOverCriticalLine', async () => {
    // 위급선 위에서도 쿨다운을 완전히 없애지 않는다 — 짧은 위급 쿨다운 안에서는 한 번만(막 받은 이미지를 15초마다 지우지 않게)
    const { calls, stdout } = await runOnce(fakeBin(1500, {}, 2), 1000, 3600, 1400, 3600);
    expect(calls.filter((c) => c === 'image prune -af')).toHaveLength(1);
    expect(stdout).toContain('위급');
    expect(stdout).toContain('쿨다운 중');
  });

  it('prunesImagesAgain_whenCriticalCooldownElapsed', async () => {
    // 일반 쿨다운(3600)이 남았어도 위급 쿨다운(0)이 지났으면 위급선에서는 다시 지운다
    const { calls, stdout } = await runOnce(fakeBin(1500, {}, 2), 1000, 3600, 1400, 0);
    expect(calls.filter((c) => c === 'image prune -af')).toHaveLength(2);
    expect(stdout).toContain('위급선');
  });

  it('usesNormalCooldown_whenBelowCriticalLine', async () => {
    // 위급선 아래에서는 위급 쿨다운(0)이 아니라 일반 쿨다운(3600)을 쓴다
    const { calls } = await runOnce(fakeBin(1500, {}, 2), 1000, 3600, 2000, 0);
    expect(calls.filter((c) => c === 'image prune -af')).toHaveLength(1);
  });

  it('sleepsFast_whenNearThreshold', async () => {
    const { calls, sleeps } = await runOnce(fakeBin(850), 1000);
    expect(sleeps).toEqual(['15']);
    expect(calls).toEqual([]);
  });

  it('sleepsNormal_whenWellBelowThreshold', async () => {
    const { sleeps } = await runOnce(fakeBin(500), 1000);
    expect(sleeps).toEqual(['60']);
  });

  it('sleepsNormal_whenUsageCannotBeMeasured', async () => {
    const dir = fakeBin(0);
    writeFileSync(join(dir, 'du'), '#!/bin/sh\nexit 1\n');
    const { sleeps } = await runOnce(dir, 1000);
    expect(sleeps).toEqual(['60']);
  });
});
