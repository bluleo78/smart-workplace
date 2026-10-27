#!/usr/bin/env node
// 릴리스 ↔ WP 프로젝트 버전 연동 CLI (WP-1005) — 스킬 /release 가 태그 push 뒤에 부른다(.claude/skills/release/SKILL.md).
//   node deploy/release/tracker.mjs attach <x.y.z> [--to <ref, 기본 v<x.y.z>>] [--base <ref> --base-version <x.y.z>]
//     WP 프로젝트에 버전 v<x.y.z> 를 만들고(없을 때만), prepare plan 과 같은 범위의 이슈(제목·Refs: 의 WP 키)에 수정 버전으로 붙인다.
//   node deploy/release/tracker.mjs release <x.y.z> | unrelease <x.y.z>
//     버전을 출시·출시 취소로 바꾼다 — 보통은 release.mjs deploy·rollback 이 알아서 한다. 그쪽이 트래커 설정 없이 돌았을 때 손으로 맞추는 용도.
// 필요 환경: GENIA_WORKS_API_URL · GENIA_WORKS_RELEASE_TOKEN(WP 프로젝트 OWNER 의 개인 토큰). 없으면 안내만 하고 0 으로 끝난다.
// 트래커 실패는 릴리스를 막지 않는다 — API 오류·시간 초과도 경고만 남기고 종료 코드 0(태그는 이미 나갔다). 인자가 틀리거나 범위(git)를 못 구하면 1.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertVersion, defaultExec } from './lib/build.mjs';
import { isMainModule } from './lib/cli.mjs';
import { attachVersion, bestEffort, setReleased, trackerFromEnv } from './lib/tracker.mjs';
import { plan } from './prepare.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const USAGE = '사용법: tracker.mjs attach <x.y.z> [--to <ref>] [--base <ref> --base-version x.y.z] | release <x.y.z> | unrelease <x.y.z>';

/** CLI 본체. tracker 를 주입받아 테스트가 네트워크 없이 흐름을 본다(null = 설정 없음). */
export async function main(argv, { exec = defaultExec, repoRoot = REPO_ROOT, log = console.error, tracker = trackerFromEnv() } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { to: { type: 'string' }, base: { type: 'string' }, 'base-version': { type: 'string' } },
  });
  const [command, version, ...rest] = positionals;
  if (!['attach', 'release', 'unrelease'].includes(command) || !version || rest.length > 0) throw new Error(USAGE);
  assertVersion(version);
  if (command === 'attach') {
    // 범위는 태그 기준으로 다시 계산한다 — 노트에 쓴 범위와 같다(plan 은 --to 자신에 붙은 태그를 기준에서 뺀다).
    const { issues } = plan({ to: values.to ?? `v${version}`, base: values.base, baseVersion: values['base-version'], exec, repoRoot, log });
    return bestEffort({ tracker, log, what: '버전 연결' }, (t) => attachVersion(t, { version, issueKeys: issues.map((i) => i.key), log }));
  }
  return bestEffort({ tracker, log, what: command === 'release' ? '출시' : '출시 취소' }, (t) => setReleased(t, { version, released: command === 'release', log }));
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
