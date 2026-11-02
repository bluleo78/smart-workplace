// 작업 공간 엔트리포인트 테스트(WP-1252) — bin/lib.sh 의 함수를 하나씩, 그리고 bin/entrypoint 전체를 돌려 본다.
// claude·gh·npx 는 PATH 앞의 가짜로 바꾸고, tmux 는 진짜를 테스트마다 격리한 서버(-L)로 쓴다(칸 되살리기·SIGTERM 정리는 tmux 의 실제 동작이라).
// 플러그인 스크립트는 저장소의 plugins/genia-works/scripts 를 그대로 쓴다(서버를 부르는 gw-agent-projects 만 가짜) —
// 엔트리포인트가 플러그인과 실제로 맞물리는지, 칸 안의 claude 가 워크스페이스·generation 을 받는지를 진짜로 확인하려는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const lib = join(appDir, 'bin', 'lib.sh');
const entrypoint = join(appDir, 'bin', 'entrypoint');
const pluginScripts = join(appDir, '..', '..', 'plugins', 'genia-works', 'scripts');
const lockFile = join(appDir, 'plugins.lock');

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const tmuxTest = (name, fn) => test(name, { skip: !hasTmux && 'tmux 없음' }, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

/** plugins.lock 의 「이름@마켓 버전」 — 가짜 `claude plugin list --json` 이 같은 버전을 내게 한다. */
const lockEntries = readFileSync(lockFile, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.trim().split(/\s+/));

const CONFIG = {
  agent: { userId: 42, username: 'kodi', tenantId: 3, generation: 7 },
  works: { apiUrl: 'http://127.0.0.1:9/api/v1', mcpUrl: 'http://127.0.0.1:9/mcp' },
  template: { name: 'claude-code', version: '1' },
  config: { model: 'opus', queue: 'AI 개발팀' },
  plugins: lockEntries.map(([id, version]) => {
    const [name, marketplace] = id.split('@');
    return { marketplace, name, version };
  }),
};

/** 원격 저장소(bare) 하나 — 루트에 Playwright 1.60.0 을 적은 pnpm-lock.yaml 이 있다. */
function bareRepo(root, pw = '1.60.0') {
  const src = join(root, 'src');
  const bare = join(root, 'remote.git');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\npackages:\n\n  '@playwright/test@" + pw + "':\n    resolution: {}\n");
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
 * 테스트 하나의 격리 환경 — 홈·/run/genia·/work·가짜 명령·가짜 플러그인 폴더·격리 tmux.
 * projects: 가짜 서버가 맡는 프로젝트 조회(GET /agent-runtime/me/projects — WP-1275)에 낼 목록. 진짜 gw-agent-projects --assigned 가 가짜 curl 로 이것을 읽는다.
 */
function fixture(t, { projects, pluginVersions = {}, knownUrl = 'http://127.0.0.1:9/claude/marketplace.json', env: extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-entry-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['home/.claude/plugins', 'run', 'work', 'bin', 'out', 'tmp', 'plugin/scripts']) mkdirSync(d(p), { recursive: true });
  writeFileSync(d('run', 'config.json'), JSON.stringify(CONFIG));
  writeFileSync(d('run', 'agent-key'), 'ak_testkey123\n');
  // 저장소 토큰(WP-1268) — runner 가 Secret items 로 꽂는 repo-tokens/<kind>/<host> 파일
  mkdirSync(d('run', 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(d('run', 'repo-tokens', 'github', 'github.com'), 'ghp_secrettoken\n');
  writeFileSync(d('home/.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'genia-works': { source: { source: 'url', url: knownUrl } } }));

  const exe = (path, body) => {
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  };
  // 가짜 claude — plugin 하위 명령은 기록하고 목록을 내며, 그 밖(칸의 work-loop)은 받은 환경·인자를 남기고 기다린다.
  // OAuth 토큰은 값 대신 있는지만 남긴다(테스트 출력에도 원문을 두지 않는다).
  exe(d('bin', 'claude'), `#!/bin/sh
case "$1" in
  plugin)
    printf '%s\\n' "$*" >> "$FAKE_OUT/claude-plugin.log"
    case "$*" in *"\${FAKE_FAIL_PLUGIN:-@@none@@}"*) exit 1 ;; esac
    [ "$2" = list ] && cat "$FAKE_PLUGIN_LIST"
    exit 0 ;;
  --version) echo "2.1.316 (Claude Code)"; exit 0 ;;
esac
k=$(basename "$PWD")
{ env | grep -E '^GENIA_' | sort; [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && echo CLAUDE_CODE_OAUTH_TOKEN=set; for a in "$@"; do printf 'arg %s\\n' "$a"; done; } > "$FAKE_OUT/pane-$k.tmp"
mv "$FAKE_OUT/pane-$k.tmp" "$FAKE_OUT/pane-$k.env"
[ -f "$FAKE_OUT/exit-now" ] && exit 0
exec sleep 300
`);
  exe(d('bin', 'gh'), `#!/bin/sh
printf 'args %s\\n' "$*" >> "$FAKE_OUT/gh.log"
[ "$1 $2" = "auth login" ] && { printf 'stdin %s %s\\n' "$4" "$(cat)" >> "$FAKE_OUT/gh.stdin"; }
exit 0
`);
  // 가짜 npx — 받은 인자를 기록하고, 버전마다 시작 표시를 남긴다. FAKE_NPX_RENDEZVOUS=n 이면 n 개가 시작될 때까지 기다린 결과(npx-seen-<버전>)를
  // 남긴다 — 브라우저 받기가 동시에 도는지(순서대로면 기다리다 시간이 지난다). FAKE_NPX_HANG 이면 오래 붙잡는다(SIGTERM 테스트).
  exe(d('bin', 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_OUT/npx.log"
v=$(printf '%s' "$2" | sed 's/^playwright@//')
: > "$FAKE_OUT/npx-started-$v"
if [ -n "\${FAKE_NPX_RENDEZVOUS:-}" ]; then
  n=100
  while [ "$(ls "$FAKE_OUT" | grep -c '^npx-started-')" -lt "$FAKE_NPX_RENDEZVOUS" ] && [ $n -gt 0 ]; do sleep 0.1; n=$((n - 1)); done
  [ $n -gt 0 ] && : > "$FAKE_OUT/npx-seen-$v"
fi
if [ -n "\${FAKE_NPX_HANG:-}" ]; then
  # 손자 프로세스(npx 와 그 자식 sleep)의 pid 를 남긴다 — SIGTERM 뒤 둘 다 없어졌는지 본다.
  echo $$ >> "$FAKE_OUT/npx-pids"
  sleep 15 &
  echo $! >> "$FAKE_OUT/npx-pids"
  wait
fi
exit 0
`);
  // 가짜 curl — 맡는 프로젝트 조회(…/agent-runtime/me/projects)만 FAKE_OUT/projects.json 으로 답하고, 나머지는 진짜 curl 로 보낸다.
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

  // 가짜 플러그인 폴더 — 저장소의 진짜 스크립트로 링크한다(gw-agent-projects 도 진짜 — 서버 대신 가짜 curl 이 답한다).
  for (const f of readdirSync(pluginScripts)) {
    symlinkSync(join(pluginScripts, f), d('plugin', 'scripts', f));
  }
  writeFileSync(d('out', 'projects.json'), JSON.stringify(projects ?? []));

  const list = lockEntries.map(([id, version]) => ({
    id,
    version: pluginVersions[id] ?? (version === 'latest' ? '0.1.31' : version),
    installPath: id === 'genia-works@genia-works' ? d('plugin') : d('elsewhere', id),
  }));
  writeFileSync(d('out', 'plugins.json'), JSON.stringify(list));

  const wrapper = d('bin', 'tmux-test');
  exe(wrapper, `#!/bin/sh\nexec tmux -L gwentry-${process.pid}-${++seq} -f /dev/null "$@"\n`);
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
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret-value',
    DOCKER_HOST: `unix://${d('no-docker.sock')}`,
    PLAYWRIGHT_BROWSERS_PATH: d('work', '.cache', 'ms-playwright'),
    GENIA_BASE_BROWSERS: d('no-base-browsers'),
    GENIA_DIND_WAIT: '0',
    GENIA_SUPERVISE_INTERVAL: '1',
    GW_TMUX: wrapper,
    FAKE_OUT: d('out'),
    FAKE_PLUGIN_LIST: d('out', 'plugins.json'),
    ...extra,
  };
  return { root, d, env, tmux, read: (...p) => readFileSync(d(...p), 'utf8') };
}

/** lib.sh 를 읽고 함수(셸 한 줄)를 부른다. */
function callLib(env, script) {
  return spawnSync('bash', ['-c', `. "${lib}" && ${script}`], { env, encoding: 'utf8' });
}

/** lib.sh 를 비동기로 — 같은 프로세스의 가짜 HTTP 서버가 응답할 수 있게(spawnSync 는 이벤트 루프를 막는다). */
function callLibAsync(env, script) {
  return new Promise((resolve) => {
    const c = spawn('bash', ['-c', `. "${lib}" && ${script}`], { env });
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

/** 맡은 프로젝트 WP 하나(멤버·저장소 있음)를 내는 목록. */
const oneProject = (url) => [{ projectKey: 'WP', name: 'WP', repositoryUrl: url, repositoryBranch: null }];

/** 세션 kodi 의 칸 — 창 이름·칸 id·죽음 여부·키·pid. */
function panes(tmux) {
  return tmux('list-panes', '-s', '-t', '=kodi', '-F', '#W|#{pane_id}|#{pane_dead}|#{@gw_key}|#{pane_pid}')
    .stdout.split('\n')
    .filter(Boolean)
    .map((l) => {
      const [win, id, dead, key, pid] = l.split('|');
      return { win, id, dead: dead === '1', key, pid: Number(pid) };
    });
}

// ---------------------------------------------------------------- 설정 파일

test('writesSettingsFromConfig', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('home', '.claude', 'settings.json'), '{"model":"haiku","stale":true}');
  const r = callLib(f.env, 'check_required && update_plugins && resolve_plugin_scripts && write_settings');
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(f.read('home', '.claude', 'settings.json'));
  assert.equal(s.model, 'opus');
  assert.equal(s.stale, undefined); // 매번 덮어쓴다 — 옛 값이 남지 않는다
  assert.equal(Object.keys(s.enabledPlugins).length, 8);
  assert.ok(Object.values(s.enabledPlugins).every((v) => v === true));
  assert.equal(s.enabledPlugins['superpowers@anthropic-plugin-directory'], true);
  assert.deepEqual(s.extraKnownMarketplaces['genia-works'].source, { source: 'url', url: 'http://127.0.0.1:9/claude/marketplace.json' });
  // 덮어써도 claude-plugins-official(빌드 때 더한 마켓플레이스)이 남아야 LSP 플러그인이 사라지지 않는다
  assert.deepEqual(s.extraKnownMarketplaces['claude-plugins-official'].source, { source: 'github', repo: 'anthropics/claude-plugins-official' });
  assert.equal(s.skipDangerousModePermissionPrompt, true);
  assert.equal(s.pluginConfigs['genia-works@genia-works'].options.server_url, 'http://127.0.0.1:9/mcp');
});

test('keepsBakedMarketplaceWhenNewOriginUnreachable', (t) => {
  const f = fixture(t, { knownUrl: 'https://baked.example/claude/marketplace.json' });
  const r = callLib(f.env, 'check_required && update_plugins && resolve_plugin_scripts && write_settings');
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(f.read('home', '.claude', 'settings.json'));
  // 새 주소에 닿지 못하면 굳힌 주소를 그대로 둔다 — 설정만 바꾸면 그 마켓플레이스가 목록에서 사라진다(실측)
  assert.equal(s.extraKnownMarketplaces['genia-works'].source.url, 'https://baked.example/claude/marketplace.json');
  assert.doesNotMatch(f.read('out', 'claude-plugin.log'), /marketplace remove/);
});

// 원하는 주소에 닿으면 굳힌 주소와 같든 다르든 지우고 다시 더한 뒤 genia-works 를 받는다(멱등 — 늘 서버의 버전으로 맞춘다).
for (const [name, baked] of [
  ['readdsMarketplaceWhenOriginDiffersAndReachable', () => 'https://baked.example/claude/marketplace.json'],
  ['readdsMarketplaceWhenOriginSameAndReachable', (origin) => `${origin}/claude/marketplace.json`],
]) {
  test(name, async (t) => {
    const server = createServer((req, res) => res.end('{"plugins":[]}'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.address().port}`;
    const f = fixture(t, { knownUrl: baked(origin), env: { GENIA_WORKS_API_URL: `${origin}/api/v1` } });
    const r = await callLibAsync(f.env, 'check_required && update_plugins && resolve_plugin_scripts && write_settings');
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(f.read('home', '.claude', 'settings.json'));
    assert.equal(s.extraKnownMarketplaces['genia-works'].source.url, `${origin}/claude/marketplace.json`);
    const calls = f.read('out', 'claude-plugin.log').split('\n');
    const at = (re) => calls.findIndex((l) => re.test(l));
    const order = [/^plugin marketplace remove genia-works$/, new RegExp(`^plugin marketplace add ${origin}/claude/marketplace\\.json$`), /^plugin install genia-works@genia-works$/].map(at);
    assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], calls.join('\n'));
    // 갱신은 지우고 다시 더하기 하나로만 한다(marketplace update 경로는 없다).
    assert.equal(at(/marketplace update/), -1);
  });
}

test('marksOnboardingAndTrustForRepos', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('home', '.claude.json'), JSON.stringify({ userID: 'u1', projects: { '/x': { allowedTools: ['Bash'] } } }));
  const r = callLib(f.env, 'check_required && resolve_plugin_scripts && mark_trust /work/agents/kodi /work/agents/kodi/repos/WP');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(f.read('home', '.claude.json'));
  assert.equal(j.hasCompletedOnboarding, true);
  assert.equal(j.bypassPermissionsModeAccepted, true);
  assert.equal(j.userID, 'u1'); // claude 가 적은 값은 그대로
  assert.deepEqual(j.projects['/x'], { allowedTools: ['Bash'] });
  assert.equal(j.projects['/work/agents/kodi'].hasTrustDialogAccepted, true);
  assert.equal(j.projects['/work/agents/kodi/repos/WP'].hasTrustDialogAccepted, true);
});

test('installsKeyWithMode600', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && resolve_plugin_scripts && install_key');
  assert.equal(r.status, 0, r.stderr);
  const key = f.d('home', '.genia-works', 'keys', 'kodi');
  assert.equal(readFileSync(key, 'utf8').trim(), 'ak_testkey123');
  assert.equal(statSync(key).mode & 0o777, 0o600);
  assert.equal(statSync(f.d('home', '.genia-works', 'keys')).mode & 0o777, 0o700);
  assert.doesNotMatch(r.stdout + r.stderr, /ak_testkey123/);
  // 플러그인의 키 저장(gw-keys add)이 형식을 본다 — AI 키가 아니면 놓지 않고 실패한다.
  writeFileSync(f.d('run', 'agent-key'), 'not-a-key\n');
  assert.notEqual(callLib(f.env, 'check_required && resolve_plugin_scripts && install_key').status, 0);
});

test('passesGithubTokenOnStdinOnly', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read('out', 'gh.stdin'), 'stdin github.com ghp_secrettoken\n');
  const args = f.read('out', 'gh.log');
  assert.match(args, /auth login --hostname github\.com --with-token/);
  assert.match(args, /auth setup-git --hostname github\.com/);
  assert.doesNotMatch(args + r.stderr, /ghp_secrettoken/);
  const git = (k) => spawnSync('git', ['config', '--global', k], { env: f.env, encoding: 'utf8' }).stdout.trim();
  assert.equal(git('user.name'), 'kodi');
  assert.equal(git('user.email'), 'kodi@agents.genia-works.local');
});

test('logsInToEveryGithubHostAndOnlyNotesGitlab', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('run', 'repo-tokens', 'github', 'ghe.example.com'), 'ghp_enterprisetoken\n');
  mkdirSync(f.d('run', 'repo-tokens', 'gitlab'), { recursive: true });
  writeFileSync(f.d('run', 'repo-tokens', 'gitlab', 'gitlab.iacloud.kr'), 'glpat_gitlabsecret\n');
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const stdin = f.read('out', 'gh.stdin').trim().split('\n').sort();
  assert.deepEqual(stdin, ['stdin ghe.example.com ghp_enterprisetoken', 'stdin github.com ghp_secrettoken']);
  const args = f.read('out', 'gh.log');
  assert.match(args, /auth setup-git --hostname ghe\.example\.com/);
  assert.match(args, /auth setup-git --hostname github\.com/);
  // GitLab 은 gh 를 부르지 않고 파일이 있다는 것만 알린다
  assert.doesNotMatch(args, /gitlab/);
  assert.match(r.stdout + r.stderr, /gitlab\.iacloud\.kr/);
  assert.doesNotMatch(args + r.stdout + r.stderr, /ghp_|glpat_/);
});

test('warnsOnlyWhenRepoTokensMissing', (t) => {
  const f = fixture(t);
  rmSync(f.d('run', 'repo-tokens'), { recursive: true });
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /저장소 토큰/);
  assert.equal(existsSync(f.d('out', 'gh.log')), false);
});

test('exitsWhenConfigMissing', (t) => {
  const f = fixture(t);
  rmSync(f.d('run', 'config.json'));
  const r = spawnSync(entrypoint, [], { env: f.env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /config\.json/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  const noName = { ...f.env };
  delete noName.GENIA_AGENT_NAME;
  writeFileSync(f.d('run', 'config.json'), JSON.stringify(CONFIG));
  const r2 = spawnSync(entrypoint, [], { env: noName, encoding: 'utf8' });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /GENIA_AGENT_NAME/);
});

// ---------------------------------------------------------------- 프로젝트·Playwright

test('listsAssignedProjectsFromServer', (t) => {
  const f = fixture(t, {
    // 고르기(실제 멤버·연결된 저장소·키 형식)는 서버가 한다 — 이미지는 받은 목록을 그대로 줄로 바꾼다(WP-1275).
    projects: [
      { projectKey: 'WP', name: 'WP', repositoryUrl: 'https://g/wp.git', repositoryBranch: null },
      { projectKey: 'WD', name: 'WD', repositoryUrl: 'https://g/wd.git', repositoryBranch: 'develop' },
      { projectKey: 'ZZ', name: 'ZZ', repositoryUrl: 'https://g/zz.git' },
    ],
  });
  const r = callLib(f.env, 'check_required && resolve_plugin_scripts && list_projects');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['WP\thttps://g/wp.git\t', 'WD\thttps://g/wd.git\tdevelop', 'ZZ\thttps://g/zz.git\t']);
});

test('readsPlaywrightVersionFromLockfile', (t) => {
  const f = fixture(t);
  const lock = f.d('a');
  mkdirSync(lock);
  writeFileSync(join(lock, 'pnpm-lock.yaml'), "importers:\n  .:\n    devDependencies:\n      '@playwright/test':\n        specifier: ^1.58.0\n\npackages:\n\n  playwright-core@1.58.2:\n    resolution: {}\n  '@playwright/test@1.58.2':\n    resolution: {}\n");
  assert.equal(callLib(f.env, `playwright_version "${lock}"`).stdout, '1.58.2\n');
  const pkg = f.d('b');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '^1.57.0' } }));
  assert.equal(callLib(f.env, `playwright_version "${pkg}"`).stdout, '1.57.0\n');
  const none = f.d('c');
  mkdirSync(none);
  const r = callLib(f.env, `playwright_version "${none}"`);
  assert.deepEqual([r.status, r.stdout], [1, '']);
});

test('pluginLockMismatchFailsBuild', (t) => {
  const ok = fixture(t);
  assert.equal(callLib(ok.env, `verify_plugin_lock "${lockFile}"`).status, 0);
  const bad = fixture(t, { pluginVersions: { 'superpowers@anthropic-plugin-directory': '9.9.9-zzz' } });
  const r = callLib(bad.env, `verify_plugin_lock "${lockFile}"`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /superpowers@anthropic-plugin-directory/);
});

test('pluginLockMatchesTemplate', () => {
  // 이미지에 굳힌 버전(plugins.lock)과 Works 가 desired 로 내는 템플릿의 플러그인 버전이 같아야 한다 — 한쪽만 고치면 Pod 마다 다른 버전이 뜬다.
  const template = readFileSync(join(appDir, '..', 'workplace-api', 'src', 'main', 'resources', 'agent-templates', 'claude-code.yaml'), 'utf8');
  const fromTemplate = [...template.matchAll(/^\s*-\s*\{\s*marketplace:\s*([^,\s]+),\s*name:\s*([^,\s]+),\s*version:\s*([^\s}]+)\s*\}/gm)]
    .map(([, marketplace, name, version]) => `${name}@${marketplace} ${version}`)
    .sort();
  const fromLock = lockEntries.map(([id, version]) => `${id} ${version}`).sort();
  assert.ok(fromLock.length > 0);
  assert.deepEqual(fromTemplate, fromLock);
});

test('dockerfileInstallsKoreanFont', () => {
  // 한글이 WenQuanYi 폭으로 그려지면 배치를 재는 E2E 가 작업 공간에서만 실패한다 — Noto CJK 를 넣고 WenQuanYi 는 지운다(WP-1285).
  const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /apt-get install[^;]*\bfonts-noto-cjk\b/);
  assert.match(dockerfile, /apt-get purge -y fonts-wqy-zenhei/);
});

test('buildSkipsGeniaWorksWhenMarketplaceUnreachable', (t) => {
  // 빌더에서 Works 서버에 닿지 않으면 genia-works 만 굳히지 않고 빌드는 계속된다(Pod 가 뜰 때 받는다).
  const f = fixture(t, { env: { FAKE_FAIL_PLUGIN: 'marketplace add https://unreachable.example' } });
  const list = JSON.parse(f.read('out', 'plugins.json')).filter((p) => p.id !== 'genia-works@genia-works');
  writeFileSync(f.d('out', 'plugins.json'), JSON.stringify(list));
  const r = callLib(f.env, `install_plugins "${lockFile}" https://unreachable.example`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /genia-works 마켓플레이스/);
  assert.doesNotMatch(f.read('out', 'claude-plugin.log'), /plugin install genia-works@genia-works/);
  // 다른 플러그인 설치가 실패하면 여전히 빌드 실패다.
  const g = fixture(t, { env: { FAKE_FAIL_PLUGIN: 'install superpowers' } });
  assert.notEqual(callLib(g.env, `install_plugins "${lockFile}" https://x.example`).status, 0);
});

// ---------------------------------------------------------------- 엔트리포인트 전체(진짜 tmux·플러그인 스크립트)

tmuxTest('panesReceiveTenantAndGenerationEnv', async (t) => {
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  const lines = f.read('out', 'pane-WP.env').split('\n');
  const aiDir = f.d('work', 'agents', 'kodi');
  // agent-project 는 워크스페이스·generation 을 넘기지 않는다 — 엔트리포인트가 띄운 tmux 서버의 환경으로 칸까지 간다.
  // 이 값이 없으면 gw-status 가 보고하지 않아(쉴 때 교체 불가) 여러 워크스페이스 AI 가 엉뚱한 워크스페이스로 붙는다.
  for (const want of [
    'GENIA_AGENT_GENERATION=7',
    'GENIA_WORKS_TENANT=3',
    'GENIA_WORKS_AS=kodi',
    `GENIA_WORKS_AGENT_DIR=${aiDir}`,
    'GENIA_WORKS_API_URL=http://127.0.0.1:9/api/v1',
    'CLAUDE_CODE_OAUTH_TOKEN=set',
    'arg bypassPermissions',
    'arg /loop /genia-works:work-loop WP --queue "AI 개발팀"',
  ]) {
    assert.ok(lines.includes(want), `${want} 가 없습니다:\n${lines.join('\n')}`);
  }
  // 저장소는 AI 폴더 아래, 신뢰는 AI 폴더와 저장소 모두, Playwright 는 lock 의 버전으로 받았다
  assert.ok(existsSync(join(aiDir, 'repos', 'WP', 'pnpm-lock.yaml')));
  const trust = JSON.parse(f.read('home', '.claude.json')).projects;
  assert.equal(trust[aiDir].hasTrustDialogAccepted, true);
  assert.equal(trust[join(aiDir, 'repos', 'WP')].hasTrustDialogAccepted, true);
  assert.match(f.read('out', 'npx.log'), /-y playwright@1\.60\.0 install chromium/);
  assert.doesNotMatch(e.log(), /oauth-secret-value|ghp_secrettoken|ak_testkey123/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('supervisorRevivesDeadPane', async (t) => {
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  await until(() => panes(f.tmux).some((p) => p.win === 'events'), '알림 감시 창', 10000, e.log);
  // 칸의 claude 가 죽는다 → 감독이 그 자리에서 다시 띄운다
  rmSync(f.d('out', 'pane-WP.env'));
  const wp = panes(f.tmux).find((p) => p.key === 'WP');
  process.kill(wp.pid, 'SIGKILL');
  await until(() => existsSync(f.d('out', 'pane-WP.env')), '되살린 WP 칸', 15000, e.log);
  assert.equal(panes(f.tmux).filter((p) => p.key === 'WP').length, 1);
  // 감시 창이 사라져도 감독이 다시 띄운다(모든 칸이 쉬는 동안에도 「연결됨」이 이어지게)
  f.tmux('kill-window', '-t', '=kodi:=events');
  await until(() => panes(f.tmux).some((p) => p.win === 'events' && !p.dead), '다시 띄운 감시 창', 15000, e.log);
  await until(() => /WP: revived/.test(e.log()), 'revived 로그', 10000, e.log);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('restartsLongRunningPane', async (t) => {
  const f = fixture(t, { env: { GENIA_RESTART_AFTER: '2' } });
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  rmSync(f.d('out', 'pane-WP.env'));
  // 칸이 정한 나이를 넘으면(운영 6일 — /loop 7일 만료 전) 죽지 않았어도 다시 띄운다
  await until(() => existsSync(f.d('out', 'pane-WP.env')), '다시 띄운 WP 칸', 15000, e.log);
  // 로그 줄은 agent-project 가 돌아온 뒤에 남는다 — 칸이 먼저 뜰 수 있어 기다린다.
  await until(() => /WP: restarted/.test(e.log()), 'restarted 로그', 10000, e.log);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('sigtermStopsPanesAndExitsZero', async (t) => {
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  // 감시 창은 엔트리포인트가 칸을 다 띄운 뒤에 챙긴다 — 둘 다 뜬 뒤에 끈다.
  await until(() => panes(f.tmux).some((p) => p.win === 'events'), '알림 감시 창', 10000, e.log);
  const pids = panes(f.tmux).map((p) => p.pid);
  assert.ok(pids.length >= 2); // WP 칸 + 감시 창
  const t0 = Date.now();
  e.child.kill('SIGTERM');
  const { code } = await e.exited;
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 15000, '칸이 끝나면 40초를 다 기다리지 않는다');
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

tmuxTest('doesNotExitWhenLoopsStop', async (t) => {
  const f = fixture(t);
  writeFileSync(f.d('out', 'exit-now'), '');
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  // work-loop 가 멈추고(DRAIN 등) claude 가 끝나도 엔트리포인트는 끝내지 않는다 — 끝내면 kubelet 이 같은 generation 으로 헛돈다
  await sleep(3500);
  assert.equal(e.child.exitCode, null, e.log());
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

/** 프로젝트 여러 개 — 키별 저장소(루트 폴더가 따로 있는 bare repo)와 목록 JSON. */
function severalProjects(f, specs) {
  const list = specs.map(({ key, pw, broken }) => ({
    projectKey: key,
    name: key,
    repositoryUrl: broken ? f.d('git', 'missing', `${key}.git`) : bareRepo(f.d('git', key), pw),
  }));
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(list));
}

tmuxTest('startsSeveralProjectsSkipsFailedCloneAndInstallsSharedPlaywrightOnce', async (t) => {
  // AA·BB 는 Playwright 1.60.0 을 같이 쓰고, CC 는 1.61.0, DD 는 clone 이 실패한다. 브라우저는 버전마다 한 번씩만, 서로 동시에(WP-1267).
  const f = fixture(t, { env: { FAKE_NPX_RENDEZVOUS: '2' } });
  severalProjects(f, [{ key: 'AA' }, { key: 'BB' }, { key: 'CC', pw: '1.61.0' }, { key: 'DD', broken: true }]);
  const e = startEntrypoint(t, f.env);
  const aiDir = f.d('work', 'agents', 'kodi');
  await until(() => ['AA', 'BB', 'CC'].every((k) => existsSync(f.d('out', `pane-${k}.env`))), 'AA·BB·CC 칸의 claude', 40000, e.log);
  await until(() => panes(f.tmux).some((p) => p.win === 'events'), '알림 감시 창', 10000, e.log);
  // 실패한 프로젝트는 칸이 없고 이유가 로그에 남는다 — 다른 프로젝트에는 영향이 없다
  assert.ok(!existsSync(f.d('out', 'pane-DD.env')));
  assert.deepEqual(panes(f.tmux).filter((p) => p.key).map((p) => p.key).sort(), ['AA', 'BB', 'CC']);
  assert.match(e.log(), /DD: .*clone-failed/);
  assert.match(e.log(), /AA: cloned/);
  assert.match(e.log(), /BB: cloned/);
  for (const k of ['AA', 'BB', 'CC']) assert.ok(existsSync(join(aiDir, 'repos', k, 'pnpm-lock.yaml')), k);
  // 버전별 한 번 — 같은 버전을 쓰는 프로젝트가 둘이어도 npx 는 한 번, 두 버전은 서로 기다리지 않고 함께 돌았다
  assert.deepEqual(f.read('out', 'npx.log').split('\n').filter(Boolean).sort(), ['-y playwright@1.60.0 install chromium', '-y playwright@1.61.0 install chromium']);
  assert.ok(existsSync(f.d('out', 'npx-seen-1.60.0')) && existsSync(f.d('out', 'npx-seen-1.61.0')), '두 버전이 동시에 돌지 않았습니다');
  assert.ok(existsSync(f.d('work', '.cache', 'ms-playwright', '.genia-chromium-1.60.0')));
  assert.ok(existsSync(f.d('work', '.cache', 'ms-playwright', '.genia-chromium-1.61.0')));
  // 폴더 신뢰는 칸을 띄우기 전에 한 번에 적었다
  const trust = JSON.parse(f.read('home', '.claude.json')).projects;
  for (const k of ['AA', 'BB', 'CC']) assert.equal(trust[join(aiDir, 'repos', k)].hasTrustDialogAccepted, true);
  // 임시 폴더는 남기지 않는다
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('boot.')), []);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('sigtermDuringParallelBootExitsZeroWithoutWaiting', async (t) => {
  // 브라우저를 받는 중(npx 가 15초 붙잡힘)에 SIGTERM — 뒤에서 도는 일들이 on_term 을 막지 않고 바로 정리·종료한다.
  const f = fixture(t, { env: { FAKE_NPX_HANG: '1' } });
  severalProjects(f, [{ key: 'AA' }, { key: 'BB', pw: '1.61.0' }]);
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'npx-started-1.60.0')) && existsSync(f.d('out', 'npx-started-1.61.0')), '브라우저 받기 시작', 30000, e.log);
  const t0 = Date.now();
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
  assert.ok(Date.now() - t0 < 10000, 'SIGTERM 이 뒤에서 도는 일을 기다렸습니다');
  assert.ok(!existsSync(f.d('out', 'pane-AA.env')), '종료 신호를 받은 뒤에는 칸을 띄우지 않는다');
  // 서브셸뿐 아니라 실제 일을 하는 손자(npx·그 자식)까지 끝났고, 부팅 임시 폴더도 치웠다
  const pids = f.read('out', 'npx-pids').split('\n').filter(Boolean).map(Number);
  assert.equal(pids.length, 4); // 버전 둘 × (npx, sleep)
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), `pid ${pid} 가 아직 살아 있습니다`);
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('boot.')), []);
});
