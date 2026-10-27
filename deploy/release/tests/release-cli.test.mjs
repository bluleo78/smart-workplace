// 릴리스 CLI(release.mjs) 테스트 (WP-443) — 실제 helm·kubectl·git·네트워크 없이 가짜 exec 로 deploy·rollback·status 흐름을 검증한다.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { main as realChecklist } from '../checklist.mjs';
import { defaultExec } from '../lib/build.mjs';
import { VERSION_ENDPOINTS, main, ttyConfirm } from '../release.mjs';
import { REPO, SHA, baseManifest, catalog, fakeDigest, fakeTracker, makeTmp } from './helpers.mjs';

const CTX = 'iacloud-prod-public';
const NS = 'smart-workplace';
/** 비밀값 — 어떤 출력·오류에도 나오면 안 된다. */
const SECRET = 'SUPER-SECRET-DB-PASSWORD';

/** 대상 릴리스 0.9.0 의 매니페스트(앱마다 새 digest·builtVersion 0.9.0). */
function manifest09() {
  const m = baseManifest();
  m.version = '0.9.0';
  m.commit = SHA;
  m.baseVersion = '0.8.0';
  for (const [id, img] of Object.entries(m.images)) {
    img.digest = fakeDigest(`new:${id}`);
    img.builtVersion = '0.9.0';
  }
  return m;
}

/** 매니페스트대로 정상 실행 중인 파드 JSON(앱 하나). 컨테이너 이름은 id, db 만 postgres. */
const podsJson = (id, digest, { ready = true } = {}) => ({
  items: [{ metadata: { name: `${id}-0`, labels: { app: id } }, status: { containerStatuses: [{ name: id === 'db' ? 'postgres' : id, ready, imageID: `docker-pullable://repo/${id}@${digest}` }] } }],
});

/**
 * 가짜 exec. 모든 호출을 기록하고 명령 모양으로 답한다.
 * - helm history / get values(--revision n, 생략하면 Helm 처럼 가장 마지막 리비전) / upgrade / rollback, kubectl get pods / get --raw, git rev-parse·archive, tar.
 * - values: 리비전 번호 → helm get values 결과 객체. 비밀값이 든 옛 리비전을 흉내 낼 수 있다.
 * - pods: 앱 id → 파드 JSON(기본은 매니페스트대로). raw: 서비스 이름 → 프록시 응답 문자열(기본은 정상 버전) 또는 Error.
 */
function makeRelease({ history = [], values = {}, pods = {}, raw = {}, manifest = manifest09(), failUpgrade = false, tagCommit = SHA, historyAfter, chartAtTag = true, secrets = {}, historyError } = {}) {
  const calls = [];
  const upgradeFiles = {};
  let upgraded = false;
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const line = args.join(' ');
    if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: `${tagCommit}\n` };
    if (cmd === 'git' && args[0] === 'cat-file') {
      if (!chartAtTag) throw new Error('git cat-file 실패: Not a valid object name');
      return { stdout: '' };
    }
    if (cmd === 'git' && args[0] === 'archive') return { stdout: '' };
    if (cmd === 'tar') {
      const dest = args[args.indexOf('-C') + 1];
      mkdirSync(join(dest, 'deploy', 'helm'), { recursive: true });
      writeFileSync(join(dest, 'deploy', 'helm', 'values.prod.yaml'), 'prod: true\n');
      return { stdout: '' };
    }
    if (cmd === 'helm') {
      if (args[0] === 'history') {
        if (historyError && (!upgraded || historyAfter === undefined)) throw new Error(historyError);
        // historyAfter: helm upgrade 를 부른 뒤의 이력(실패가 새 리비전을 남겼는지 등). Error 면 history 를 못 읽는 상황.
        const now = upgraded && historyAfter !== undefined ? historyAfter : history;
        if (now instanceof Error) throw now;
        return { stdout: JSON.stringify(now) };
      }
      if (args[0] === 'get') {
        // 실제 Helm 처럼: --revision 이 없으면 status 와 무관하게 「가장 마지막」 리비전(failed·pending 포함)의 values.
        const rev = args.includes('--revision') ? Number(args[args.indexOf('--revision') + 1]) : Math.max(...history.map((h) => h.revision));
        if (!(rev in values)) throw new Error(`values 없음: ${rev}`);
        return { stdout: JSON.stringify(values[rev]) };
      }
      if (args[0] === 'upgrade') {
        upgraded = true;
        // 임시 디렉터리는 끝에 지워지므로 호출 시점에 -f 파일 내용을 떠 둔다.
        args.forEach((a, i) => {
          if (a === '-f') upgradeFiles[args[i + 1]] = readFileSync(args[i + 1], 'utf8');
        });
        upgradeFiles.chartDir = args[2];
        if (failUpgrade) throw new Error('helm upgrade 실패 (종료 코드 1)\nUPGRADE FAILED: timed out');
        return { stdout: '' };
      }
      if (args[0] === 'rollback') return { stdout: '' };
    }
    if (cmd === 'kubectl') {
      if (args.includes('secret')) {
        // 기본: Helm 소유가 아닌 정상 Secret. secrets[name] 이 null 이면 없음, 객체면 그 metadata.
        const name = args[args.indexOf('secret') + 1];
        const metadata = name in secrets ? secrets[name] : { name, annotations: { 'helm.sh/resource-policy': 'keep', 'kubectl.kubernetes.io/last-applied-configuration': SECRET } };
        if (metadata === null) throw new Error(`kubectl get secret ${name} 실패: NotFound`);
        return { stdout: JSON.stringify(metadata) };
      }
      if (args.includes('--raw')) {
        const m = /services\/([^:]+):\d+\/proxy\/(.+)$/.exec(args[args.indexOf('--raw') + 1]);
        const answer = raw[m[1]] ?? (m[1] === 'api' ? JSON.stringify({ app: { version: '0.9.0' } }) : JSON.stringify({ version: '0.9.0' }));
        if (answer instanceof Error) throw answer;
        return { stdout: answer };
      }
      // 파드는 네임스페이스 전체를 한 번에 돌려준다(app 라벨은 podsJson 이 붙인다) — 앱별 `-l` 호출은 없다.
      assert.ok(!args.includes('-l'), `앱별 -l 조회 금지: ${line}`);
      const ids = [...new Set([...Object.keys(manifest.images), ...Object.keys(pods)])];
      return { stdout: JSON.stringify({ items: ids.flatMap((id) => (pods[id] ?? podsJson(id, manifest.images[id].digest)).items) }) };
    }
    throw new Error(`예상 못한 호출: ${cmd} ${line}`);
  };
  exec.calls = calls;
  exec.upgradeFiles = upgradeFiles;
  exec.of = (cmd, sub) => calls.filter((c) => c.cmd === cmd && (sub === undefined || c.args.includes(sub)));
  return exec;
}

/** 현재 0.8.5(리비전 11)·직전 0.8.0(리비전 10, 전환 이전)을 가진 운영 상태. 대상은 0.9.0 → 현재(0.8.5) 에서 올린다. */
const HIST_BASE = [
  { revision: 10, status: 'superseded', description: 'Upgrade complete' },
  { revision: 11, status: 'deployed', description: 'Upgrade complete' },
];
const VALUES_08 = { 11: { release: { version: '0.8.5', commit: 'b'.repeat(40) } } };

/** 체크리스트를 가짜로 바꾼다 — 부른 인자를 기록하고 sections 를 돌려준다. */
function fakeChecklist(sections = {}) {
  const full = { newApps: [], envVars: [], migrations: { added: [], changed: [] }, helmChanges: [], issues: [], ...sections };
  const fn = async (argv, deps) => {
    fn.calls.push({ argv, deps });
    deps.stdout('# 체크리스트\n');
    return { markdown: '# 체크리스트\n', out: '', sections: full };
  };
  fn.calls = [];
  return fn;
}

/** 테스트가 만든 임시 디렉터리 정리 — 테스트마다 끝에(성공·실패 모두) 한꺼번에 지운다(테스트마다 try/finally 를 손으로 쓰지 않는다). */
const cleanups = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});
/** 이 테스트가 끝나면 지워지는 임시 디렉터리. */
function tmpDir(prefix) {
  const dir = makeTmp(prefix);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * 클러스터 명시 위반 목록(빈 배열이면 통과). 모든 helm 호출은 --kube-context + -n, 모든 kubectl 호출은 --context 와
 * -n(또는 --raw 경로의 네임스페이스)을 기대값 그대로 가져야 한다(현재 컨텍스트에 기대지 않는다).
 * 모든 `helm get values` 는 --revision 을 명시한다(생략형은 실패한 마지막 리비전을 돌려줘 「현재」를 잘못 읽는다).
 */
function clusterViolations(cmd, args, { ctx, ns }) {
  const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const where = `${cmd} ${args.join(' ')}`;
  const problems = [];
  if (cmd === 'helm') {
    if (after('--kube-context') !== ctx) problems.push(`--kube-context ${ctx} 아님: ${where}`);
    if (after('-n') !== ns) problems.push(`-n ${ns} 아님: ${where}`);
    if (args[0] === 'get' && !args.includes('--revision')) problems.push(`--revision 없음: ${where}`);
  }
  if (cmd === 'kubectl') {
    if (after('--context') !== ctx) problems.push(`--context ${ctx} 아님: ${where}`);
    if (args.includes('--raw')) {
      if (!after('--raw').startsWith(`/api/v1/namespaces/${ns}/services/`)) problems.push(`--raw 경로의 네임스페이스가 ${ns} 아님: ${where}`);
    } else if (after('-n') !== ns) problems.push(`-n ${ns} 아님: ${where}`);
  }
  return problems;
}

/**
 * main 을 주입 가능한 의존과 함께 부른다. 임시 디렉터리(테스트 끝에 자동 정리)·출력 수집·확인 응답을 한 곳에서 다룬다.
 * exec 는 감싸서 모든 helm·kubectl 호출의 클러스터 명시를 검사한다 — 기대값은 argv 의 --context·--namespace(없으면 기본값)이고,
 * run() 이 끝나면(성공·실패 모두) 위반이 없어야 한다. 던지지 않고 모으는 이유: CLI 가 exec 오류를 삼키는 경로(Secret 점검·프록시·tolerate 등)에서도 위반이 사라지지 않게.
 */
function cli(argv, { exec, download = async () => baseManifest(), checklist = fakeChecklist(), answer = true, confirmThrows = false, tracker = null } = {}) {
  const tmp = tmpDir('release-cli-test-');
  const logs = [];
  const out = [];
  const questions = [];
  const violations = [];
  const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const expected = { ctx: flag('--context', CTX), ns: flag('--namespace', NS) };
  const checkedExec = (cmd, args, opts) => {
    violations.push(...clusterViolations(cmd, args, expected));
    return exec(cmd, args, opts);
  };
  const confirm = async (q) => {
    questions.push(q);
    if (confirmThrows) throw new Error('TTY 가 없다');
    return answer;
  };
  const run = async () => {
    try {
      return await main(argv, { repoRoot: REPO, exec: checkedExec, download, confirm, log: (l) => logs.push(String(l)), stdout: (s) => out.push(String(s)), tmpdir: tmp, checklist, tracker });
    } finally {
      assert.deepEqual(violations, [], '모든 helm·kubectl 호출은 컨텍스트·네임스페이스를 명시한다');
    }
  };
  return { run, logs, out, questions, checklist, tmp, text: () => [...logs, ...out].join('\n') };
}
/** 다운로드 가짜 — 요청한 버전에 따라 0.9.0 이면 새 매니페스트, 그 밖이면 기준 매니페스트. */
const downloadBy = (map) => async (v) => map[v] ?? null;

/**
 * 가장 흔한 deploy 시나리오: 운영 0.8.5(HIST_BASE·VALUES_08)에서 0.9.0 으로. → `{ exec, ...cli 결과 }`.
 * release 는 makeRelease 옵션을 덧붙인다. 다운로드는 기본이 0.9.0 매니페스트뿐이고, withBase 면 현재 0.8.5 의 기준 매니페스트도 준다
 * (기준이 없으면 「새 앱 확인 불가」 ⚠ 로 확인을 묻는 경로라 시나리오마다 그대로 고른다).
 */
function deployCli(args = ['--yes'], { release = {}, withBase = false, ...opts } = {}) {
  const exec = makeRelease({ history: HIST_BASE, values: VALUES_08, ...release });
  const download = downloadBy({ '0.9.0': manifest09(), ...(withBase ? { '0.8.5': baseManifest() } : {}) });
  return { exec, ...cli(['deploy', '0.9.0', ...args], { exec, download, ...opts }) };
}

// ---------------------------------------------------------------- deploy

test('deploy: helm upgrade 인자(컨텍스트·네임스페이스·wait·description·values 두 개, --atomic 없음)와 임시 디렉터리 정리', async () => {
  const { exec, ...t } = deployCli(['--yes'], { withBase: true });
  await t.run();
  const [up] = exec.of('helm', 'upgrade');
  const a = up.args;
  assert.deepEqual(a.slice(0, 3), ['upgrade', '--install', 'smart-workplace']);
  assert.ok(a[3].endsWith(join('deploy', 'helm')), '차트는 추출한 디렉터리');
  assert.ok(a[3].startsWith(t.tmp), '작업 트리가 아니라 임시 디렉터리의 차트');
  assert.equal(a.filter((x) => x === '-f').length, 2);
  assert.ok(a[a.indexOf('-f') + 1].endsWith('values.prod.yaml'));
  assert.equal(a[a.indexOf('--wait') ], '--wait');
  assert.equal(a[a.indexOf('--timeout') + 1], '15m');
  assert.equal(a[a.indexOf('--description') + 1], `release 0.9.0 (${SHA.slice(0, 12)})`);
  assert.ok(!a.includes('--atomic'));
  // 이미지 values: repository·digest 와 release 표식만, action 같은 빌드 메타는 없다.
  const imagesJson = JSON.parse(Object.entries(exec.upgradeFiles).find(([k]) => k.endsWith('images.json'))[1]);
  assert.deepEqual(imagesJson.release, { version: '0.9.0', commit: SHA });
  assert.deepEqual(imagesJson.images.api, { repository: manifest09().images.api.repository, digest: manifest09().images.api.digest });
  assert.equal(Object.keys(imagesJson.images).length, catalog.images.length);
  // 태그 지점 차트: git archive v0.9.0 deploy/helm → tar -x -C
  const archive = exec.of('git', 'archive')[0];
  assert.deepEqual(archive.args.filter((x) => !x.includes(t.tmp)), ['archive', '--format=tar', '-o', 'v0.9.0', 'deploy/helm']);
  assert.ok(exec.of('tar')[0].args.includes('-C'));
  assert.deepEqual(readdirSync(t.tmp), [], '임시 디렉터리는 끝에 지운다');
});

test('deploy: --context·--namespace 를 바꾸면 모든 호출이 그 값을 쓴다', async () => {
  const { exec, ...t } = deployCli(['--yes', '--context', 'other-ctx', '--namespace', 'other-ns']);
  await t.run();
  assert.ok(exec.of('helm').length >= 2 && exec.of('kubectl').length >= 7);
});

test('deploy: 체크리스트를 현재→대상 범위로 부르고, 인자 모양은 실제 checklist.mjs 가 받아들인다', async () => {
  const { exec, ...t } = deployCli(['--yes'], { withBase: true });
  await t.run();
  const argv = t.checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v0.8.5');
  assert.equal(argv[argv.indexOf('--to') + 1], 'v0.9.0');
  assert.ok(argv.includes('--manifest') && argv.includes('--base-manifest') && argv.includes('--out'));
  assert.match(t.out.join(''), /체크리스트/, '체크리스트는 주입한 stdout 으로 나온다');
  // 같은 플래그를 실제 checklist.mjs(strict parseArgs)에 — ref 만 실제 저장소의 것으로 바꿔 던지면 플래그 이름 오류가 드러난다.
  const files = { manifest: join(t.tmp, 'm.json'), base: join(t.tmp, 'b.json'), out: join(t.tmp, 'c.md') };
  writeFileSync(files.manifest, JSON.stringify(manifest09()));
  writeFileSync(files.base, JSON.stringify(baseManifest()));
  const real = argv.map((x, i) => {
    const prev = argv[i - 1];
    if (prev === '--from') return 'HEAD~1';
    if (prev === '--to') return 'HEAD';
    if (prev === '--manifest') return files.manifest;
    if (prev === '--base-manifest') return files.base;
    if (prev === '--out') return files.out;
    return x;
  });
  const res = await realChecklist(real, { repoRoot: REPO, exec: defaultExec, log: () => {}, stdout: () => {} });
  assert.ok(res.sections);
});

test('deploy: ⚠ 가 있으면 확인을 묻고 거부하면 helm 을 부르지 않는다', async () => {
  const { exec, ...t } = deployCli([], { checklist: fakeChecklist({ envVars: [{ name: 'NEW_ENV' }] }), answer: false });
  await assert.rejects(t.run(), /중단/);
  assert.equal(t.questions.length, 1);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  assert.equal(exec.of('git', 'archive').length, 0);
  assert.deepEqual(readdirSync(t.tmp), [], '거부해도 임시 디렉터리를 지운다');
});

test('deploy: ⚠ 가 있어도 --yes 면 묻지 않고, ⚠ 가 없으면 --yes 없이도 묻지 않는다', async () => {
  for (const [args, sections] of [[['--yes'], { migrations: { added: [{ file: 'V1__a.sql' }], changed: [] } }], [[], {}]]) {
    const { exec, ...t } = deployCli(args, { withBase: true, checklist: fakeChecklist(sections), confirmThrows: true });
    await t.run();
    assert.equal(t.questions.length, 0);
    assert.equal(exec.of('helm', 'upgrade').length, 1);
  }
});

test('deploy: 같은 버전 재반영은 「이미 반영됨」으로 거부하고 --force 로만 진행한다', async () => {
  const same = { 11: { release: { version: '0.9.0', commit: SHA } } };
  const exec = makeRelease({ history: HIST_BASE, values: same });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t.run(), /이미 반영/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  const exec2 = makeRelease({ history: HIST_BASE, values: same });
  const t2 = cli(['deploy', '0.9.0', '--yes', '--force'], { exec: exec2, download: downloadBy({ '0.9.0': manifest09() }) });
  await t2.run();
  assert.equal(exec2.of('helm', 'upgrade').length, 1);
});

test('deploy: 실패한 반영 뒤 같은 버전 재시도는 막히지 않고, 체크리스트는 실패한 버전이 아니라 운영 중인 deployed 버전 기준', async () => {
  const exec = makeRelease({ history: HIST_FAILED, values: VALUES_FAILED });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': manifest09(), '0.8.5': baseManifest() }) });
  await t.run();
  assert.equal(exec.of('helm', 'upgrade').length, 1, '「이미 반영됨」으로 거부하지 않는다');
  const argv = t.checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v0.8.5', 'from 은 deployed 리비전 2 의 릴리스');
  assert.equal(argv[argv.indexOf('--to') + 1], 'v0.9.0');
  // 현재 릴리스를 읽은 get values 는 모두 deployed 리비전(2)을 명시한다.
  const gets = exec.of('helm', 'get').map((c) => c.args[c.args.indexOf('--revision') + 1]);
  assert.deepEqual(gets, ['2']);
  assert.deepEqual(readdirSync(t.tmp), []);
  assert.ok(!t.text().includes(SECRET));
});

test('deploy: 정상 배포된(deployed) 리비전이 없으면 운영 릴리스를 알 수 없으므로 --current 가 필요하다', async () => {
  const exec = makeRelease({ history: [{ revision: 1, status: 'failed' }], values: { 1: { release: { version: '0.9.0' } } } });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t.run(), /--current/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  assert.equal(exec.of('helm', 'get').length, 0, 'failed 리비전의 values 를 현재로 읽지 않는다');
});

test('deploy: 현재 릴리스의 매니페스트를 못 받으면(다운로드 오류·404) 새 앱 확인 불가를 알리고 ⚠ 로 취급해 확인을 묻는다 (--yes 면 생략)', async () => {
  const downloads = {
    '다운로드 오류': async (v) => {
      if (v === '0.8.5') throw new Error('GITLAB_TOKEN 이 필요하다');
      return manifest09();
    },
    '404': async (v) => (v === '0.8.5' ? null : manifest09()),
  };
  for (const [name, download] of Object.entries(downloads)) {
    // 거부 → helm 미호출
    const exec = makeRelease({ history: HIST_BASE, values: VALUES_08 });
    const t = cli(['deploy', '0.9.0'], { exec, download, answer: false });
    await assert.rejects(t.run(), /중단/, name);
    assert.match(t.logs.join('\n'), /경고: 현재 릴리스 0\.8\.5 의 매니페스트를 받지 못해 새 앱.*확인이 불가능하다/, name);
    assert.equal(t.questions.length, 1, name);
    assert.match(t.questions[0], /새 앱 확인이 불가능하다/, name);
    assert.equal(exec.of('helm', 'upgrade').length, 0, name);
    assert.ok(!t.checklist.calls[0].argv.includes('--base-manifest'), name);
    // 승인 → 진행
    const exec2 = makeRelease({ history: HIST_BASE, values: VALUES_08 });
    const t2 = cli(['deploy', '0.9.0'], { exec: exec2, download, answer: true });
    await t2.run();
    assert.equal(t2.questions.length, 1, name);
    assert.equal(exec2.of('helm', 'upgrade').length, 1, name);
    // --yes → 묻지 않지만 로그는 남는다
    const exec3 = makeRelease({ history: HIST_BASE, values: VALUES_08 });
    const t3 = cli(['deploy', '0.9.0', '--yes'], { exec: exec3, download, confirmThrows: true });
    await t3.run();
    assert.equal(t3.questions.length, 0, name);
    assert.match(t3.logs.join('\n'), /새 앱.*확인이 불가능하다/, name);
  }
});

test('deploy: release.version 이 없고 --current 도 없으면 거부, --current 가 있으면 그 버전을 현재로 쓴다', async () => {
  const noRelease = { 11: { secrets: { dbPassword: SECRET } } };
  const exec = makeRelease({ history: HIST_BASE, values: noRelease });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t.run(), /--current/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  assert.ok(!t.text().includes(SECRET));
  const exec2 = makeRelease({ history: HIST_BASE, values: noRelease });
  const t2 = cli(['deploy', '0.9.0', '--yes', '--current', '0.8.0'], { exec: exec2, download: downloadBy({ '0.9.0': manifest09(), '0.8.0': baseManifest() }) });
  await t2.run();
  const argv = t2.checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v0.8.0');
});

test('deploy: 반영 뒤 digest 가 어긋나면 종료 1(throw) + rollback 안내, 자동 rollback 은 하지 않는다', async () => {
  const m = manifest09();
  const exec = makeRelease({ history: HIST_BASE, values: VALUES_08, pods: { worker: podsJson('worker', fakeDigest('old:worker')) } });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': m }) });
  await assert.rejects(t.run(), (err) => {
    assert.match(err.message, /worker/);
    assert.match(err.message, /release\.mjs rollback/);
    return true;
  });
  assert.equal(exec.of('helm', 'rollback').length, 0, '자동 롤백 금지');
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('deploy: 준비된 파드가 없거나(롤링 미완) 옛·새 파드가 섞이면 실패', async () => {
  const m = manifest09();
  const mixed = { items: [...podsJson('api', m.images.api.digest).items, ...podsJson('api', fakeDigest('old:api')).items] };
  for (const bad of [podsJson('api', m.images.api.digest, { ready: false }), mixed]) {
    const exec = makeRelease({ history: HIST_BASE, values: VALUES_08, pods: { api: bad } });
    const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': m }) });
    await assert.rejects(t.run(), /api/);
  }
});

test('deploy: 옛 이미지의 응답(index.html·{}·빈 값)과 프록시 오류는 크래시 없이 버전 확인 실패로 판정한다', async () => {
  const cases = [
    { raw: { web: '<!doctype html><html></html>' }, expect: /web.*버전 정보 없음/ },
    { raw: { admin: '<html>' }, expect: /admin.*버전 정보 없음/ },
    { raw: { api: '{}' }, expect: /api.*버전 정보 없음/ },
    { raw: { api: '' }, expect: /api.*버전 정보 없음/ },
    { raw: { web: new Error('kubectl 실패: NotFound') }, expect: /web.*응답을 읽지 못했다/ },
    { raw: { api: JSON.stringify({ app: { version: '0.8.5' } }) }, expect: /api.*0\.8\.5.*0\.9\.0/ },
  ];
  for (const { raw, expect } of cases) {
    const { exec, ...t } = deployCli(['--yes'], { release: { raw } });
    await assert.rejects(t.run(), (err) => {
      assert.match(err.message, expect);
      assert.match(err.message, /release\.mjs rollback/);
      return true;
    });
  }
});

test('deploy: 서비스 프록시 경로(api:9090 actuator/info, web:80·admin:80 version.json)로 읽는다', async () => {
  const { exec, ...t } = deployCli(['--yes']);
  await t.run();
  const raws = exec.of('kubectl', '--raw').map((c) => c.args[c.args.indexOf('--raw') + 1]);
  assert.deepEqual(raws, [
    `/api/v1/namespaces/${NS}/services/api:9090/proxy/actuator/info`,
    `/api/v1/namespaces/${NS}/services/web:80/proxy/version.json`,
    `/api/v1/namespaces/${NS}/services/admin:80/proxy/version.json`,
  ]);
});

test('deploy: helm upgrade 가 새 리비전을 남기며 실패하면 종료 1 + rollback·status 안내, 자동 rollback 없음, 임시 디렉터리 정리 (F1)', async () => {
  const historyAfter = [...HIST_BASE, { revision: 12, status: 'failed', description: 'Upgrade failed' }];
  const { exec, ...t } = deployCli(['--yes'], { release: { failUpgrade: true, historyAfter } });
  await assert.rejects(t.run(), /helm upgrade 실패/);
  assert.equal(exec.of('helm', 'rollback').length, 0);
  const text = t.logs.join('\n');
  assert.match(text, /자동 롤백은 하지 않았다/);
  assert.match(text, /새 리비전 12/);
  assert.match(text, /node deploy\/release\/release\.mjs rollback --context iacloud-prod-public --namespace smart-workplace/);
  assert.match(text, /release\.mjs status/);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('deploy: helm upgrade 가 새 리비전 없이 실패하면 rollback 을 권하지 않고 운영 리비전 그대로임을 알린다 (F1)', async () => {
  const { exec, ...t } = deployCli(['--yes'], { release: { failUpgrade: true, historyAfter: HIST_BASE } });
  await assert.rejects(t.run(), /helm upgrade 실패/);
  const text = t.logs.join('\n');
  assert.match(text, /새 리비전이 만들어지지 않았다 — 운영은 리비전 11 그대로다. rollback 하지 않는다/);
  assert.ok(!/release\.mjs rollback/.test(text), 'rollback 명령을 안내하지 않는다');
  assert.match(text, /release\.mjs status/);
  assert.equal(exec.of('helm', 'rollback').length, 0);
});

test('deploy: 실패 뒤 history 를 못 읽으면 그 사실을 알리고 rollback 이 아니라 status 를 먼저 권한다 (F1)', async () => {
  const { exec, ...t } = deployCli(['--yes'], { release: { failUpgrade: true, historyAfter: new Error('helm history 실패') } });
  await assert.rejects(t.run(), /helm upgrade 실패/);
  const text = t.logs.join('\n');
  assert.match(text, /helm history 를 다시 읽지 못했다/);
  assert.match(text, /rollback 전에 먼저 상태 확인: node deploy\/release\/release\.mjs status/);
  assert.ok(!/release\.mjs rollback/.test(text));
});

test('deploy: 태그 커밋이 매니페스트 커밋과 다르면 반영 전에 거부한다', async () => {
  const { exec, ...t } = deployCli(['--yes'], { release: { tagCommit: '9'.repeat(40) } });
  await assert.rejects(t.run(), /커밋/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
});

test('deploy: 매니페스트의 commit 이 40자 hex 가 아니면(없음·짧음·대문자) 비교를 건너뛰지 않고 거부한다', async () => {
  for (const commit of [undefined, null, '', 'abc123', 'A'.repeat(40), 12345]) {
    const m = manifest09();
    if (commit === undefined) delete m.commit;
    else m.commit = commit;
    const exec = makeRelease({ history: HIST_BASE, values: VALUES_08, manifest: m });
    const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': m }) });
    await assert.rejects(t.run(), /commit.*40자/, String(commit));
    assert.equal(exec.of('helm', 'upgrade').length, 0);
    assert.equal(exec.of('git', 'rev-parse').length, 0, '태그 조회 전에 거부');
    assert.deepEqual(readdirSync(t.tmp), []);
  }
});

test('deploy: --manifest 파일을 쓰면 대상 매니페스트를 내려받지 않고, 버전이 다르면 거부한다', async () => {
  const dir = tmpDir('release-manifest-');
  const file = join(dir, 'm.json');
  const asked = [];
  const download = async (v) => {
    asked.push(v);
    return null;
  };
  writeFileSync(file, JSON.stringify(manifest09()));
  const exec = makeRelease({ history: HIST_BASE, values: VALUES_08 });
  const t = cli(['deploy', '0.9.0', '--yes', '--manifest', file], { exec, download });
  await t.run();
  assert.ok(!asked.includes('0.9.0'));
  assert.equal(exec.of('helm', 'upgrade').length, 1);

  const exec2 = makeRelease({ history: HIST_BASE, values: VALUES_08 });
  const t2 = cli(['deploy', '0.9.1', '--yes', '--manifest', file], { exec: exec2, download });
  await assert.rejects(t2.run(), /릴리스 매니페스트: version\("0\.9\.0"\)이 기대한 릴리스\(v0\.9\.1\)와 다르다/);
});

test('deploy: --manifest 가 JSON 이 아니면 SyntaxError 대신 분명한 오류, 모양이 틀린 매니페스트(schemaVersion·digest)는 helm 전에 거부한다', async () => {
  const dir = tmpDir('release-deploy-bad-manifest-');
  const notJson = join(dir, 'bad.json');
  writeFileSync(notJson, '<html>');
  const exec = makeRelease({ history: HIST_BASE, values: VALUES_08 });
  await assert.rejects(cli(['deploy', '0.9.0', '--yes', '--manifest', notJson], { exec }).run(), (err) => {
    assert.ok(!(err instanceof SyntaxError));
    assert.equal(err.message, '--manifest 파일을 읽지 못했다 (JSON 이 아니다)');
    return true;
  });
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  const noSchema = manifest09();
  delete noSchema.schemaVersion;
  const badDigest = manifest09();
  badDigest.images.api.digest = 'sha256:short';
  for (const [m, expect] of [[noSchema, /릴리스 매니페스트: schemaVersion 은 1 이어야 한다/], [badDigest, /릴리스 매니페스트: images\.api\.digest 가 올바르지 않다/]]) {
    const exec2 = makeRelease({ history: HIST_BASE, values: VALUES_08 });
    await assert.rejects(cli(['deploy', '0.9.0', '--yes'], { exec: exec2, download: downloadBy({ '0.9.0': m }) }).run(), expect);
    assert.equal(exec2.of('helm', 'upgrade').length, 0);
    assert.equal(exec2.of('kubectl').length, 0, 'Secret 점검 전에 거부');
  }
});

test('deploy: 매니페스트가 없으면(패키지 404) 거부, 잘못된 버전 형식은 helm 을 부르기 전에 거부', async () => {
  const exec = makeRelease({ history: HIST_BASE, values: VALUES_08 });
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: async () => null });
  await assert.rejects(t.run(), /매니페스트를 찾지 못했다/);
  await assert.rejects(cli(['deploy', 'v0.9.0'], { exec }).run(), /잘못된 버전/);
  await assert.rejects(cli(['deploy'], { exec }).run(), /버전이 필요/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
});

// ---------------------------------------------------------------- rollback

const HIST_ROLLBACK = [
  { revision: 10, status: 'superseded', description: 'Upgrade complete' },
  { revision: 11, status: 'superseded', description: 'Upgrade complete' },
  { revision: 12, status: 'deployed', description: 'Upgrade complete' },
];
const VALUES_ROLLBACK = {
  10: { secrets: { dbPassword: SECRET } },
  11: { release: { version: '0.8.5', commit: 'b'.repeat(40) }, secrets: { dbPassword: SECRET } },
  12: { release: { version: '0.9.0', commit: SHA }, secrets: { dbPassword: SECRET } },
};

test('rollback: 현재 바로 앞 리비전으로 helm rollback --wait --timeout 15m, 대상·현재를 출력한다', async () => {
  const exec = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const t = cli(['rollback', '--yes'], { exec });
  await t.run();
  const [rb] = exec.of('helm', 'rollback');
  assert.deepEqual(rb.args.slice(0, 3), ['rollback', 'smart-workplace', '11']);
  assert.equal(rb.args[rb.args.indexOf('--timeout') + 1], '15m');
  assert.ok(rb.args.includes('--wait'));
  assert.match(t.logs.join('\n'), /되돌릴 대상: 리비전 11 \(0\.8\.5 b{12}\)/);
  assert.match(t.logs.join('\n'), /현재: 리비전 12 \(0\.9\.0 abcdef012345\)/);
  assert.ok(!t.logs.join('\n').includes('실패한 반영'), '정상 상태에는 실패한 반영 줄이 없다');
  assert.equal(t.questions.length, 0, '--yes 면 묻지 않는다');
  assert.deepEqual(readdirSync(t.tmp), [], '롤백 임시 디렉터리를 지운다');
});

test('rollback: 롤백으로 만들어진 현재(rev12 = Rollback to 10)에서는 대상이 11 이다(왕복 토글) — 출력에도 11', async () => {
  const history = [
    { revision: 10, status: 'superseded', description: 'Upgrade complete' },
    { revision: 11, status: 'superseded', description: 'Upgrade complete' },
    { revision: 12, status: 'deployed', description: 'Rollback to 10' },
  ];
  const values = { ...VALUES_ROLLBACK, 12: { release: { version: '0.8.5', commit: 'b'.repeat(40) } }, 10: { release: { version: '0.8.0', commit: 'a'.repeat(40) } }, 11: { release: { version: '0.9.0', commit: SHA } } };
  const exec = makeRelease({ history, values });
  const t = cli(['rollback', '--yes'], { exec });
  await t.run();
  assert.equal(exec.of('helm', 'rollback')[0].args[2], '11');
  assert.match(t.logs.join('\n'), /되돌릴 대상: 리비전 11 \(0\.9\.0/);
  assert.match(t.logs.join('\n'), /현재: 리비전 12 \(0\.8\.5/);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('rollback: 대상이 전환 이전 리비전이면 --force 없이는 거부, --force 면 경고 후 진행', async () => {
  const history = [
    { revision: 10, status: 'superseded', description: 'Upgrade complete' },
    { revision: 11, status: 'deployed', description: 'Upgrade complete' },
  ];
  const values = { 10: { secrets: { dbPassword: SECRET } }, 11: { release: { version: '0.9.0', commit: SHA } } };
  const exec = makeRelease({ history, values });
  const t = cli(['rollback', '--yes'], { exec });
  await assert.rejects(t.run(), /전환 이전.*--force/);
  assert.equal(exec.of('helm', 'rollback').length, 0);
  assert.match(t.logs.join('\n'), /전환 이전 — release 정보 없음/);
  assert.deepEqual(readdirSync(t.tmp), [], '거부해도 임시 디렉터리가 남지 않는다');

  const exec2 = makeRelease({ history, values });
  const t2 = cli(['rollback', '--yes', '--force'], { exec: exec2 });
  await t2.run();
  assert.equal(exec2.of('helm', 'rollback')[0].args[2], '10');
  assert.match(t2.logs.join('\n'), /⚠.*전환 이전/);
  assert.deepEqual(readdirSync(t2.tmp), []);
});

test('rollback: 대상→현재 사이에 마이그레이션이 있으면 「스키마는 되돌아가지 않는다」 경고 후 확인, 거부하면 helm 미호출', async () => {
  const exec = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const checklist = fakeChecklist({ migrations: { added: [{ file: 'V300__new_table.sql', version: 300, summary: '' }], changed: ['V12__edited.sql'] } });
  const t = cli(['rollback'], { exec, checklist, answer: false });
  await assert.rejects(t.run(), /중단/);
  const argv = checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v0.8.5', '대상(옛)이 from');
  assert.equal(argv[argv.indexOf('--to') + 1], 'v0.9.0', '현재(새)가 to');
  assert.match(t.logs.join('\n'), /⚠.*V300__new_table\.sql.*V12__edited\.sql.*되돌아가지 않는다/s);
  assert.equal(t.questions.length, 1);
  assert.equal(exec.of('helm', 'rollback').length, 0);
  assert.deepEqual(readdirSync(t.tmp), [], '확인을 거부해도 임시 디렉터리를 지운다');
});

test('rollback: 마이그레이션이 없으면 경고 없이(확인만) 진행, 체크리스트를 못 만들면 일반 경고', async () => {
  const exec = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const t = cli(['rollback'], { exec, answer: true });
  await t.run();
  assert.ok(!t.logs.join('\n').includes('⚠'));
  assert.equal(t.questions.length, 1, '--yes 없으면 롤백 확인은 항상 묻는다');
  assert.deepEqual(readdirSync(t.tmp), []);

  const failing = async () => {
    throw new Error('git 실패');
  };
  const exec2 = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const t2 = cli(['rollback', '--yes'], { exec: exec2, checklist: failing });
  await t2.run();
  assert.match(t2.logs.join('\n'), /⚠.*확인하지 못했다.*되돌아가지 않는다/s);
  assert.deepEqual(readdirSync(t2.tmp), [], '체크리스트가 실패해도 임시 디렉터리를 지운다');
});

test('rollback: 되돌아갈 리비전이 없으면 거부', async () => {
  const exec = makeRelease({ history: [{ revision: 1, status: 'deployed', description: 'Install complete' }], values: { 1: { release: { version: '0.9.0' } } } });
  const t = cli(['rollback', '--yes'], { exec });
  await assert.rejects(t.run(), /되돌아갈 리비전이 없다/);
});

test('rollback: 실패한 첫 설치([1 failed])처럼 복구할 정상 리비전이 전혀 없으면 거부', async () => {
  const exec = makeRelease({ history: [{ revision: 1, status: 'failed', description: 'Install failed' }], values: { 1: { release: { version: '0.9.0' } } } });
  const t = cli(['rollback', '--yes'], { exec });
  await assert.rejects(t.run(), /되돌아갈 리비전이 없다/);
  assert.equal(exec.of('helm', 'rollback').length, 0);
});

// 실패한 upgrade --wait 뒤의 Helm 이력: 새 리비전은 failed, 직전 리비전은 deployed 그대로.
const VALUES_FAILED = {
  1: { release: { version: '0.8.0', commit: 'a'.repeat(40) }, secrets: { dbPassword: SECRET } },
  2: { release: { version: '0.8.5', commit: 'b'.repeat(40) }, secrets: { dbPassword: SECRET } },
  3: { release: { version: '0.9.0', commit: SHA }, secrets: { dbPassword: SECRET } },
};
const HIST_FAILED = [
  { revision: 1, status: 'superseded', description: 'Upgrade complete' },
  { revision: 2, status: 'deployed', description: 'Upgrade complete' },
  { revision: 3, status: 'failed', description: 'Upgrade "smart-workplace" failed: timed out waiting for the condition' },
];

test('rollback: 실패한 반영 뒤([1 superseded, 2 deployed, 3 failed])에는 두 단계 전이 아니라 마지막 정상 리비전 2 로 복구, 마이그레이션 범위는 실패한 버전 기준', async () => {
  const exec = makeRelease({ history: HIST_FAILED, values: VALUES_FAILED });
  const checklist = fakeChecklist({ migrations: { added: [{ file: 'V400__x.sql', version: 400, summary: '' }], changed: [] } });
  const t = cli(['rollback', '--yes'], { exec, checklist });
  await t.run();
  assert.equal(exec.of('helm', 'rollback')[0].args[2], '2', '리비전 1 이 아니라 deployed 인 2');
  const text = t.logs.join('\n');
  assert.match(text, /현재: 리비전 2 \(0\.8\.5 b{12}\)/);
  assert.match(text, /실패한 반영: 리비전 3 \(failed, 0\.9\.0 abcdef012345\)/);
  assert.match(text, /되돌릴 대상: 리비전 2 \(0\.8\.5 b{12}\)/);
  // 실패한 시도가 마이그레이션을 돌렸을 수 있다: 대상(0.8.5) → 실패한 시도(0.9.0)
  const argv = checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v0.8.5');
  assert.equal(argv[argv.indexOf('--to') + 1], 'v0.9.0');
  assert.match(text, /⚠.*V400__x\.sql.*되돌아가지 않는다/s);
  assert.deepEqual(readdirSync(t.tmp), []);
  assert.ok(!t.text().includes(SECRET));
});

test('rollback: deployed 가 없는([1 superseded, 2 superseded, 3 failed]) 이력도 가장 높은 superseded(2)로 복구한다', async () => {
  const exec = makeRelease({ history: [{ revision: 1, status: 'superseded' }, { revision: 2, status: 'superseded' }, { revision: 3, status: 'failed' }], values: VALUES_FAILED });
  const t = cli(['rollback', '--yes'], { exec });
  await t.run();
  assert.equal(exec.of('helm', 'rollback')[0].args[2], '2');
  assert.match(t.logs.join('\n'), /현재: 정상 배포된\(deployed\) 리비전이 없다/);
  assert.match(t.logs.join('\n'), /실패한 반영: 리비전 3 \(failed, 0\.9\.0/);
});

test('rollback: 진행 중(pending-upgrade) 시도가 위에 있으면 deployed 리비전을 대상으로 하되 helm 이 거부할 수 있다고 알리고 helm 에는 넘긴다', async () => {
  const exec = makeRelease({ history: [{ revision: 2, status: 'deployed' }, { revision: 3, status: 'pending-upgrade' }], values: VALUES_FAILED });
  const t = cli(['rollback', '--yes'], { exec });
  await t.run();
  assert.equal(exec.of('helm', 'rollback')[0].args[2], '2');
  assert.match(t.logs.join('\n'), /실패한 반영: 리비전 3 \(pending-upgrade/);
  assert.match(t.logs.join('\n'), /⚠.*pending-upgrade.*거부할 수 있다/);
});

test('rollback: TTY 가 없어 확인할 수 없으면(--yes 없음) helm 을 부르지 않는다', async () => {
  const exec = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const t = cli(['rollback'], { exec, confirmThrows: true });
  await assert.rejects(t.run(), /TTY/);
  assert.equal(exec.of('helm', 'rollback').length, 0);
});

// ---------------------------------------------------------------- status

test('status: 리비전·릴리스와 앱별 표(원 빌드 버전·manifest digest 앞 19자·일치)를 stdout 으로 낸다', async () => {
  const m = manifest09();
  const exec = makeRelease({ history: [{ revision: 12, status: 'deployed', description: 'Upgrade complete' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } }, pods: { db: podsJson('db', fakeDigest('old:db')) } });
  const asked = [];
  const t = cli(['status'], { exec, download: async (v) => (asked.push(v), m) });
  await t.run();
  const text = t.out.join('');
  assert.deepEqual(asked, ['0.9.0'], 'release.version 으로 매니페스트를 받는다');
  assert.match(text, /리비전: 12 \(deployed\) — Upgrade complete/);
  assert.match(text, /릴리스: 0\.9\.0 \(abcdef012345\)/);
  assert.match(text, new RegExp(`\\| api \\| 0\\.9\\.0 \\| ${m.images.api.digest.slice(0, 19)} \\| 일치 \\|`));
  assert.match(text, new RegExp(`\\| db \\| 0\\.9\\.0 \\| ${m.images.db.digest.slice(0, 19)} \\| 불일치 \\|`));
});

test('status: 실패한 반영이 위에 얹혀도 운영 중인 deployed 리비전·릴리스를 보이고 실패한 리비전은 ⚠ 로 알린다', async () => {
  const m = baseManifest();
  m.version = '0.8.5';
  const exec = makeRelease({ history: HIST_FAILED, values: VALUES_FAILED, manifest: m });
  const asked = [];
  const t = cli(['status'], { exec, download: async (v) => (asked.push(v), m) });
  await t.run();
  const text = t.out.join('');
  assert.match(text, /리비전: 2 \(deployed\)/);
  assert.match(text, /릴리스: 0\.8\.5 \(b{12}\)/);
  assert.match(text, /⚠ 리비전 3 \(failed\) 반영 실패 — 새 리소스 일부가 이미 적용됐을 수 있다/);
  assert.match(text, /시도한 release 0\.9\.0/);
  assert.deepEqual(asked, ['0.8.5'], '운영 중인 릴리스의 매니페스트를 받는다');
  assert.ok(!t.text().includes(SECRET));
});

test('status: 진행 중(pending-upgrade) 시도도 ⚠ 로 알린다', async () => {
  const exec = makeRelease({ history: [{ revision: 2, status: 'deployed' }, { revision: 3, status: 'pending-upgrade' }], values: VALUES_FAILED });
  const t = cli(['status'], { exec, download: async () => null });
  await t.run();
  assert.match(t.out.join(''), /리비전: 2 \(deployed\)[\s\S]*⚠ .*리비전 3 \(pending-upgrade/);
});

test('status: --manifest 파일의 버전이 운영 릴리스와 다르면 ⚠ 를 내고 표는 그대로 그린다', async () => {
  const dir = tmpDir('release-status-manifest-');
  const file = join(dir, 'm.json');
  const m = manifest09();
  writeFileSync(file, JSON.stringify(m));
  const exec = makeRelease({ history: HIST_FAILED, values: VALUES_FAILED, manifest: m });
  const t = cli(['status', '--manifest', file], { exec });
  await t.run();
  const text = t.out.join('');
  assert.match(text, /⚠ --manifest 의 버전\(0\.9\.0\)이 운영 릴리스\(0\.8\.5\)와 다르다/);
  assert.match(text, /\| api \| 0\.9\.0 \|/, '그래도 표는 그린다');

  // 같은 버전이면 경고 없음
  const ok = makeRelease({ history: [{ revision: 12, status: 'deployed' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } }, manifest: m });
  const t2 = cli(['status', '--manifest', file], { exec: ok });
  await t2.run();
  assert.ok(!t2.out.join('').includes('⚠'));
});

test('status: 매니페스트를 못 받으면(토큰 없음) 경고만 내고 실행 중인 digest 로 표를 채운다', async () => {
  const m = manifest09();
  const exec = makeRelease({ history: [{ revision: 12, status: 'deployed', description: 'x' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } }, manifest: m });
  const t = cli(['status'], { exec, download: async () => { throw new Error('CI_API_V4_URL 과 CI_PROJECT_ID 환경 변수가 필요하다'); } });
  await t.run();
  assert.match(t.logs.join('\n'), /경고: .*매니페스트를 받지 못해/);
  const text = t.out.join('');
  assert.match(text, new RegExp(`\\| api \\| - \\| ${m.images.api.digest.slice(0, 19)} \\| - \\|`));
  assert.equal(text.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('원 빌드')).length, catalog.images.length, '카탈로그의 모든 앱');
});

test('status: 전환 이전 리비전(release 없음)이면 릴리스 없음 + 매니페스트 조회 없이 실행 digest 만', async () => {
  const exec = makeRelease({ history: [{ revision: 5, status: 'deployed', description: 'Upgrade complete' }], values: { 5: { secrets: { dbPassword: SECRET } } } });
  const asked = [];
  const t = cli(['status'], { exec, download: async (v) => (asked.push(v), null) });
  await t.run();
  assert.deepEqual(asked, []);
  assert.match(t.out.join(''), /릴리스: 없음/);
});

// ---------------------------------------------------------------- 공통

test('어떤 서브커맨드의 출력·로그·오류에도 helm values 의 비밀값이 없다', async () => {
  const seen = [];
  const m = manifest09();
  const scenarios = [
    ['deploy', ['deploy', '0.9.0', '--yes', '--current', '0.8.0']],
    ['rollback', ['rollback', '--yes']],
    ['status', ['status']],
  ];
  for (const [name, argv] of scenarios) {
    const values = { ...VALUES_ROLLBACK, 11: { release: { version: '0.8.5', commit: 'b'.repeat(40) }, secrets: { dbPassword: SECRET } } };
    const exec = makeRelease({ history: HIST_ROLLBACK, values, pods: name === 'deploy' ? { worker: podsJson('worker', fakeDigest('old')) } : {} });
    const t = cli(argv, { exec, download: downloadBy({ '0.9.0': m, '0.8.5': baseManifest(), '0.8.0': baseManifest() }) });
    await t.run().catch((err) => seen.push(err.message));
    seen.push(t.text());
  }
  assert.ok(seen.length >= 3);
  for (const s of seen) assert.ok(!s.includes(SECRET), s);
});

test('helm 출력이 JSON 이 아니어도 오류 메시지에 원문(비밀값)을 싣지 않는다', async () => {
  const exec = (cmd, args) => {
    if (args[0] === 'history') return { stdout: JSON.stringify([{ revision: 1, status: 'deployed' }]) };
    if (args[0] === 'get') return { stdout: `not json ${SECRET}` };
    throw new Error('예상 못한 호출');
  };
  const t = cli(['deploy', '0.9.0', '--yes'], { exec });
  await assert.rejects(t.run(), (err) => {
    assert.ok(!err.message.includes(SECRET));
    assert.match(err.message, /JSON 이 아니다/);
    return true;
  });
});

test('알 수 없는 서브커맨드·옵션은 사용법과 함께 거부', async () => {
  const exec = makeRelease();
  await assert.rejects(cli([], { exec }).run(), /사용법/);
  await assert.rejects(cli(['frobnicate'], { exec }).run(), /사용법/);
  await assert.rejects(cli(['status', '--bogus'], { exec }).run(), /bogus/);
  assert.equal(exec.calls.length, 0);
});

test('기본 컨텍스트는 iacloud-prod-public, 네임스페이스는 smart-workplace', async () => {
  const exec = makeRelease({ history: [{ revision: 1, status: 'deployed', description: 'x' }], values: { 1: { release: { version: '0.9.0' } } } });
  const t = cli(['status'], { exec, download: async () => manifest09() });
  await t.run();
  assert.ok(exec.of('helm', 'history')[0].args.join(' ').includes(`-n ${NS} --kube-context ${CTX}`));
  assert.ok(exec.of('kubectl')[0].args.slice(0, 2).join(' ') === `--context ${CTX}`);
});

// ---------------------------------------------------------------- 최종 리뷰 보완 (F2~F12)

test('F2: 위치 인자는 엄격하다 — rollback·status 는 0개, deploy 는 1개, 남는 인자는 helm·kubectl 호출 전에 거부', async () => {
  for (const argv of [['rollback', '14', '--yes'], ['status', 'extra'], ['deploy', '0.9.0', '0.9.1', '--yes'], ['deploy', '0.9.0', 'x']]) {
    const exec = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
    await assert.rejects(cli(argv, { exec }).run(), /인자/, argv.join(' '));
    assert.equal(exec.calls.length, 0, `${argv.join(' ')} — 어떤 외부 명령도 부르지 않는다`);
  }
});

test('F3: 필수 Secret 이 없으면 확인·upgrade 전에 거부한다', async () => {
  for (const missing of ['smart-workplace-secrets', 'dockerhub-pull', 'genia-works-internal-tls']) {
    const { exec, ...t } = deployCli([], { release: { secrets: { [missing]: null } }, withBase: true, checklist: fakeChecklist({ envVars: [{ name: 'X' }] }) });
    await assert.rejects(t.run(), (err) => {
      assert.ok(err.message.includes(missing));
      assert.match(err.message, /미리 있어야 하는 Secret/);
      assert.ok(!err.message.includes(SECRET));
      return true;
    });
    assert.equal(t.questions.length, 0, '확인 질문 전에 거부');
    assert.equal(t.checklist.calls.length, 0);
    assert.equal(exec.of('helm', 'upgrade').length, 0);
  }
});

test('F3: smart-workplace-secrets 가 아직 Helm 소유면 인계 절차를 안내하며 거부한다', async () => {
  const secrets = { 'smart-workplace-secrets': { name: 'smart-workplace-secrets', annotations: { 'helm.sh/resource-policy': 'keep', 'meta.helm.sh/release-name': 'smart-workplace', 'meta.helm.sh/release-namespace': NS } } };
  const { exec, ...t } = deployCli(['--yes'], { release: { secrets } });
  await assert.rejects(t.run(), /README 「Secret 인계」 2단계\(소유 표시 제거\)를 먼저 실행한다/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('F3: Secret 이 모두 있고 Helm 소유가 아니면 진행하고, metadata 만 읽는다(-o json·yaml 금지, 값 미노출)', async () => {
  const { exec, ...t } = deployCli(['--yes']);
  await t.run();
  const secretCalls = exec.of('kubectl', 'secret');
  assert.deepEqual(secretCalls.map((c) => c.args[c.args.indexOf('secret') + 1]), ['smart-workplace-secrets', 'dockerhub-pull', 'genia-works-internal-tls']);
  for (const c of secretCalls) {
    assert.ok(c.args.includes('jsonpath={.metadata}'), c.args.join(' '));
    assert.ok(!c.args.some((a) => a === 'json' || a === 'yaml' || a === '-o=json' || a === '-o=yaml'), `Secret 은 -o json|yaml 로 읽지 않는다: ${c.args.join(' ')}`);
  }
  assert.ok(!t.text().includes(SECRET), 'last-applied 주석의 값이 출력에 새지 않는다');
  // 사전 점검은 upgrade 보다 먼저다.
  const order = exec.calls.map((c) => (c.cmd === 'kubectl' && c.args.includes('secret') ? 'secret' : c.cmd === 'helm' && c.args[0] === 'upgrade' ? 'upgrade' : null)).filter(Boolean);
  assert.equal(order.at(-1), 'upgrade');
  assert.equal(order.indexOf('upgrade'), order.length - 1);
});

test('F4: 태그에 deploy/helm 차트가 없으면(전환 이전 릴리스) 체크리스트·확인 전에 분명히 거부한다', async () => {
  const { exec, ...t } = deployCli([], { release: { chartAtTag: false }, checklist: fakeChecklist({ envVars: [{ name: 'X' }] }) });
  await assert.rejects(t.run(), /v0\.9\.0 에는 저장소 차트가 없다\(전환 이전 릴리스\) — 이 도구로 반영할 수 없다.*deploy\/helm\/README\.md/);
  const [probe] = exec.of('git', 'cat-file');
  assert.deepEqual(probe.args, ['cat-file', '-e', 'v0.9.0:deploy/helm/Chart.yaml']);
  assert.equal(t.checklist.calls.length, 0);
  assert.equal(t.questions.length, 0);
  assert.equal(exec.of('git', 'archive').length, 0, 'git archive 의 raw 오류까지 가지 않는다');
  assert.equal(exec.of('helm', 'upgrade').length, 0);
});

test('F5: status --manifest 에 images 가 없거나 JSON 이 아니면 TypeError 대신 분명한 오류', async () => {
  const dir = tmpDir('release-status-bad-manifest-');
  for (const [name, body, expect] of [['no-images', JSON.stringify({ version: '0.9.0' }), /images 가 없다/], ['array-images', JSON.stringify({ images: [] }), /images 가 없다/], ['null', 'null', /images 가 없다/], ['not-json', '<html>', /JSON 이 아니다/]]) {
    const file = join(dir, `${name}.json`);
    writeFileSync(file, body);
    const exec = makeRelease({ history: [{ revision: 12, status: 'deployed' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } } });
    await assert.rejects(cli(['status', '--manifest', file], { exec }).run(), (err) => {
      assert.ok(!(err instanceof TypeError), name);
      assert.match(err.message, expect, name);
      return true;
    });
  }
});

test('F5: 내려받은 매니페스트에 images 가 없어도 크래시 없이 실행 digest 만 보인다', async () => {
  const exec = makeRelease({ history: [{ revision: 12, status: 'deployed' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } } });
  const t = cli(['status'], { exec, download: async () => ({ version: '0.9.0' }) });
  await t.run();
  assert.match(t.logs.join('\n'), /매니페스트를 받지 못해/);
  assert.equal(t.out.join('').split('\n').filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('원 빌드')).length, catalog.images.length);
});

test('F6: status — 실패한 최신 리비전 ⚠ 문구, 정상 반영된 리비전이 없으면 그 ⚠ 도 낸다', async () => {
  const exec = makeRelease({ history: HIST_FAILED, values: VALUES_FAILED });
  const t = cli(['status'], { exec, download: async () => null });
  const exec2 = makeRelease({ history: [{ revision: 1, status: 'failed', description: 'Install failed' }], values: { 1: { release: { version: '0.9.0', commit: SHA } } } });
  const t2 = cli(['status'], { exec: exec2, download: async () => null });
  await t.run();
  assert.match(t.out.join(''), /⚠ 리비전 3 \(failed\) 반영 실패 — 새 리소스 일부가 이미 적용됐을 수 있다/);
  await t2.run();
  assert.match(t2.out.join(''), /⚠ 정상 반영된 리비전이 없다/);
  assert.match(t2.out.join(''), /리비전: 1 \(failed\)/);
});

test('F7: 반영 확인 중 kubectl 오류는 「업그레이드는 끝났다」로 감싸 status 를 안내한다 (종료 1, 자동 rollback 없음)', async () => {
  const historyAfter = [...HIST_BASE, { revision: 12, status: 'deployed', description: 'Upgrade complete' }];
  const base = makeRelease({ history: HIST_BASE, values: VALUES_08, historyAfter });
  // pods 조회(kubectl get pods)가 RBAC 오류로 죽는 상황
  const exec = (cmd, args, opts) => {
    if (cmd === 'kubectl' && args.includes('pods')) {
      base.calls.push({ cmd, args, opts });
      throw new Error('kubectl get pods 실패: forbidden');
    }
    return base(cmd, args, opts);
  };
  exec.calls = base.calls;
  exec.of = base.of;
  const t = cli(['deploy', '0.9.0', '--yes'], { exec, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t.run(), (err) => {
    assert.match(err.message, /업그레이드는 끝났다\(리비전 12\) — 반영 확인 중 오류: .*forbidden/s);
    assert.match(err.message, /release\.mjs status --context iacloud-prod-public --namespace smart-workplace/);
    return true;
  });
  assert.equal(base.of('helm', 'rollback').length, 0);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('F8: helm history 가 「release: not found」면 빈 이력 — deploy 는 --current 를 요구하고 --install 로 진행, status·rollback 은 「릴리스가 없다」', async () => {
  const notFound = 'helm history smart-workplace 실패 (종료 코드 1)\nError: release: not found';
  const e1 = makeRelease({ historyError: notFound });
  await assert.rejects(cli(['status'], { exec: e1 }).run(), /릴리스가 없다/);
  const e2 = makeRelease({ historyError: notFound });
  await assert.rejects(cli(['rollback', '--yes'], { exec: e2 }).run(), /릴리스가 없다/);
  assert.equal(e2.of('helm', 'rollback').length, 0);
  const e3 = makeRelease({ historyError: notFound });
  const t3 = cli(['deploy', '0.9.0', '--yes'], { exec: e3, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t3.run(), /--current/);
  assert.equal(e3.of('helm', 'upgrade').length, 0);
  // --current 가 있으면 upgrade --install 까지 간다. 그 뒤 history 는 historyAfter 가 없으면 계속 not found 이므로 확인 단계 리비전 조회도 견뎌야 한다.
  const e4 = makeRelease({ historyError: notFound, historyAfter: [{ revision: 1, status: 'deployed' }] });
  const t4 = cli(['deploy', '0.9.0', '--yes', '--current', '0.8.0'], { exec: e4, download: downloadBy({ '0.9.0': manifest09(), '0.8.0': baseManifest() }) });
  await t4.run();
  assert.equal(e4.of('helm', 'upgrade').length, 1);
  assert.ok(e4.of('helm', 'upgrade')[0].args.includes('--install'));
  // 다른 history 오류는 삼키지 않는다.
  await assert.rejects(cli(['status'], { exec: makeRelease({ historyError: 'Kubernetes cluster unreachable' }) }).run(), /unreachable/);
});

test('F10: helm upgrade·rollback 은 자식 stdout 을 stderr 로 돌리는 옵션으로 호출한다 (우리 stdout 은 체크리스트·상태 표 전용)', async () => {
  const { exec, ...t } = deployCli(['--yes']);
  const exec2 = makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK });
  const t2 = cli(['rollback', '--yes'], { exec: exec2 });
  await t.run();
  await t2.run();
  for (const c of [exec.of('helm', 'upgrade')[0], exec2.of('helm', 'rollback')[0]]) {
    assert.equal(c.opts.capture, false);
    assert.equal(c.opts.toStderr, true);
  }
});

test('F10: 실제 defaultExec 의 toStderr 는 자식 stdout 을 부모 stdout 이 아니라 stderr 로 보낸다', () => {
  const buildUrl = new URL('../lib/build.mjs', import.meta.url).href;
  const script = `import { defaultExec } from ${JSON.stringify(buildUrl)}; defaultExec(process.execPath, ['-e', 'console.log("CHILD-OUT")'], { capture: false, toStderr: true });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /CHILD-OUT/);
});

test('F12: 실제 ttyConfirm 은 TTY 가 없으면 승인하지 않고 --yes 를 안내하며 거부한다', async () => {
  for (const stdin of [{ isTTY: false }, {}, { isTTY: undefined }]) {
    await assert.rejects(ttyConfirm('계속할까?', { stdin }), /TTY.*--yes/);
  }
});

// ---------------------------------------------------------------- /code-review 보완 (C1–C9)

test('C1: smart-workplace-secrets 에 helm.sh/resource-policy=keep 주석이 없으면 소유 주석이 없어도 거부한다 (README 1단계 안내)', async () => {
  for (const annotations of [undefined, {}, { 'helm.sh/resource-policy': 'delete' }, { 'kubectl.kubernetes.io/last-applied-configuration': SECRET }]) {
    const secrets = { 'smart-workplace-secrets': { name: 'smart-workplace-secrets', ...(annotations ? { annotations } : {}) } };
    const { exec, ...t } = deployCli(['--yes'], { release: { secrets } });
    await assert.rejects(t.run(), (err) => {
      assert.match(err.message, /helm\.sh\/resource-policy=keep 주석이 없다.*1단계\(keep 주석\)/);
      assert.ok(!err.message.includes(SECRET));
      return true;
    });
    assert.equal(exec.of('helm', 'upgrade').length, 0);
    assert.deepEqual(readdirSync(t.tmp), []);
  }
});

test('C1: keep 주석이 있어도 Helm 소유 주석이 남아 있으면 2단계 안내로 거부, 둘 다 맞으면 통과, 다른 Secret 은 keep 을 요구하지 않는다', async () => {
  const owned = { 'smart-workplace-secrets': { name: 'smart-workplace-secrets', annotations: { 'helm.sh/resource-policy': 'keep', 'meta.helm.sh/release-name': 'smart-workplace' } } };
  const { exec, ...t } = deployCli(['--yes'], { release: { secrets: owned } });
  await assert.rejects(t.run(), /2단계\(소유 표시 제거\)/);
  assert.equal(exec.of('helm', 'upgrade').length, 0);
  // keep 만 있고 소유 주석이 없는 Secret + 주석이 전혀 없는 dockerhub-pull·tls → 통과
  const ok = { 'smart-workplace-secrets': { name: 'smart-workplace-secrets', annotations: { 'helm.sh/resource-policy': 'keep' } }, 'dockerhub-pull': { name: 'dockerhub-pull' }, 'genia-works-internal-tls': { name: 'genia-works-internal-tls' } };
  const { exec: exec2, ...t2 } = deployCli(['--yes'], { release: { secrets: ok } });
  await t2.run();
  assert.equal(exec2.of('helm', 'upgrade').length, 1);
});

test('C2: 정상(deployed) 리비전이 없는 상태의 실패한 첫 설치는 새 리비전이 생겨도 이전 정상 리비전이 있다고 하지 않고 rollback 도 권하지 않는다', async () => {
  const exec = makeRelease({ history: [], values: {}, failUpgrade: true, historyAfter: [{ revision: 1, status: 'failed', description: 'Install failed' }] });
  const t = cli(['deploy', '0.9.0', '--yes', '--current', '0.8.0'], { exec, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t.run(), /helm upgrade 실패/);
  const text = t.logs.join('\n');
  assert.match(text, /새 리비전 1/);
  assert.match(text, /되돌아갈 정상 리비전이 없다/);
  assert.match(text, /다시 반영\(deploy\)/);
  assert.match(text, /release\.mjs status/);
  assert.ok(!/release\.mjs rollback/.test(text), 'rollback 을 권하지 않는다');
  assert.ok(!/직전 정상 리비전은 그대로/.test(text), '정상 리비전이 돈다고 주장하지 않는다');
  assert.equal(exec.of('helm', 'rollback').length, 0);
});

// 되돌리기를 되돌리는 이력: 11(v1.0.0) → 12(v1.1.0) 로 올렸다가 11 로 롤백해 13 이 만들어진 상태.
const HIST_TOGGLE = [
  { revision: 11, status: 'superseded', description: 'Upgrade complete' },
  { revision: 12, status: 'superseded', description: 'Upgrade complete' },
  { revision: 13, status: 'deployed', description: 'Rollback to 11' },
];
const rel = (version) => ({ release: { version, commit: 'c'.repeat(40) } });

test('C3·C4: 대상(rev12 v1.1.0)이 지금(rev13 v1.0.0)보다 새 릴리스면 ⚠ 를 출력하고 확인 문구에 넣고, 마이그레이션은 순방향(v1.0.0→v1.1.0)으로 본다', async () => {
  const exec = makeRelease({ history: HIST_TOGGLE, values: { 11: rel('1.0.0'), 12: rel('1.1.0'), 13: rel('1.0.0') } });
  const checklist = fakeChecklist({ migrations: { added: [{ file: 'V500__added_in_1_1.sql', version: 500, summary: '' }], changed: [] } });
  const t = cli(['rollback'], { exec, checklist, answer: true });
  await t.run();
  assert.equal(exec.of('helm', 'rollback')[0].args[2], '12');
  const warn = '대상 리비전 12 은 지금(1.0.0)보다 새 릴리스 1.1.0 다 — 되돌리기를 되돌리는 것이다';
  assert.ok(t.logs.some((l) => l === `⚠ ${warn}`), `⚠ 줄이 없다: ${t.logs.join(' | ')}`);
  assert.equal(t.questions.length, 1);
  assert.ok(t.questions[0].includes(warn), '확인 문구에 포함');
  assert.match(t.questions[0], /리비전 12 로 롤백할까\?$/);
  const argv = checklist.calls[0].argv;
  assert.equal(argv[argv.indexOf('--from') + 1], 'v1.0.0', '옛(지금 운영)이 from');
  assert.equal(argv[argv.indexOf('--to') + 1], 'v1.1.0', '새(대상)가 to');
  assert.match(t.logs.join('\n'), /1\.0\.0 → 1\.1\.0 사이에 DB 마이그레이션이 있다.*순방향.*V500__added_in_1_1\.sql/s);
  assert.deepEqual(readdirSync(t.tmp), []);
});

test('C3·C4: 대상과 지금이 같은 릴리스면 ⚠ 없이 「같은 릴리스 재적용」 참고만 남기고, 더 옛 릴리스로 가는 일반 롤백에는 어느 쪽도 없다', async () => {
  const history = [{ revision: 11, status: 'superseded' }, { revision: 12, status: 'deployed' }];
  const exec = makeRelease({ history, values: { 11: rel('1.0.0'), 12: rel('1.0.0') } });
  const t = cli(['rollback', '--yes'], { exec });
  await t.run();
  assert.match(t.logs.join('\n'), /참고: 대상 리비전 11 은 지금과 같은 릴리스 1\.0\.0 다 — 같은 릴리스 재적용/);
  assert.ok(!t.logs.join('\n').includes('되돌리기를 되돌리는'));
  const exec2 = makeRelease({ history, values: { 11: rel('1.0.0'), 12: rel('1.1.0') } });
  const t2 = cli(['rollback', '--yes'], { exec: exec2 });
  await t2.run();
  assert.ok(!t2.logs.join('\n').includes('되돌리기를 되돌리는'));
  assert.ok(!t2.logs.join('\n').includes('같은 릴리스 재적용'));
});

test('C5: status — 매니페스트 조회가 404(null)면 「매니페스트 <ver> 없음 — digest 일치는 판정하지 않음」을 로그로 남긴다', async () => {
  const exec = makeRelease({ history: [{ revision: 12, status: 'deployed' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } } });
  const t = cli(['status'], { exec, download: async () => null });
  await t.run();
  assert.ok(t.logs.includes('매니페스트 0.9.0 없음 — digest 일치는 판정하지 않음'), t.logs.join(' | '));
  assert.match(t.out.join(''), /실행 digest 일치/, '표는 그대로 낸다');
});

test('C6: --current 는 쓰는 경우(기록된 운영 릴리스 없음)에만 형식을 검증하고, 무시되는 경우엔 검증 없이 경고만 낸다', async () => {
  // 기록된 릴리스 0.8.5 가 있어 --current 는 무시된다 → 형식이 틀려도 거부하지 않는다.
  const { exec, ...t } = deployCli(['--yes', '--current', 'not-a-version'], { withBase: true });
  await t.run();
  assert.match(t.logs.join('\n'), /경고: --current\(not-a-version\)를 무시하고 기록된 운영 릴리스 0\.8\.5 를 쓴다/);
  assert.equal(exec.of('helm', 'upgrade').length, 1);
  // 기록이 없어 --current 를 쓰는 경우엔 형식 오류를 helm 호출 전에 거부한다.
  const exec2 = makeRelease({ history: HIST_BASE, values: { 11: { secrets: { dbPassword: SECRET } } } });
  const t2 = cli(['deploy', '0.9.0', '--yes', '--current', 'not-a-version'], { exec: exec2, download: downloadBy({ '0.9.0': manifest09() }) });
  await assert.rejects(t2.run());
  assert.equal(exec2.of('helm', 'upgrade').length, 0);
});

test('C7: 파드는 네임스페이스당 한 번(get pods -o json, -l 없음)만 읽고 app 라벨로 묶는다 — deploy 확인과 status 모두', async () => {
  const { exec, ...t } = deployCli(['--yes']);
  await t.run();
  const podCalls = exec.of('kubectl', 'pods');
  assert.equal(podCalls.length, 1);
  assert.deepEqual(podCalls[0].args, ['--context', CTX, '-n', NS, 'get', 'pods', '-o', 'json']);
  // status: 라벨 없는 파드·다른 앱 라벨의 파드는 해당 앱 digest 에 섞이지 않는다.
  const m = manifest09();
  const stray = { items: [{ metadata: { name: 'stray' }, status: { containerStatuses: [{ name: 'api', ready: true, imageID: `docker-pullable://repo/api@${fakeDigest('stray')}` }] } }] };
  const exec2 = makeRelease({ history: [{ revision: 12, status: 'deployed' }], values: { 12: { release: { version: '0.9.0', commit: SHA } } }, pods: { stray } });
  const t2 = cli(['status'], { exec: exec2, download: async () => m });
  await t2.run();
  assert.equal(exec2.of('kubectl', 'pods').length, 1);
  const apiRow = t2.out.join('').split('\n').find((l) => l.startsWith('| api |'));
  assert.match(apiRow, /일치 \|$/, '라벨 없는 파드는 api 의 실행 digest 에 섞이지 않는다');
});

test('C9: VERSION_ENDPOINTS 의 서비스 이름·포트가 차트의 서비스 템플릿(api·web·admin)과 일치한다', () => {
  for (const ep of VERSION_ENDPOINTS) {
    const yaml = readFileSync(join(REPO, 'deploy', 'helm', 'templates', `${ep.service}-service.yaml`), 'utf8');
    assert.match(yaml, new RegExp(`^kind: Service$`, 'm'));
    assert.match(yaml, new RegExp(`^  name: ${ep.service}$`, 'm'), `${ep.service}: metadata.name`);
    assert.match(yaml, new RegExp(`^\\s+- port: ${ep.port}$`, 'm'), `${ep.service}: port ${ep.port}`);
  }
  assert.deepEqual(VERSION_ENDPOINTS.map((e) => e.service).sort(), ['admin', 'api', 'web']);
});

// ---------------------------------------------------------------- WP 버전 연동 (WP-1005)

test('deploy: 반영 확인이 끝나면 WP 버전 v<x.y.z> 를 출시로 바꾼다', async () => {
  const tracker = fakeTracker({ versions: [{ id: 7, name: 'v0.9.0', status: 'UNRELEASED' }] });
  const t = deployCli(['--yes'], { withBase: true, tracker });
  await t.run();
  assert.deepEqual(tracker.calls.filter((c) => c[0] === 'release'), [['release', 7]]);
  assert.match(t.logs.join('\n'), /반영 완료[\s\S]*트래커: v0\.9\.0 출시/);
});

test('deploy: 트래커가 실패해도(권한 등) 반영은 성공으로 끝나고 경고만 남긴다', async () => {
  const tracker = { ...fakeTracker(), listVersions: async () => { throw new Error('GET /versions → HTTP 403'); } };
  const t = deployCli(['--yes'], { withBase: true, tracker });
  assert.deepEqual(await t.run(), { version: '0.9.0', previous: '0.8.5' });
  assert.match(t.logs.join('\n'), /경고: 트래커 출시 처리 실패 — 릴리스는 계속한다 \(GET \/versions → HTTP 403\)/);
});

test('deploy: 반영이 실패하면 출시로 바꾸지 않는다', async () => {
  const tracker = fakeTracker({ versions: [{ id: 7, name: 'v0.9.0', status: 'UNRELEASED' }] });
  const historyAfter = [...HIST_BASE, { revision: 12, status: 'failed', description: 'Upgrade failed' }];
  const t = deployCli(['--yes'], { release: { failUpgrade: true, historyAfter }, tracker });
  await assert.rejects(t.run(), /helm upgrade 실패/);
  assert.equal(tracker.calls.length, 0);
});

test('rollback: 떠난 릴리스(0.9.0)는 출시 취소, 돌아간 릴리스(0.8.5)는 출시로 맞춘다', async () => {
  const tracker = fakeTracker({ versions: [{ id: 1, name: 'v0.8.5', status: 'RELEASED' }, { id: 2, name: 'v0.9.0', status: 'RELEASED' }] });
  const t = cli(['rollback', '--yes'], { exec: makeRelease({ history: HIST_ROLLBACK, values: VALUES_ROLLBACK }), tracker });
  await t.run();
  assert.deepEqual(tracker.calls.filter((c) => c[0] === 'release' || c[0] === 'unrelease'), [['unrelease', 2]], '0.8.5 는 이미 출시라 건드리지 않는다');
  assert.equal(tracker.versions[1].status, 'UNRELEASED');
});

test('rollback: 실패한 반영에서 복구하면 실패한 시도의 버전은 건드리지 않는다(예전에 출시된 버전일 수 있다)', async () => {
  const tracker = fakeTracker({ versions: [{ id: 1, name: 'v0.8.5', status: 'RELEASED' }, { id: 2, name: 'v0.9.0', status: 'RELEASED' }] });
  const t = cli(['rollback', '--yes'], { exec: makeRelease({ history: HIST_FAILED, values: VALUES_FAILED }), tracker });
  await t.run();
  assert.ok(!tracker.calls.some((c) => c[0] === 'release' || c[0] === 'unrelease'));
  assert.equal(tracker.versions[1].status, 'RELEASED');
});

test('rollback: 되돌리기를 되돌리면(0.8.5 → 0.9.0) 옛 릴리스는 출시 취소하지 않고 새 릴리스를 다시 출시로', async () => {
  const history = [
    { revision: 10, status: 'superseded', description: 'Upgrade complete' },
    { revision: 11, status: 'superseded', description: 'Upgrade complete' },
    { revision: 12, status: 'deployed', description: 'Rollback to 10' },
  ];
  const values = { ...VALUES_ROLLBACK, 12: { release: { version: '0.8.5', commit: 'b'.repeat(40) } }, 10: { release: { version: '0.8.0', commit: 'a'.repeat(40) } }, 11: { release: { version: '0.9.0', commit: SHA } } };
  const tracker = fakeTracker({ versions: [{ id: 1, name: 'v0.8.5', status: 'RELEASED' }, { id: 2, name: 'v0.9.0', status: 'UNRELEASED' }] });
  const t = cli(['rollback', '--yes'], { exec: makeRelease({ history, values }), tracker });
  await t.run();
  assert.deepEqual(tracker.calls.filter((c) => c[0] === 'release' || c[0] === 'unrelease'), [['release', 2]]);
});
