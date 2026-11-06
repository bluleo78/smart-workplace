// Gen:iA Code 작업 공간 엔트리포인트 테스트(WP-1296) — Claude Code 이미지의 lib.sh + 이 이미지의 lib-genia.sh 함수를 하나씩, 그리고 bin/entrypoint 전체를 돌려 본다.
// genia 배포 서버는 file:// 폴더(latest.txt + 가짜 tar.gz — 안에 가짜 genia 셸 스크립트)로, gh·npx·curl(맡는 프로젝트 조회만)은 PATH 앞의 가짜로 바꾼다.
// tmux 는 진짜를 테스트마다 격리한 서버(-L)로 쓰고, 플러그인 스크립트는 저장소의 plugins/genia-works/scripts 를 그대로 쓴다 —
// 칸 명령(agent-project 의 genia 분기)과 칸이 물려받는 env 를 진짜로 확인하려는 것이다. 키·로그인 정보는 모두 가짜 값이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repoRoot = join(appDir, '..', '..');
const lib = join(repoRoot, 'apps', 'workplace-agent-claude-code', 'bin', 'lib.sh');
const libGenia = join(appDir, 'bin', 'lib-genia.sh');
const entrypoint = join(appDir, 'bin', 'entrypoint');
const pluginRoot = join(repoRoot, 'plugins', 'genia-works');
const pluginScripts = join(pluginRoot, 'scripts');

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const tmuxTest = (name, fn) => test(name, { skip: !hasTmux && 'tmux 없음' }, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

const CONFIG = {
  agent: { userId: 42, username: 'kodi', tenantId: 3, generation: 7 },
  works: { apiUrl: 'http://127.0.0.1:9/api/v1', mcpUrl: 'http://127.0.0.1:9/mcp' },
  template: { name: 'genia-code', version: '1' },
  config: { model: 'qwen3.8-27b-fp8', queue: 'AI 개발팀' },
  plugins: [],
};

/** 가짜 로그인 정보(auth.json 모양) — 원문이 로그에 나오지 않는지도 이 값으로 본다. */
const LOGIN = '{"genia":{"type":"oauth","access":"fake-access-value","refresh":"fake-refresh-value"}}';

const exe = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

/** 원격 저장소(bare) 하나 — 칸을 띄울 프로젝트 저장소. */
function bareRepo(root) {
  const src = join(root, 'src');
  const bare = join(root, 'remote.git');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'README.md'), 'repo\n');
  const git = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git(src, 'init', '-q');
  git(src, 'add', '.');
  git(src, 'commit', '-q', '-m', 'init');
  git(root, 'clone', '-q', '--bare', src, bare);
  return bare;
}

/**
 * 테스트 하나의 격리 환경 — 홈·/run/genia·/work·가짜 명령·굳힌 플러그인 폴더·가짜 배포 서버(srv)·격리 tmux.
 * 굳힌 플러그인 폴더는 저장소의 진짜 스크립트로 링크한다(gw-agent-projects 도 진짜 — 서버 대신 가짜 curl 이 답한다).
 */
function fixture(t, { env: extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-genia-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['home', 'run', 'work', 'bin', 'out', 'tmp', 'srv', 'opt', 'plugin/scripts', 'plugin/genia']) mkdirSync(d(p), { recursive: true });
  writeFileSync(d('run', 'config.json'), JSON.stringify(CONFIG));
  writeFileSync(d('run', 'agent-key'), 'ak_testkey123\n');
  mkdirSync(d('run', 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(d('run', 'repo-tokens', 'github', 'github.com'), 'ghp_secrettoken\n');
  writeFileSync(d('opt', 'genia-root.crt'), 'GENIA-ROOT\n');
  writeFileSync(d('tmp', 'system.pem'), 'SYSTEM-ROOTS\n');

  exe(d('bin', 'gh'), `#!/bin/sh
printf 'args %s\\n' "$*" >> "$FAKE_OUT/gh.log"
[ "$1 $2" = "auth login" ] && cat >/dev/null
exit 0
`);
  exe(d('bin', 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_OUT/npx.log"
exit 0
`);
  // 가짜 curl — 맡는 프로젝트 조회만 FAKE_OUT/projects.json 으로 답하고, 나머지(배포 서버 file://·마켓플레이스)는 진짜 curl 로 보낸다.
  const realCurl = spawnSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
  exe(d('bin', 'curl'), `#!/bin/sh
for a in "$@"; do
  case "$a" in
    */agent-runtime/me/projects)
      cat "$FAKE_OUT/projects.json"; printf '\\n200'
      exit 0 ;;
  esac
done
exec ${realCurl} "$@"
`);
  // AI 키 — 진짜 gw-agent-projects 가 읽는 자리에 플러그인의 gw-keys 로 놓는다(엔트리포인트의 install_key 가 같은 값을 다시 놓는다).
  spawnSync(join(pluginScripts, 'gw-keys'), ['add', 'kodi'], { input: 'ak_testkey123\n', env: { PATH: process.env.PATH, HOME: d('home') } });

  for (const f of readdirSync(pluginScripts)) symlinkSync(join(pluginScripts, f), d('plugin', 'scripts', f));
  writeFileSync(d('plugin', 'genia', 'index.ts'), '// 굳힌 플러그인 자리\n');
  writeFileSync(d('out', 'projects.json'), '[]');

  const wrapper = d('bin', 'tmux-test');
  exe(wrapper, `#!/bin/sh\nexec tmux -L gwgenia-${process.pid}-${++seq} -f /dev/null "$@"\n`);
  const tmux = (...a) => spawnSync(wrapper, a, { encoding: 'utf8' });
  t.after(() => {
    tmux('kill-server');
    rmSync(root, { recursive: true, force: true });
  });

  const env = {
    PATH: `${d('bin')}:${process.env.PATH}`,
    HOME: d('home'),
    TMPDIR: d('tmp'),
    LANG: 'C.UTF-8',
    GENIA_RUN_DIR: d('run'),
    GENIA_WORK: d('work'),
    GENIA_AGENT_NAME: 'kodi',
    GENIA_AGENT_GENERATION: '7',
    GENIA_WORKS_TENANT: '3',
    GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1',
    GENIA_WORKS_MCP_URL: 'http://127.0.0.1:9/mcp',
    GENIA_DOWNLOAD_URL: `file://${d('srv')}`,
    GENIA_ROOT_CRT: d('opt', 'genia-root.crt'),
    GENIA_SYSTEM_CA: d('tmp', 'system.pem'),
    GENIA_PLUGIN_DIR: d('plugin'),
    DOCKER_HOST: `unix://${d('no-docker.sock')}`,
    PLAYWRIGHT_BROWSERS_PATH: d('work', '.cache', 'ms-playwright'),
    GENIA_BASE_BROWSERS: d('no-base-browsers'),
    GENIA_PLAYWRIGHT_CLI_CORE: d('no-playwright-cli'),
    GENIA_XVFB: d('no-xvfb'), // 시험 기계에 Xvfb 가 있어도 진짜 화면을 띄우지 않는다
    GENIA_DIND_WAIT: '0',
    GENIA_SUPERVISE_INTERVAL: '1',
    GENIA_SKIP_VERSION_CHECK: '1', // 이미지 ENV(Dockerfile) — 칸까지 그대로 가는지 본다
    GW_TMUX: wrapper,
    FAKE_OUT: d('out'),
    ...extra,
  };
  return { root, d, env, tmux, read: (...p) => readFileSync(d(...p), 'utf8') };
}

/**
 * 가짜 배포본 하나를 srv 에 둔다 — tar.gz 안은 폴더 하나(genia-<버전>-linux-x64/)에 가짜 genia 와 genia-root.crt.
 * 가짜 genia 는 --version 에 버전을 내고, 그 밖(칸)에서는 받은 env·인자를 FAKE_OUT/pane-<폴더>.env 에 남기고 기다린다.
 * latest.txt 에는 두 리눅스 키 모두 같은 파일을 적는다(테스트를 돌리는 컴퓨터의 아키텍처와 상관없게). sum 을 주면 그 값을 적는다(불일치 시험).
 * crlf·upper 는 윈도 줄바꿈·대문자 sha 로 적는다(서버가 그렇게 내도 받아야 한다).
 */
function release(f, version, { sum, crlf = false, upper = false } = {}) {
  const stem = `54-genia-${version}-linux-x64`;
  const build = f.d('build', version);
  const top = join(build, `genia-${version}-linux-x64`);
  mkdirSync(top, { recursive: true });
  exe(join(top, 'genia'), `#!/bin/sh
case "$1" in --version) echo "genia-fake ${version}"; exit 0 ;; esac
k=$(basename "$PWD")
{ env | grep -E '^(GENIA_|NODE_EXTRA_CA_CERTS=)' | sort; for a in "$@"; do printf 'arg %s\\n' "$a"; done; } > "$FAKE_OUT/pane-$k.tmp"
mv "$FAKE_OUT/pane-$k.tmp" "$FAKE_OUT/pane-$k.env"
exec sleep 300
`);
  writeFileSync(join(top, 'genia-root.crt'), 'GENIA-ROOT\n');
  const file = `${stem}.tar.gz`;
  const r = spawnSync('tar', ['-czf', f.d('srv', file), '-C', build, `genia-${version}-linux-x64`]);
  assert.equal(r.status, 0, String(r.stderr));
  const real = createHash('sha256').update(readFileSync(f.d('srv', file))).digest('hex');
  const s = upper ? (sum ?? real).toUpperCase() : (sum ?? real);
  const eol = crlf ? '\r\n' : '\n';
  writeFileSync(
    f.d('srv', 'latest.txt'),
    [`desktop-darwin-arm64 57-genia-code-${version}-arm64.dmg ${'0'.repeat(64)}`, `cli-linux-arm64 ${file} ${s}`, `cli-linux-x64 ${file} ${s}`].join(eol) + eol,
  );
  return { stem, file };
}

/** lib.sh + lib-genia.sh 를 읽고 함수(셸 한 줄)를 부른다. */
function callLib(env, script) {
  return spawnSync('bash', ['-c', `. "${lib}" && . "${libGenia}" && ${script}`], { env, encoding: 'utf8' });
}

/** 같은 것을 비동기로 — 같은 프로세스의 가짜 HTTP 서버(마켓플레이스)가 응답할 수 있게. */
function callLibAsync(env, script) {
  return new Promise((resolve) => {
    const c = spawn('bash', ['-c', `. "${lib}" && . "${libGenia}" && ${script}`], { env });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => (stdout += b));
    c.stderr.on('data', (b) => (stderr += b));
    c.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

/** 엔트리포인트를 뒤에서 띄운다 — 끝나기를 기다리는 exited 와 지금까지의 로그. */
function startEntrypoint(t, env) {
  const child = spawn(entrypoint, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return { child, exited, log: () => log };
}

async function until(cond, what, ms = 30000, log = () => '') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(100);
  }
  assert.fail(`기다리다 시간이 지났습니다: ${what}\n${log()}`);
}

const appDirOf = (f) => f.d('work', '.genia-app');
/** 지금까지 돈 감독 회차 수(tick 이 state/supervise-ticks 에 적는다) — 시간 대신 회차를 기다린다. */
const ticks = (f) => {
  try {
    return Number(readFileSync(f.d('work', 'agents', 'kodi', 'state', 'supervise-ticks'), 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
};
const BOOT = 'check_required && prepare_dirs && genia_ca';

// ---------------------------------------------------------------- genia 받기(install_genia)

test('installGenia_downloadsVerifiesAndLinksCurrent', (t) => {
  // 처음 받기 — sha 확인 → 버전 폴더 → current 링크 → 감싸개(~/.local/bin/genia)가 그 실행 파일을 부른다.
  const f = fixture(t);
  const { stem } = release(f, '1.0.0');
  const r = callLib(f.env, `${BOOT} && install_genia && genia --version`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), stem);
  assert.ok(statSync(join(appDirOf(f), stem, 'genia')).mode & 0o100);
  assert.match(r.stdout, /genia-fake 1\.0\.0/);
  assert.match(r.stderr, /Gen:iA Code genia-fake 1\.0\.0/);
  const wrapper = f.read('home', '.local', 'bin', 'genia');
  assert.match(wrapper, new RegExp(`exec "${appDirOf(f)}/current/genia"`));
  assert.match(wrapper, new RegExp(`NODE_EXTRA_CA_CERTS:-${f.d('home', '.genia-node-ca.pem')}`));
  // 받던 임시 폴더는 남기지 않는다
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('genia-dl.')), []);
  assert.deepEqual(readdirSync(appDirOf(f)).filter((n) => n.startsWith('.new.')), []);
});

test('installGenia_skipsDownloadWhenSameVersionPresent', (t) => {
  // 같은 버전이 /work 에 있으면 다시 받지 않는다 — 배포 파일이 서버에서 사라져도 latest.txt 만 읽고 끝난다.
  const f = fixture(t);
  const { stem, file } = release(f, '1.0.0');
  assert.equal(callLib(f.env, `${BOOT} && install_genia`).status, 0);
  rmSync(f.d('srv', file));
  const r = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /받습니다/);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), stem);
});

test('installGenia_discardsDownloadOnChecksumMismatch', (t) => {
  // sha256 이 latest.txt 와 다르면 버린다 — 받아 둔 것이 없으니 실패(1)하고 버전 폴더·임시 폴더를 남기지 않는다.
  const f = fixture(t);
  const { stem } = release(f, '1.0.0', { sum: 'a'.repeat(64) });
  const r = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sha256/);
  assert.match(r.stderr, /Gen:iA Code 를 받지 못했습니다/);
  assert.equal(existsSync(join(appDirOf(f), stem)), false);
  assert.equal(existsSync(join(appDirOf(f), 'current')), false);
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('genia-dl.')), []);
});

test('installGenia_acceptsCrlfLinesAndUppercaseChecksum', (t) => {
  // latest.txt 가 CRLF 줄바꿈·대문자 sha 여도 같은 파일로 알아본다 — CR 을 지우고 소문자로 맞춰 비교한다.
  const f = fixture(t);
  const { stem } = release(f, '1.0.0', { crlf: true, upper: true });
  const r = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), stem);
});

test('installGenia_doesNotRedownloadKnownBadFileUntilServerChanges', (t) => {
  // sha 가 맞지 않은 파일은 .bad 에 적고, latest.txt 의 줄이 그대로면 다시 받지 않는다 — 서버가 줄을 바꾸면(고친 파일) 다시 받는다.
  const f = fixture(t);
  release(f, '1.0.0', { sum: 'b'.repeat(64) });
  const first = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(first.status, 1);
  assert.match(first.stderr, /sha256 이 latest\.txt 와 다릅니다/);
  assert.match(readFileSync(join(appDirOf(f), '.bad'), 'utf8'), /54-genia-1\.0\.0-linux-x64\.tar\.gz b{64}/);
  const again = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /손상돼 있었습니다/);
  assert.doesNotMatch(again.stderr, /받습니다/);
  const { stem } = release(f, '1.0.0');
  const fixed = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), stem);
  assert.equal(existsSync(join(appDirOf(f), '.bad')), false);
});

test('installGenia_replacesWithNewVersionAndPrunesOld', (t) => {
  // 새 버전이 나오면 받아 current 를 바꿔 끼우고, 옛 버전 폴더는 지운다(지금 것 하나만 남긴다).
  const f = fixture(t);
  const old = release(f, '1.0.0');
  assert.equal(callLib(f.env, `${BOOT} && install_genia`).status, 0);
  const next = release(f, '1.1.0');
  const r = callLib(f.env, `${BOOT} && install_genia && genia --version`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), next.stem);
  assert.equal(existsSync(join(appDirOf(f), old.stem)), false);
  assert.deepEqual(readdirSync(appDirOf(f)).sort(), ['current', next.stem].sort());
  assert.match(r.stdout, /genia-fake 1\.1\.0/);
});

test('installGenia_keepsCurrentWhenServerUnreachable', (t) => {
  // 서버에 못 닿아도 받아 둔 current 가 있으면 그것으로 계속한다(경고 한 줄, 0).
  const f = fixture(t);
  const { stem } = release(f, '1.0.0');
  assert.equal(callLib(f.env, `${BOOT} && install_genia`).status, 0);
  const r = callLib({ ...f.env, GENIA_DOWNLOAD_URL: `file://${f.d('no-server')}` }, `${BOOT} && install_genia && genia --version`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /받아 둔 버전/);
  assert.match(r.stdout, /genia-fake 1\.0\.0/);
  assert.equal(readlinkSync(join(appDirOf(f), 'current')), stem);
});

test('installGenia_returnsFailureWithoutCurrentWhenServerUnreachable', (t) => {
  // 서버에도 없고 받아 둔 것도 없으면 1 — 엔트리포인트는 끝내지 않고 감독에서 다시 한다(아래 엔트리포인트 시험).
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && install_genia`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Gen:iA Code 를 받지 못했습니다 — 사내 Gen:iA 서버\(file:\/\//);
  assert.equal(existsSync(f.d('home', '.local', 'bin', 'genia')), false);
});

// ---------------------------------------------------------------- 인증서 묶음(genia_ca)

test('geniaCa_bundlesGeniaRootAloneWithoutLocationCa', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && printf '%s|%s\\n' "$GENIA_CA_CERT" "$NODE_EXTRA_CA_CERTS"`);
  assert.equal(r.status, 0, r.stderr);
  const bundle = f.d('home', '.genia-node-ca.pem');
  assert.equal(r.stdout.trim(), `${bundle}|${bundle}`);
  assert.equal(readFileSync(bundle, 'utf8'), 'GENIA-ROOT\n');
});

test('geniaCa_keepsLocationCaThatAgentProjectWouldOtherwiseDrop', (t) => {
  // agent-project 의 genia 분기가 NODE_EXTRA_CA_CERTS 를 GENIA_CA_CERT 로 덮어도 위치 추가 CA 가 빠지지 않게 둘을 잇는다.
  const f = fixture(t);
  mkdirSync(f.d('run', 'ca'), { recursive: true });
  writeFileSync(f.d('run', 'ca', 'ca.crt'), 'CORP-CA\n');
  const r = callLib(f.env, `check_required && prepare_dirs && setup_ca && genia_ca && printf '%s|%s|%s\\n' "$GENIA_CA_CERT" "$NODE_EXTRA_CA_CERTS" "$SSL_CERT_FILE"`);
  assert.equal(r.status, 0, r.stderr);
  const bundle = f.d('home', '.genia-node-ca.pem');
  assert.equal(r.stdout.trim(), `${bundle}|${bundle}|${f.d('home', '.genia-ca-bundle.pem')}`);
  assert.equal(readFileSync(bundle, 'utf8'), 'GENIA-ROOT\nCORP-CA\n');
});

test('geniaCa_fallsBackToImageRootCertWhenBundleFails', (t) => {
  // 묶음을 못 만들면(인증서 파일 없음) GENIA_CA_CERT 를 이미지의 genia-root.crt 자리로 둔다 — 비우면 agent-project 가 ~/.genia/app 으로 간다.
  const f = fixture(t);
  const missing = f.d('opt', 'missing.crt');
  const r = callLib({ ...f.env, GENIA_ROOT_CRT: missing }, `${BOOT} && printf 'ca=%s\\n' "$GENIA_CA_CERT"`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^ca=${missing}$`, 'm'));
  assert.match(r.stderr, /인증서 묶음을 만들지 못했습니다/);
});

test('bgWait_removesOnlyItsOwnPidFromBgPids', (t) => {
  // 뒤에서 돌린 일이 끝나면 자기 pid 만 BG_PIDS 에서 뺀다 — start_projects 의 다른 일(abort_boot 가 끌 것)은 남는다.
  const f = fixture(t);
  const r = callLib(f.env, 'BG_PIDS=" 111 222"; bg_wait sh -c "exit 3"; rc=$?; printf "rc=%s pids=%s\\n" "$rc" "$BG_PIDS"');
  assert.match(r.stdout, /^rc=3 pids=111 222 $/m);
});

// ---------------------------------------------------------------- 로그인 정보(seed_login)

test('seedLogin_copiesOnFirstBootKeepsOnSameVersionAndReplacesOnNewVersion', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  const run = (version) => callLib({ ...f.env, GENIA_LOGIN_VERSION: version }, 'check_required && prepare_dirs && use_plugin && genia_env && seed_login');
  const auth = f.d('work', 'agents', 'kodi', 'genia-agent', 'auth.json');
  const mark = f.d('work', 'agents', 'kodi', 'state', 'login-version');

  // 처음 — 600 으로 복사하고 표식을 적는다. 원문은 로그에 없다.
  const first = run('11');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(auth, 'utf8'), `${LOGIN}\n`); // gw_write_atomic 이 줄바꿈 하나를 붙인다
  assert.equal(statSync(auth).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(auth)).mode & 0o777, 0o700);
  assert.equal(readFileSync(mark, 'utf8').trim(), '11');
  assert.doesNotMatch(first.stdout + first.stderr, /fake-access-value|fake-refresh-value/);

  // 같은 버전 — genia 가 스스로 갱신한 보관본을 옛 Secret 값으로 덮지 않는다.
  writeFileSync(auth, '{"genia":{"type":"oauth","access":"refreshed-by-genia"}}');
  assert.equal(run('11').status, 0);
  assert.match(readFileSync(auth, 'utf8'), /refreshed-by-genia/);

  // 버전이 바뀜(새로 연결) — 덮어쓴다.
  assert.equal(run('12').status, 0);
  assert.equal(readFileSync(auth, 'utf8'), `${LOGIN}\n`); // gw_write_atomic 이 줄바꿈 하나를 붙인다
  assert.equal(readFileSync(mark, 'utf8').trim(), '12');
});

test('seedLogin_removesCopyAndMarkerWhenMountDisappears', (t) => {
  // 연결을 끊으면 runner 가 마운트를 뺀다 — 보관본·표식을 지워 실제로 끊기게 하고, 칸은 띄우되 경고를 남긴다.
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  assert.equal(callLib({ ...f.env, GENIA_LOGIN_VERSION: '11' }, 'check_required && prepare_dirs && use_plugin && genia_env && seed_login').status, 0);
  rmSync(f.d('run', 'login-info'));
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin && genia_env && seed_login');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'genia-agent', 'auth.json')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'state', 'login-version')), false);
  assert.match(r.stderr, /Gen:iA 로그인 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요\(연결 전에는 칸을 띄우지 않습니다\)/);
});

// ---------------------------------------------------------------- 플러그인(use_plugin)

/** 마켓플레이스가 가리킬 원격 저장소 — 태그 genia-works--v0.0.1(genia/ 없음)과 v0.0.2(genia/ 있음), 브랜치 main(= v0.0.2). 스크립트는 진짜 gw-lib.sh 를 쓴다. */
function pluginRepo(f) {
  const src = f.d('plugsrc');
  const bare = f.d('plugin.git');
  const scripts = join(src, 'plugins', 'genia-works', 'scripts');
  mkdirSync(scripts, { recursive: true });
  cpSync(join(pluginScripts, 'gw-lib.sh'), join(scripts, 'gw-lib.sh'));
  exe(join(scripts, 'agent-project'), '#!/bin/sh\nexit 0\n');
  mkdirSync(join(src, 'apps', 'big'), { recursive: true });
  writeFileSync(join(src, 'apps', 'big', 'other.txt'), '받지 않을 파일\n');
  const git = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git(src, 'init', '-q');
  git(src, 'add', '.');
  git(src, 'commit', '-q', '-m', 'old');
  git(src, 'tag', 'genia-works--v0.0.1');
  mkdirSync(join(src, 'plugins', 'genia-works', 'genia'));
  writeFileSync(join(src, 'plugins', 'genia-works', 'genia', 'index.ts'), '// genia 확장\n');
  git(src, 'add', '.');
  git(src, 'commit', '-q', '-m', 'new');
  git(src, 'tag', 'genia-works--v0.0.2');
  git(f.root, 'clone', '-q', '--bare', src, bare);
  return `file://${bare}`;
}

/** genia-works 를 git-subdir 로 내는 가짜 마켓플레이스. */
async function marketplace(t, url, ref) {
  const server = createServer((req, res) =>
    res.end(JSON.stringify({ name: 'genia-works', plugins: [{ name: 'genia-works', source: { source: 'git-subdir', url, path: 'plugins/genia-works', ref } }] })),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const SHOW_PLUGIN = 'check_required && prepare_dirs && use_plugin && echo "GW=$GW_SCRIPTS"';

test('usePlugin_fallsBackToBakedWhenRefHasNoGeniaExtension', async (t) => {
  const f = fixture(t);
  const origin = await marketplace(t, pluginRepo(f), 'genia-works--v0.0.1');
  const r = await callLibAsync({ ...f.env, GENIA_WORKS_API_URL: `${origin}/api/v1` }, SHOW_PLUGIN);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^GW=${f.d('plugin', 'scripts')}$`, 'm'));
  assert.match(r.stderr, /Gen:iA Code 확장이 없어/);
});

test('usePlugin_usesMarketplaceRefWhenItHasGeniaExtension', async (t) => {
  const f = fixture(t);
  const origin = await marketplace(t, pluginRepo(f), 'genia-works--v0.0.2');
  const env = { ...f.env, GENIA_WORKS_API_URL: `${origin}/api/v1` };
  const r = await callLibAsync(env, SHOW_PLUGIN);
  assert.equal(r.status, 0, r.stderr);
  const got = f.d('work', '.genia-plugin', 'genia-works--v0.0.2', 'plugins', 'genia-works');
  assert.match(r.stdout, new RegExp(`^GW=${got}/scripts$`, 'm'));
  assert.ok(existsSync(join(got, 'genia', 'index.ts')));
  // 플러그인 폴더만 받는다(sparse cone — 루트 파일 말고 다른 폴더는 없다)
  assert.equal(existsSync(f.d('work', '.genia-plugin', 'genia-works--v0.0.2', 'apps')), false);
  // 이미 받은 ref 는 다시 받지 않는다 — 원격이 사라져도 받아 둔 것을 쓴다
  rmSync(f.d('plugin.git'), { recursive: true });
  const again = await callLibAsync(env, SHOW_PLUGIN);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, new RegExp(`^GW=${got}/scripts$`, 'm'));
});

test('usePlugin_refetchesMovingRefAndPrunesOtherRefs', async (t) => {
  // 릴리스 태그가 아닌 ref(브랜치)는 매번 다시 받는다 — 첫 커밋에 머물지 않게. 지금 ref 말고 옛 ref 폴더는 지운다.
  const f = fixture(t);
  const url = pluginRepo(f);
  const tagOrigin = await marketplace(t, url, 'genia-works--v0.0.2');
  assert.equal((await callLibAsync({ ...f.env, GENIA_WORKS_API_URL: `${tagOrigin}/api/v1` }, SHOW_PLUGIN)).status, 0);
  assert.ok(existsSync(f.d('work', '.genia-plugin', 'genia-works--v0.0.2')));
  const env = { ...f.env, GENIA_WORKS_API_URL: `${await marketplace(t, url, 'main')}/api/v1` };
  const first = await callLibAsync(env, SHOW_PLUGIN);
  assert.equal(first.status, 0, first.stderr);
  const got = f.d('work', '.genia-plugin', 'main', 'plugins', 'genia-works');
  assert.match(first.stdout, new RegExp(`^GW=${got}/scripts$`, 'm'));
  assert.deepEqual(readdirSync(f.d('work', '.genia-plugin')), ['main']);
  // 브랜치가 움직이면 다음 부팅에 새 커밋을 받는다
  const src = f.d('plugsrc');
  writeFileSync(join(src, 'plugins', 'genia-works', 'genia', 'index.ts'), '// 새 커밋\n');
  const git = (...a) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: src, encoding: 'utf8' }).status, 0);
  git('commit', '-q', '-am', 'move');
  git('push', '-q', f.d('plugin.git'), 'HEAD:main');
  assert.equal((await callLibAsync(env, SHOW_PLUGIN)).status, 0);
  assert.equal(readFileSync(join(got, 'genia', 'index.ts'), 'utf8'), '// 새 커밋\n');
});

test('usePlugin_usesBakedWhenMarketplaceUnreachable', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, SHOW_PLUGIN);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^GW=${f.d('plugin', 'scripts')}$`, 'm'));
  assert.match(r.stderr, /마켓플레이스\(http:\/\/127\.0\.0\.1:9\/claude\/marketplace\.json\)에 닿지 못해/);
});

// ---------------------------------------------------------------- genia 설정(write_genia_settings)

test('writeGeniaSettings_overwritesWithModelTrustAndQuietStartup', (t) => {
  const f = fixture(t);
  const dir = f.d('work', 'agents', 'kodi', 'genia-agent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), '{"defaultModel":"old","stale":true}');
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin && genia_env && write_genia_settings && echo "DIR=$GENIA_CODING_AGENT_DIR"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^DIR=${dir}$`, 'm'));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), {
    defaultProvider: 'genia',
    defaultModel: 'qwen3.8-27b-fp8',
    defaultProjectTrust: 'always',
    quietStartup: true,
  });
  // genia-works MCP 는 확장이 등록한다 — mcp.json 에 손으로 적지 않는다
  assert.equal(existsSync(join(dir, 'mcp.json')), false);
});

test('writeGeniaSettings_loadsSuperpowersExtensionWhenBaked', (t) => {
  // genia 는 Claude 플러그인의 세션 시작 hook 을 돌리지 않는다 — superpowers 의 genia 확장(using-superpowers 안내)을 설정에 싣는다(WP-1336).
  const f = fixture(t);
  const ext = f.d('home', '.genia-superpowers', '.pi', 'extensions', 'superpowers.ts');
  mkdirSync(dirname(ext), { recursive: true });
  writeFileSync(ext, 'export default () => {}\n');
  const r = callLib({ ...f.env, GENIA_SUPERPOWERS_EXT: ext }, 'check_required && prepare_dirs && use_plugin && genia_env && write_genia_settings');
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(join(f.d('work', 'agents', 'kodi', 'genia-agent'), 'settings.json'), 'utf8'));
  assert.deepEqual(s.extensions, [ext]);
});

// ---------------------------------------------------------------- 이미지·카탈로그

test('dockerfileDoesNotBakeGeniaProgram', () => {
  // 사내 프로그램은 공개 이미지에 넣지 않는다 — 배포 서버 주소·배포본 파일을 Dockerfile 이 받지 않는다. 공용 함수는 Claude 이미지의 것을 COPY.
  const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
  assert.doesNotMatch(dockerfile, /genia-code-server|linux-x64\.tar\.gz/);
  assert.match(dockerfile, /COPY --chmod=755 apps\/workplace-agent-claude-code\/bin\/lib\.sh apps\/workplace-agent-claude-code\/bin\/agent-screen \/opt\/genia\/bin\//);
  assert.match(dockerfile, /COPY plugins\/genia-works\/genia\/ \/opt\/genia\/plugin\/genia-works\/genia\//);
  assert.doesNotMatch(dockerfile, /plugins\/genia-works\/tests|^RUN .*chmod/m);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--", "\/opt\/genia\/bin\/entrypoint"\]/);
  assert.doesNotMatch(dockerfile, /jdt-language-server/);
});

test('dockerfileBakesSameClaudePluginsExceptGeniaWorks', () => {
  // genia 는 Claude Code 에 설치된 플러그인의 스킬·명령을 읽는다 — Claude 이미지와 같은 plugins.lock 으로 superpowers 등을 굳혀
  // 두 실행기의 개발 절차를 한 벌로 맞춘다(WP-1336). genia-works 는 genia 확장으로 따로 싣으므로 받을 때 뺀다(두 번 실리지 않게).
  const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
  const claudeDockerfile = readFileSync(join(appDir, '..', 'workplace-agent-claude-code', 'Dockerfile'), 'utf8');
  const version = (d) => d.match(/^ARG CLAUDE_CODE_VERSION=(\S+)$/m)?.[1];
  assert.ok(version(dockerfile));
  assert.equal(version(dockerfile), version(claudeDockerfile)); // 같은 Claude Code 로 받아야 같은 플러그인 형식이 된다
  assert.match(dockerfile, /COPY apps\/workplace-agent-claude-code\/plugins\.lock \/opt\/genia\/plugins\.lock/);
  assert.match(dockerfile, /install_plugins \/opt\/genia\/plugins\.lock "" genia-works@genia-works/);
  // superpowers 의 genia 확장을 고정 이름으로 가리킨다(엔트리포인트가 설정에 싣는다)
  assert.match(dockerfile, /ln -sfn "\$sp" \/home\/agent\/\.genia-superpowers/);
  // 에이전트 형식이라 genia 가 못 읽는 code-simplifier 는 스킬로 옮겨 ~/.agents/skills 에 둔다
  assert.match(dockerfile, /COPY --chown=1001:1001 apps\/workplace-agent-genia-code\/skills\/ \/home\/agent\/\.agents\/skills\//);
  const skill = readFileSync(join(appDir, 'skills', 'code-simplifier', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: code-simplifier\n/);
  // 옮긴 원본 판이 lock 의 code-simplifier 판과 같아야 한다 — lock 만 올리면 두 실행기의 정리 기준이 갈린다(올리면 스킬도 다시 옮긴다)
  const lock = readFileSync(join(appDir, '..', 'workplace-agent-claude-code', 'plugins.lock'), 'utf8');
  const locked = lock.match(/^(code-simplifier@\S+ \S+)$/m)?.[1];
  assert.ok(locked && skill.includes(`source: ${locked}`), `스킬 원본 판(${locked})을 SKILL.md 에 적고 다시 옮기세요`);
  // 카탈로그: lock 이 바뀌면 이 이미지도 다시 빌드한다
  const catalog = JSON.parse(readFileSync(join(appDir, '..', '..', 'deploy', 'release', 'image-catalog.json'), 'utf8'));
  const entry = catalog.images.find((i) => i.id === 'agent-genia-code');
  assert.ok(entry.paths.includes('apps/workplace-agent-claude-code/plugins.lock'));
});

// ---------------------------------------------------------------- 엔트리포인트 전체(진짜 tmux·플러그인 스크립트)

tmuxTest('entrypoint_launchesGeniaPaneWithEnvAndArgsAndStopsOnSigterm', async (t) => {
  const f = fixture(t);
  release(f, '1.0.0');
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, { ...f.env, GENIA_LOGIN_VERSION: '11' });
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 genia', 30000, e.log);
  const lines = f.read('out', 'pane-WP.env').split('\n');
  const aiDir = f.d('work', 'agents', 'kodi');
  for (const want of [
    `GENIA_CODING_AGENT_DIR=${aiDir}/genia-agent`,
    `NODE_EXTRA_CA_CERTS=${f.d('home', '.genia-node-ca.pem')}`,
    'GENIA_WORKS_AS=kodi',
    `GENIA_WORKS_AGENT_DIR=${aiDir}`,
    'GENIA_WORKS_RUNNER_WAKES=1',
    'GENIA_SKIP_VERSION_CHECK=1',
    'GENIA_WORKS_MCP_URL=http://127.0.0.1:9/mcp',
    'GENIA_WORKS_TENANT=3',
    'GENIA_AGENT_GENERATION=7',
    'arg --approve',
    'arg -e',
    `arg ${f.d('plugin')}`,
    'arg /gw-loop WP --queue "AI 개발팀"',
  ]) {
    assert.ok(lines.includes(want), `${want} 가 없습니다:\n${lines.join('\n')}`);
  }
  // 실행기는 genia 로 적혔고, 로그인은 보관본 자리에, 설정은 매번 새로. Claude 의 ~/.claude.json 은 만들지 않는다.
  assert.match(readFileSync(join(aiDir, 'agent.conf'), 'utf8'), /cli=genia/);
  assert.equal(readFileSync(join(aiDir, 'genia-agent', 'auth.json'), 'utf8'), `${LOGIN}\n`);
  assert.equal(JSON.parse(readFileSync(join(aiDir, 'genia-agent', 'settings.json'), 'utf8')).defaultModel, 'qwen3.8-27b-fp8');
  assert.equal(existsSync(f.d('home', '.claude.json')), false);
  assert.doesNotMatch(e.log(), /fake-access-value|ghp_secrettoken|ak_testkey123/);
  // 부팅 회차는 start_projects 바로 뒤 칸 살피기를 한 번 더 돈다 — 띄운 칸을 다시 띄우거나 실패로 적지 않는다
  await until(() => ticks(f) >= 2, '감독 회차 두 번', 15000, e.log);
  assert.equal((e.log().match(/WP: started/g) ?? []).length, 1, e.log());
  assert.doesNotMatch(e.log(), /WP: (revived|restarted)|WP 칸을 띄우지 못했습니다/);
  await until(() => spawnSync(f.env.GW_TMUX, ['list-windows', '-t', '=kodi', '-F', '#W'], { encoding: 'utf8' }).stdout.includes('events'), '알림 감시 창', 10000, e.log);
  const pids = f.tmux('list-panes', '-a', '-F', '#{pane_pid}').stdout.split('\n').filter(Boolean).map(Number);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.deepEqual(pids.filter(alive), []);
  assert.notEqual(f.tmux('list-sessions').status, 0); // tmux 서버도 끝났다
});

tmuxTest('entrypoint_doesNotLaunchPaneWithoutLoginInfo', async (t) => {
  // 로그인 정보가 없으면 genia 가 칸에서 로그인 선택 화면을 띄우고 멈춘다(11-03 실측) — 칸을 띄우지 않고 경고만, 엔트리포인트는 끝내지 않는다.
  const f = fixture(t);
  release(f, '1.0.0');
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, f.env);
  await until(() => /로그인 정보가 연결되지 않았습니다/.test(e.log()), '로그인 없음 경고', 15000, e.log);
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  assert.equal(e.child.exitCode, null, e.log());
  assert.equal(existsSync(f.d('out', 'pane-WP.env')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'repos', 'WP')), false);
  // 알림 감시 창도 띄우지 않는다 — tmux 세션 자체가 없다
  assert.notEqual(f.tmux('list-sessions').status, 0);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('entrypoint_waitsForGeniaServerWithoutExitingThenLaunches', async (t) => {
  // 배포 서버에 아직 없다 → 끝내지 않고 칸도 띄우지 않는다 → 서버에 생기면 감독이 받아 칸을 띄운다.
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, { ...f.env, GENIA_LOGIN_VERSION: '11' });
  await until(() => /Gen:iA Code 를 받지 못했습니다/.test(e.log()) && ticks(f) >= 2, '받지 못한 채 감독 회차 두 번', 15000, e.log);
  assert.equal((e.log().match(/Gen:iA Code 를 받지 못했습니다/g) ?? []).length >= 2, true, '회차마다 다시 받아 보지 않았습니다');
  assert.equal(e.child.exitCode, null, e.log());
  assert.equal(existsSync(f.d('out', 'pane-WP.env')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'repos', 'WP')), false);
  release(f, '1.0.0');
  await until(() => existsSync(f.d('out', 'pane-WP.env')), '서버가 생긴 뒤 WP 칸', 20000, e.log);
  assert.ok(lstatSync(join(appDirOf(f), 'current')).isSymbolicLink());
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});
