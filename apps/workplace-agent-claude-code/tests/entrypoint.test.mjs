// 작업 공간 엔트리포인트 테스트(WP-1252) — bin/lib.sh 의 함수를 하나씩, 그리고 bin/entrypoint 전체를 돌려 본다.
// claude·gh·npm 은 PATH 앞의 가짜로 바꾸고, tmux 는 진짜를 테스트마다 격리한 서버(-L)로 쓴다(칸 되살리기·SIGTERM 정리는 tmux 의 실제 동작이라).
// 플러그인 스크립트는 저장소의 plugins/genia-works/scripts 를 그대로 쓴다(서버를 부르는 gw-agent-projects 만 가짜) —
// 엔트리포인트가 플러그인과 실제로 맞물리는지, 칸 안의 claude 가 워크스페이스·generation 을 받는지를 진짜로 확인하려는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h from './harness.mjs';
import { exe, sleep, tmuxTest, until } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const lib = join(appDir, 'bin', 'lib.sh');
const entrypoint = join(appDir, 'bin', 'entrypoint');
const pluginScripts = join(appDir, '..', '..', 'plugins', 'genia-works', 'scripts');
const lockFile = join(appDir, 'plugins.lock');
const gwLib = join(pluginScripts, 'gw-lib.sh');


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
const bareRepo = (root, pw = '1.60.0') =>
  h.bareRepo(root, { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\npackages:\n\n  '@playwright/test@" + pw + "':\n    resolution: {}\n" });

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

  // 가짜 claude — plugin 하위 명령은 기록하고 목록을 내며, 그 밖(칸의 work-loop)은 받은 환경·인자를 남기고 기다린다.
  // OAuth 토큰은 값 대신 있는지만 남긴다(테스트 출력에도 원문을 두지 않는다).
  exe(d('bin', 'claude'), `#!/bin/sh
case "$1" in
  plugin)
    printf '%s\\n' "$*" >> "$FAKE_OUT/claude-plugin.log"
    case "$*" in *"\${FAKE_FAIL_PLUGIN:-@@none@@}"*) exit 1 ;; esac
    [ "$2" = list ] && cat "$FAKE_PLUGIN_LIST"
    exit 0 ;;
  --version) echo "2.1.330 (Claude Code)"; exit 0 ;;
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
  // 가짜 npm(WP-1683) — 엔트리포인트는 저장소 Playwright 를 `npm install --prefix <브라우저 폴더>/.genia-installs/<버전> playwright-core@<버전>` 로 받는다.
  // 받은 버전을 npm.log 에 「install <버전>」 으로 남기고, --prefix 폴더에 가짜 playwright-core(package.json·browsers.json·cli.js)를 만든다.
  // revision 은 버전의 숫자를 이은 것(1.60.0 → 1600). FAKE_NPM_FAIL=<버전> 이면 그 버전은 실패(종료 1)한다.
  // FAKE_NPM_RENDEZVOUS=n 이면 n 개가 시작될 때까지 기다린 결과(npm-seen-<버전>)를 남긴다 — 브라우저 받기가 동시에 도는지(순서대로면 기다리다 시간이 지난다).
  // FAKE_NPM_HANG 이면 오래 붙잡는다(SIGTERM 테스트). FAKE_NPM_LEGACY=<버전> 이면 그 버전의 browsers.json 에 chromium 만 둔다
  // (Playwright 1.48 이하 — chromium-headless-shell 항목은 1.49 부터 있다).
  exe(d('bin', 'npm'), `#!/bin/sh
prefix=""
pkg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix=$2; shift 2 ;;
    playwright-core@*) pkg=$1; shift ;;
    *) shift ;;
  esac
done
v=\${pkg#playwright-core@}
printf 'install %s\\n' "$v" >> "$FAKE_OUT/npm.log"
: > "$FAKE_OUT/npm-started-$v"
if [ -n "\${FAKE_NPM_RENDEZVOUS:-}" ]; then
  n=100
  while [ "$(ls "$FAKE_OUT" | grep -c '^npm-started-')" -lt "$FAKE_NPM_RENDEZVOUS" ] && [ $n -gt 0 ]; do sleep 0.1; n=$((n - 1)); done
  [ $n -gt 0 ] && : > "$FAKE_OUT/npm-seen-$v"
fi
if [ -n "\${FAKE_NPM_HANG:-}" ]; then
  # 손자 프로세스(npm 과 그 자식 sleep)의 pid 를 남긴다 — SIGTERM 뒤 둘 다 없어졌는지 본다.
  echo $$ >> "$FAKE_OUT/npm-pids"
  sleep 15 &
  echo $! >> "$FAKE_OUT/npm-pids"
  wait
fi
[ "$v" = "\${FAKE_NPM_FAIL:-@@none@@}" ] && exit 1
rev=$(printf '%s' "$v" | tr -d .)
core="$prefix/node_modules/playwright-core"
mkdir -p "$core"
printf '{"name":"playwright-core","version":"%s"}' "$v" > "$core/package.json"
if [ "$v" = "\${FAKE_NPM_LEGACY:-@@none@@}" ]; then
  printf '{"browsers":[{"name":"chromium","revision":"%s"}]}' "$rev" > "$core/browsers.json"
else
  printf '{"browsers":[{"name":"chromium","revision":"%s"},{"name":"chromium-headless-shell","revision":"%s"}]}' "$rev" "$rev" > "$core/browsers.json"
fi
cp "$FAKE_PW_CLI" "$core/cli.js"
exit 0
`);
  // 가짜 playwright-core cli.js — 진짜 node 로 돈다. install chromium 이면 browsers.json 의 브라우저 폴더(이름의 - 는 _ 로)에 INSTALLATION_COMPLETE 를 만들고
  // 설치 기록(.links/<버전>)에 core 경로를 적고, pw-install.log 에 「<버전> skip-gc=<PLAYWRIGHT_SKIP_BROWSER_GC>」 를 남긴다.
  writeFileSync(d('bin', 'fake-pw-cli.js'), `const fs = require('fs');
const path = require('path');
if (process.argv[2] !== 'install' || process.argv[3] !== 'chromium') process.exit(2);
const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
for (const b of JSON.parse(fs.readFileSync(path.join(__dirname, 'browsers.json'), 'utf8')).browsers) {
  const p = path.join(dir, b.name.replace(/-/g, '_') + '-' + b.revision);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'INSTALLATION_COMPLETE'), '');
}
fs.mkdirSync(path.join(dir, '.links'), { recursive: true });
fs.writeFileSync(path.join(dir, '.links', version), __dirname);
fs.appendFileSync(path.join(process.env.FAKE_OUT, 'pw-install.log'), version + ' skip-gc=' + (process.env.PLAYWRIGHT_SKIP_BROWSER_GC || '') + '\\n');
`);
  // 가짜 curl — 맡는 프로젝트 조회(…/agent-runtime/me/projects)는 FAKE_OUT/projects.json 으로 답하고,
  // 이슈 조회(…/projects/<키>/issues/<번호> — 부팅 워크트리 정리의 gw-issue-status, WP-1683)는 FAKE_OUT/issues.json({"WP-1":"DONE"} 꼴)의
  // 상태로 답한다(없는 이슈는 404). 묻은 이슈는 issues.log 에 남긴다. 나머지는 진짜 curl 로 보낸다.
  const realCurl = spawnSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
  exe(d('bin', 'curl'), `#!/bin/sh
for a in "$@"; do
  case "$a" in
    */agent-runtime/me/projects)
      cat "$FAKE_OUT/projects.json"; printf '\\n200'
      exit 0 ;;
    */projects/*/issues/*)
      n=\${a##*/}
      p=\${a%/issues/*}
      p=\${p##*/}
      printf '%s-%s\\n' "$p" "$n" >> "$FAKE_OUT/issues.log"
      s=$(jq -r --arg k "$p-$n" '.[$k] // empty' "$FAKE_OUT/issues.json" 2>/dev/null)
      if [ -n "$s" ]; then printf '{"summary":{"status":"%s"}}\\n200' "$s"; else printf '{}\\n404'; fi
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

  const { wrapper, tmux } = h.isolatedTmux(d('bin'), 'gwentry');
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
    GENIA_PLAYWRIGHT_CLI_CORE: d('no-playwright-cli'),
    GENIA_XVFB: d('no-xvfb'), // 시험 기계에 Xvfb 가 있어도 진짜 화면을 띄우지 않는다
    GENIA_DIND_WAIT: '0',
    GENIA_SUPERVISE_INTERVAL: '1',
    GW_TMUX: wrapper,
    FAKE_OUT: d('out'),
    FAKE_PLUGIN_LIST: d('out', 'plugins.json'),
    FAKE_PW_CLI: d('bin', 'fake-pw-cli.js'),
    ...extra,
  };
  return { root, d, env, tmux, read: (...p) => readFileSync(d(...p), 'utf8') };
}

/** lib.sh 를 읽고 함수(셸 한 줄)를 부른다 — 동기·비동기(같은 프로세스의 가짜 HTTP 서버가 응답할 수 있게). */
const callLib = (env, script) => h.callLib([lib], env, script);
const callLibAsync = (env, script) => h.callLibAsync([lib], env, script);
/** 엔트리포인트를 뒤에서 띄운다 — 끝나기를 기다리는 exited 와 지금까지의 로그. */
const startEntrypoint = (t, env) => h.startEntrypoint(t, entrypoint, env);

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
  assert.equal(s.enabledPlugins['superpowers@superpowers-marketplace'], true);
  assert.deepEqual(s.extraKnownMarketplaces['genia-works'].source, { source: 'url', url: 'http://127.0.0.1:9/claude/marketplace.json' });
  // 덮어써도 claude-plugins-official(빌드 때 더한 마켓플레이스)이 남아야 LSP 플러그인이 사라지지 않는다
  assert.deepEqual(s.extraKnownMarketplaces['claude-plugins-official'].source, { source: 'github', repo: 'anthropics/claude-plugins-official' });
  // superpowers 는 만든 사람의 마켓플레이스에서 받는다(WP-1336) — 덮어써도 남아야 superpowers 가 사라지지 않는다
  assert.deepEqual(s.extraKnownMarketplaces['superpowers-marketplace'].source, { source: 'github', repo: 'obra/superpowers-marketplace' });
  assert.equal(s.skipDangerousModePermissionPrompt, true);
  assert.equal(s.pluginConfigs['genia-works@genia-works'].options.server_url, 'http://127.0.0.1:9/mcp');
  // Code Mode(WP-1960)는 settings.json 의 env 로만 켠다 — 대화형 칸은 이것만으로 켜진다(실측)
  assert.deepEqual(s.env, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
});

test('doesNotExportCodeModeToShell', (t) => {
  // 셸 env 로 새면 칸 밖의 헤드리스 `claude -p` 가 Code Mode 를 거부하며 경고를 낸다(WP-1960)
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && update_plugins && resolve_plugin_scripts && write_settings && printf "CM=%s\\n" "${CLAUDE_CODE_EXPERIMENTAL_CODE_MODE-unset}"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CM=unset$/m);
});

// write_settings 뒤 셸에 남은 CLAUDE_CODE_EFFORT_LEVEL 을 표식 줄로 찍는다 — 칸(tmux)이 물려받는 값(WP-1542). 없으면 빈 값.
const PRINT_EFFORT_ENV = 'write_settings && printf "EFFORT_ENV=%s\\n" "${CLAUDE_CODE_EFFORT_LEVEL-}"';
const effortEnv = (r) => (r.stdout.match(/EFFORT_ENV=(.*)/) ?? [])[1];

/** 설정 칸 값을 바꾼 config.json 으로 write_settings 만 돌려 settings.json·내보낸 강도 env·호출 결과를 돌려준다(WP-1542). */
function settingsWith(t, configOverride) {
  const f = fixture(t, { env: { CLAUDE_CODE_EFFORT_LEVEL: 'stale' } });
  writeFileSync(f.d('run', 'config.json'), JSON.stringify({ ...CONFIG, config: configOverride }));
  const r = callLib(f.env, `check_required && update_plugins && resolve_plugin_scripts && ${PRINT_EFFORT_ENV}`);
  assert.equal(r.status, 0, r.stderr);
  return { r, s: JSON.parse(f.read('home', '.claude', 'settings.json')), env: effortEnv(r) };
}

test('writesEffortLevelFromConfig', (t) => {
  const { s, env } = settingsWith(t, { model: 'opus', effort: 'xhigh' });
  assert.equal(s.effortLevel, 'xhigh');
  assert.equal(env, 'xhigh');
  assert.equal(s.model, 'opus');
});

test('exportsMaxEffortForSessions', (t) => {
  // max 는 settings.json 의 기본값으로는 저장되지 않는 값이라(Claude Code 2.1.316) 세션 env 로도 넘긴다
  const { s, env } = settingsWith(t, { model: 'opus', effort: 'max' });
  assert.equal(env, 'max');
  assert.equal(s.effortLevel, 'max');
});

test('defaultsEffortLevelToHighWhenMissing', (t) => {
  // effort 키가 없는 옛 에이전트 — 설정 화면이 기본(high)을 보여 주므로 동작도 high
  const f = fixture(t);
  const r = callLib(f.env, `check_required && update_plugins && resolve_plugin_scripts && ${PRINT_EFFORT_ENV}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(f.read('home', '.claude', 'settings.json')).effortLevel, 'high');
  assert.equal(effortEnv(r), 'high');
});

test('omitsEffortLevelWhenEmptyOrInvalid', (t) => {
  // null·숫자처럼 문자열이 아닌 값도 같은 길(빼고 경고)로 간다 — 부팅이 jq 오류로 죽지 않는다
  for (const bad of ['', 'ultra', 'HIGH', 'high; rm -rf /', null, 1]) {
    const { r, s, env } = settingsWith(t, { model: 'opus', effort: bad });
    assert.equal('effortLevel' in s, false, `effort=${bad}`);
    assert.equal(env, '', `effort=${bad}`); // 부모에서 물려받은 옛 값(stale)도 지운다
    assert.equal(s.model, 'opus');
    assert.match(r.stderr, /추론 강도/);
    if (typeof bad === 'string' && bad !== '') assert.equal((r.stdout + r.stderr).includes(bad), false); // 값 원문은 로그에 남기지 않는다
  }
});

test('writesEffortLevelEvenWithoutModel', (t) => {
  const { s } = settingsWith(t, { effort: 'low' });
  assert.equal(s.effortLevel, 'low');
  assert.equal('model' in s, false);
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
  // Code Mode opt-in 확인 창이 사람 없는 칸을 막지 않게(WP-1960)
  assert.equal(j.codeModeCaveatsAcceptedV1, true);
  assert.equal(j.codeModeAutoModeCaveatAcceptedV1, true);
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

/** gh 를 덮어쓴다 — auth login 은 loginScript(종료 코드로 끝나는 셸), auth status 는 statusExit 로 끝난다. 로그인 시도 수는 login.n 에 센다. */
function fakeGh(f, loginScript, statusExit) {
  exe(f.d('bin', 'gh'), `#!/bin/sh
printf 'args %s\\n' "$*" >> "$FAKE_OUT/gh.log"
case "$1 $2" in
  "auth login")
    cat > /dev/null
    n=$(cat "$FAKE_OUT/login.n" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$FAKE_OUT/login.n"
    ${loginScript}
    ;;
  "auth status") exit ${statusExit} ;;
esac
exit 0
`);
}

test('retriesGithubLoginAndRecordsResultForSession', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0' } });
  fakeGh(f, 'if [ "$n" -lt 3 ]; then echo "error connecting to api.github.com" >&2; exit 1; fi; exit 0', 0);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((f.read('out', 'gh.log').match(/auth login/g) || []).length, 3);
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /github github\.com login ok/);
  assert.match(status, /gh auth status 0/);
  assert.doesNotMatch(r.stderr, /GitHub 로그인 실패/);
});

test('recordsFullGithubLoginErrorWithoutToken', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0' } });
  fakeGh(f, 'printf "error validating token: HTTP 401\\ntoken ghp_leakedvalue123 rejected\\nold 0123456789abcdef0123456789abcdef01234567 x\\n" >&2; exit 1', 1);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const path = f.d('work', 'agents', 'kodi', 'state', 'git-auth.log');
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /login failed\(3회\)/);
  // 로그인이 실패하면 시간 제한 없는 gh auth status 를 부르지 않는다(네트워크 장애 때 부팅·종료 신호가 밀리지 않게)
  assert.match(status, /gh auth status 생략/);
  assert.doesNotMatch(f.read('out', 'gh.log'), /auth status/);
  assert.match(status, /HTTP 401/);
  assert.match(status, /token \*\*\* rejected/);
  assert.match(status, /old \*\*\* x/); // 옛 40자 16진 토큰도 가린다
  assert.doesNotMatch(status + r.stdout + r.stderr, /ghp_leakedvalue123|ghp_secrettoken|0123456789abcdef0123456789abcdef01234567/);
  assert.match(r.stderr, /GitHub 로그인 실패/);
  assert.ok(r.stderr.includes(path), r.stderr);
});

test('로그인이 계속 실패한 GitHub 호스트에는 토큰 파일을 읽는 git 자격 증명 도우미를 건다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0' } });
  fakeGh(f, 'echo "boom" >&2; exit 1', 1);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const fill = spawnSync('git', ['credential', 'fill'], {
    env: { ...f.env, GIT_TERMINAL_PROMPT: '0' },
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  assert.equal(fill.status, 0, fill.stderr);
  assert.match(fill.stdout, /username=x-access-token\npassword=ghp_secrettoken\n/);
  assert.doesNotMatch(readFileSync(join(f.env.HOME, '.gitconfig'), 'utf8'), /ghp_/);
  assert.match(f.read('work', 'agents', 'kodi', 'state', 'git-auth.log'), /git 도우미 토큰 파일/);
});

test('환경에 GH_TOKEN·GITHUB_TOKEN 이 있어도 저장 로그인을 한다(gh 가 환경 토큰이 있으면 거절하므로 그 호출에서만 뺀다)', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GH_TOKEN: 'envtoken', GITHUB_TOKEN: 'envtoken2' } });
  fakeGh(f, '[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && { echo "The value of the GH_TOKEN environment variable is being used for authentication." >&2; exit 1; }', 0);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.read('out', 'login.n').trim(), '1');
  assert.match(f.read('work', 'agents', 'kodi', 'state', 'git-auth.log'), /login ok/);
});

test('gh 로그인이 응답 없이 멈추면 제한 시간에 끊고 실패로 남긴다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GENIA_GH_LOGIN_TRIES: '1', GENIA_GH_LOGIN_TIMEOUT: '1' } });
  fakeGh(f, 'sleep 20', 0);
  const started = Date.now();
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - started < 10000, '제한 시간에 끊겨야 한다');
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /login failed\(1회\)/);
  assert.match(status, /1초 안에 끝나지 않았습니다/);
});

test('gh 가 오류 출력 없이 곧바로 실패하면 시간 제한이 아니라 종료 코드로 남긴다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GENIA_GH_LOGIN_TRIES: '1' } });
  fakeGh(f, 'exit 3', 0);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /gh auth login 종료 3, 오류 출력 없음/);
  assert.doesNotMatch(status, /시간 제한/);
});

test('제한 시간에 끊기면 앞서 나온 출력이 있어도 시간 제한을 남긴다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GENIA_GH_LOGIN_TRIES: '1', GENIA_GH_LOGIN_TIMEOUT: '1' } });
  fakeGh(f, 'echo "retrying..." >&2; sleep 20', 0);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /retrying\.\.\./);
  assert.match(status, /1초 안에 끝나지 않았습니다/);
});

test('setup_git 뒤에 토큰 값을 담은 변수가 남지 않는다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GENIA_GH_LOGIN_TRIES: '1' } });
  fakeGh(f, 'echo boom >&2; exit 1', 0);
  const r = callLib(f.env, 'check_required && setup_git && echo "LEFT tokval=${tokval-none} mask=${mask-none}"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LEFT tokval=none mask=none/);
});

test('접두사 없는 토큰도 그 파일 값으로 가린다', (t) => {
  const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0' } });
  writeFileSync(f.d('run', 'repo-tokens', 'github', 'github.com'), 'PlainSecret12345\n');
  fakeGh(f, 'echo "bad credentials for PlainSecret12345" >&2; exit 1', 1);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const status = f.read('work', 'agents', 'kodi', 'state', 'git-auth.log');
  assert.match(status, /bad credentials for \*\*\*/);
  assert.doesNotMatch(status + r.stdout + r.stderr, /PlainSecret12345/);
});

test('로그인이 성공하면 git 도우미를 따로 걸지 않는다', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && setup_git');
  assert.equal(r.status, 0, r.stderr);
  const cfg = spawnSync('git', ['config', '--global', '--get-all', 'credential.https://github.com.helper'], { env: f.env, encoding: 'utf8' });
  assert.doesNotMatch(cfg.stdout, /x-access-token/);
  assert.doesNotMatch(f.read('work', 'agents', 'kodi', 'state', 'git-auth.log'), /git 도우미/);
});

test('GENIA_GH_LOGIN_TRIES 가 숫자가 아니거나 0(00 포함)이면 3번 시도한다', (t) => {
  for (const tries of ['abc', '00']) {
    const f = fixture(t, { env: { GENIA_GH_LOGIN_WAIT: '0', GENIA_GH_LOGIN_TRIES: tries } });
    fakeGh(f, 'exit 1', 1);
    const r = callLib(f.env, 'check_required && setup_git');
    assert.equal(r.status, 0, r.stderr);
    assert.equal((f.read('out', 'gh.log').match(/auth login/g) || []).length, 3, tries);
  }
});

test('logsInToEveryGithubHostAndGivesGitlabACredentialHelper', (t) => {
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
  // GitLab 은 gh 를 부르지 않는다
  assert.doesNotMatch(args, /gitlab/);
  assert.doesNotMatch(args + r.stdout + r.stderr, /ghp_|glpat_/);
  // git 이 자격 증명을 물으면 도우미가 그때 토큰 파일을 읽어 답한다 — 설정 파일에는 토큰이 없다.
  const fill = spawnSync('git', ['credential', 'fill'], {
    env: { ...f.env, GIT_TERMINAL_PROMPT: '0' },
    input: 'protocol=https\nhost=gitlab.iacloud.kr\n\n',
    encoding: 'utf8',
  });
  assert.equal(fill.status, 0, fill.stderr);
  assert.match(fill.stdout, /username=oauth2\npassword=glpat_gitlabsecret\n/);
  const gitconfig = readFileSync(join(f.env.HOME, '.gitconfig'), 'utf8');
  assert.doesNotMatch(gitconfig, /glpat_/);
  // 토큰이 바뀌면(Pod 를 다시 만들 때 파일이 바뀐다) 설정을 다시 쓰지 않아도 새 값을 답한다.
  writeFileSync(f.d('run', 'repo-tokens', 'gitlab', 'gitlab.iacloud.kr'), 'glpat_rotated\n');
  const again = spawnSync('git', ['credential', 'fill'], { env: f.env, input: 'protocol=https\nhost=gitlab.iacloud.kr\n\n', encoding: 'utf8' });
  assert.match(again.stdout, /password=glpat_rotated/);
});

test('setupCaMergesExtraCaWithSystemRootsAndExportsForEveryClient', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('tmp', 'system.pem'), 'SYSTEM-ROOTS\n');
  // 추가 CA 가 없으면 아무것도 하지 않는다
  const none = callLib({ ...f.env, GENIA_SYSTEM_CA: f.d('tmp', 'system.pem') }, 'check_required && setup_ca && echo "ssl=${SSL_CERT_FILE:-}"');
  assert.match(none.stdout, /^ssl=$/m);

  mkdirSync(f.d('run', 'ca'), { recursive: true });
  writeFileSync(f.d('run', 'ca', 'ca.crt'), 'CORP-CA\n');
  const r = callLib(
    { ...f.env, GENIA_SYSTEM_CA: f.d('tmp', 'system.pem') },
    'check_required && setup_ca && printf "%s|%s|%s|%s|%s\\n" "$SSL_CERT_FILE" "$GIT_SSL_CAINFO" "$CURL_CA_BUNDLE" "$REQUESTS_CA_BUNDLE" "$NODE_EXTRA_CA_CERTS"',
  );
  assert.equal(r.status, 0, r.stderr);
  const bundle = join(f.env.HOME, '.genia-ca-bundle.pem');
  assert.equal(r.stdout.trim(), [bundle, bundle, bundle, bundle, f.d('run', 'ca', 'ca.crt')].join('|'));
  // 시스템 CA 를 대신하지 않고 합친다 — 추가분만이면 github.com 같은 공인 인증서가 깨진다
  assert.equal(readFileSync(bundle, 'utf8'), 'SYSTEM-ROOTS\nCORP-CA\n');
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

/** 브라우저 폴더(PVC) 안의 경로. */
const pwPath = (f, ...p) => f.d('work', '.cache', 'ms-playwright', ...p);
const npmLog = (f) => (existsSync(f.d('out', 'npm.log')) ? f.read('out', 'npm.log').split('\n').filter(Boolean) : []);

test('ensurePlaywrightInstallsUnderStableFolder', (t) => {
  // 휘발 홈의 npx 캐시 대신 PVC 의 고정 폴더에 받아 설치 기록(.links)이 재시작 뒤에도 STALE 이 되지 않는다(WP-1683).
  const f = fixture(t);
  mkdirSync(f.d('work', 'tmp'), { recursive: true });
  const r = callLib(f.env, 'ensure_playwright 1.60.0');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(npmLog(f), ['install 1.60.0']);
  assert.ok(existsSync(pwPath(f, '.genia-installs', '1.60.0', 'node_modules', 'playwright-core', 'browsers.json')));
  for (const n of ['chromium-1600', 'chromium_headless_shell-1600']) assert.ok(existsSync(pwPath(f, n, 'INSTALLATION_COMPLETE')), n);
  // 받을 때는 Playwright 의 GC 를 끈다 — 지우기는 browser-prune 하나가 한다
  assert.equal(f.read('out', 'pw-install.log'), '1.60.0 skip-gc=1\n');
  assert.equal(f.read('work', '.cache', 'ms-playwright', '.links', '1.60.0'), pwPath(f, '.genia-installs', '1.60.0', 'node_modules', 'playwright-core'));
  assert.ok(!existsSync(pwPath(f, '.genia-chromium-1.60.0')));
  // 다 받았으면 다시 받지 않는다
  assert.equal(callLib(f.env, 'ensure_playwright 1.60.0').status, 0);
  assert.deepEqual(npmLog(f), ['install 1.60.0']);
});

test('ensurePlaywrightReinstallsWhenBrowserIncomplete', (t) => {
  // 「받았는지」는 표시 파일이 아니라 그 버전 browsers.json 의 chromium·headless shell 폴더의 INSTALLATION_COMPLETE 로 본다.
  const f = fixture(t);
  mkdirSync(f.d('work', 'tmp'), { recursive: true });
  assert.equal(callLib(f.env, 'ensure_playwright 1.60.0').status, 0);
  rmSync(pwPath(f, 'chromium_headless_shell-1600', 'INSTALLATION_COMPLETE'));
  assert.equal(callLib(f.env, 'ensure_playwright 1.60.0').status, 0);
  assert.deepEqual(npmLog(f), ['install 1.60.0', 'install 1.60.0']);
  assert.ok(existsSync(pwPath(f, 'chromium_headless_shell-1600', 'INSTALLATION_COMPLETE')));
  // 옛 표시만 있고 폴더가 없는 버전도 받는다(옛 이미지의 표시를 믿지 않는다)
  writeFileSync(pwPath(f, '.genia-chromium-1.61.0'), '');
  assert.equal(callLib(f.env, 'ensure_playwright 1.61.0').status, 0);
  assert.deepEqual(npmLog(f), ['install 1.60.0', 'install 1.60.0', 'install 1.61.0']);
});

test('ensurePlaywrightTrustsSeededSymlink', (t) => {
  // 베이스 이미지의 브라우저(/ms-playwright)를 건 심볼릭 링크 폴더에 INSTALLATION_COMPLETE 가 있으면 그 버전은 받지 않는다.
  const f = fixture(t);
  const base = f.d('base');
  for (const n of ['chromium-1600', 'chromium_headless_shell-1600']) {
    mkdirSync(join(base, n), { recursive: true });
    writeFileSync(join(base, n, 'INSTALLATION_COMPLETE'), '');
  }
  const core = pwPath(f, '.genia-installs', '1.60.0', 'node_modules', 'playwright-core');
  mkdirSync(core, { recursive: true });
  writeFileSync(join(core, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', revision: '1600' }, { name: 'chromium-headless-shell', revision: '1600' }] }));
  mkdirSync(f.d('work', 'tmp'), { recursive: true });
  const r = callLib({ ...f.env, GENIA_BASE_BROWSERS: base }, 'seed_browsers && ensure_playwright 1.60.0');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(npmLog(f), []);
  assert.ok(lstatSync(pwPath(f, 'chromium-1600')).isSymbolicLink());
});

test('ensurePlaywrightAcceptsLegacyBrowsersJsonWithoutHeadlessShell', (t) => {
  // Playwright 1.48 이하의 browsers.json 에는 chromium-headless-shell 항목이 없다(1.49 부터) — 그때는 chromium 만 보고 「받음」으로 본다.
  // 아니면 받기 뒤에도 늘 실패(1)로 보여 다음 부팅마다 다시 받고, 브라우저 정리도 영영 건너뛴다.
  const f = fixture(t, { env: { FAKE_NPM_LEGACY: '1.48.2' } });
  mkdirSync(f.d('work', 'tmp'), { recursive: true });
  const r = callLib(f.env, 'ensure_playwright 1.48.2');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(pwPath(f, 'chromium-1482', 'INSTALLATION_COMPLETE')));
  assert.equal(callLib(f.env, 'ensure_playwright 1.48.2').status, 0);
  assert.deepEqual(npmLog(f), ['install 1.48.2']);
  // chromium 자체가 덜 받아졌으면 옛 형식이어도 다시 받는다
  rmSync(pwPath(f, 'chromium-1482', 'INSTALLATION_COMPLETE'));
  assert.equal(callLib(f.env, 'ensure_playwright 1.48.2').status, 0);
  assert.deepEqual(npmLog(f), ['install 1.48.2', 'install 1.48.2']);
});

test('ensurePlaywrightFailsWhenInstallFails', (t) => {
  // 받지 못하면 경고와 함께 1 — start_projects 가 이것을 보고 이번 부팅에서는 브라우저를 정리하지 않는다.
  const f = fixture(t, { env: { FAKE_NPM_FAIL: '1.60.0' } });
  mkdirSync(f.d('work', 'tmp'), { recursive: true });
  const r = callLib(f.env, 'ensure_playwright 1.60.0');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Playwright 1\.60\.0 의 chromium 을 받지 못했습니다/);
});

test('readsPlaywrightVersionFromLockfile', (t) => {
  // 규칙은 플러그인 gw-lib 의 gw_playwright_version 에 있다(WP-1683) — 엔트리포인트처럼 gw-lib 를 먼저 읽고 부른다.
  const f = fixture(t);
  const callLib = (env, script) => h.callLib([gwLib, lib], env, script);
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
  const bad = fixture(t, { pluginVersions: { 'feature-dev@anthropic-plugin-directory': '9.9.9-zzz' } });
  const r = callLib(bad.env, `verify_plugin_lock "${lockFile}"`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /feature-dev@anthropic-plugin-directory/);
  // 플러그인 판은 같고 끝의 마켓플레이스 커밋만 다르면 통과 — 공식 디렉터리 저장소 커밋이 수시로 바뀌어 빌드가 멈췄다(v0.9.40·v0.9.42)
  const sameSemver = fixture(t, { pluginVersions: { 'feature-dev@anthropic-plugin-directory': '1.0.1-fa4eb54397ee' } });
  assert.equal(callLib(sameSemver.env, `verify_plugin_lock "${lockFile}"`).status, 0);
  // 플러그인 판이 바뀌면 커밋 꼬리가 있어도 실패
  const bumped = fixture(t, { pluginVersions: { 'feature-dev@anthropic-plugin-directory': '1.0.2-fa4eb54397ee' } });
  assert.notEqual(callLib(bumped.env, `verify_plugin_lock "${lockFile}"`).status, 0);
  // superpowers 는 latest — 새 판이 나와도 빌드를 멈추지 않는다(WP-1336)
  const newer = fixture(t, { pluginVersions: { 'superpowers@superpowers-marketplace': '9.9.9' } });
  assert.equal(callLib(newer.env, `verify_plugin_lock "${lockFile}"`).status, 0);
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

test('dockerfilesBakePlaywrightCliWithHeadlessChromium', () => {
  // 화면 탐색 스킬은 브라우저를 playwright-cli 로만 다룬다 — 두 작업 공간 이미지 모두 손으로 깔지 않고 바로 쓰게 굳힌다(WP-1404).
  const files = [join(appDir, 'Dockerfile'), join(appDir, '..', 'workplace-agent-genia-code', 'Dockerfile')];
  const versions = files.map((p) => {
    const d = readFileSync(p, 'utf8');
    // 고정 버전으로 npm 전역 설치
    assert.match(d, /npm install -g [^;]*"@playwright\/cli@\$\{PLAYWRIGHT_CLI_VERSION\}"/, p);
    // cli 가 품은 Playwright 의 chromium 을 베이스 브라우저 폴더에 받는다 — GC 가 베이스 chromium 을 지우지 않게
    assert.match(d, /PLAYWRIGHT_SKIP_BROWSER_GC=1 node "\$core\/cli\.js" install --no-shell chromium/, p);
    // Pod 에는 화면·Google Chrome 이 없다 — 전역 설정으로 chromium headless 를 기본으로 두고, 빌드 때 실제로 열어 본다
    const cfg = d.match(/'(\{"browser":.*\})' > \/home\/agent\/\.playwright\/cli\.config\.json/)?.[1];
    assert.ok(cfg, p);
    assert.deepEqual(JSON.parse(cfg), { browser: { browserName: 'chromium', launchOptions: { channel: 'chromium', headless: true } } });
    assert.match(d, /playwright-cli open about:blank; \\\n\s+playwright-cli close/, p);
    // 품은 playwright-core 를 고정 이름으로 가리킨다 — 엔트리포인트가 PVC 의 설치 기록에 올린다(seed_browsers)
    assert.match(d, /ln -sfn "\$core" \/opt\/genia\/playwright-cli-core/, p);
    // 실행 때는 GC 를 끄지 않는다 — 끄면 저장소 Playwright 버전이 바뀔 때마다 옛 브라우저가 PVC 에 쌓인다
    assert.doesNotMatch(d, /^\s+PLAYWRIGHT_SKIP_BROWSER_GC=1 \\$/m, p);
    return d.match(/^ARG PLAYWRIGHT_CLI_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
  });
  assert.ok(versions[0]);
  assert.equal(versions[0], versions[1]); // 두 실행기가 같은 cli 로 탐색한다
});

test('seedBrowsersRegistersPlaywrightCliInstall', (t) => {
  // 저장소 Playwright 를 받을 때 GC 는 설치 기록(.links)에 있는 설치의 브라우저만 남긴다 — cli 의 chromium 이 지워지지 않게 올린다(WP-1404).
  const core = mkdtempSync(join(tmpdir(), 'gw-pwcore-'));
  t.after(() => rmSync(core, { recursive: true, force: true }));
  const f = fixture(t, { env: { GENIA_PLAYWRIGHT_CLI_CORE: core } });
  assert.equal(callLib(f.env, 'seed_browsers').status, 0);
  assert.ok(!existsSync(f.d('work', '.cache', 'ms-playwright', '.links', 'genia-playwright-cli'))); // browsers.json 없는 폴더는 설치가 아니다
  writeFileSync(join(core, 'browsers.json'), '{"browsers":[]}');
  assert.equal(callLib(f.env, 'seed_browsers').status, 0);
  assert.equal(f.read('work', '.cache', 'ms-playwright', '.links', 'genia-playwright-cli'), core);
});

test('startDisplayLaunchesXvfbOnlyWithoutDisplay', (t) => {
  // 탐색 스킬은 --headed 로 띄운다 — 화면 없는 Pod 에서는 가상 화면을 띄우고 DISPLAY 를 칸에 물려준다(WP-1404).
  const f = fixture(t);
  const xvfb = f.d('bin', 'fake-xvfb');
  writeFileSync(xvfb, `#!/bin/sh\nprintf '%s\\n' "$*" > "$FAKE_OUT/xvfb.args"\n`);
  chmodSync(xvfb, 0o755);
  const run = (env) => callLib({ ...f.env, GENIA_XVFB: xvfb, ...env }, 'start_display; wait; printf "%s" "${DISPLAY:-}"');
  const r = run({});
  assert.equal(r.stdout, ':99');
  assert.equal(f.read('out', 'xvfb.args'), ':99 -screen 0 1920x1080x24 -nolisten tcp\n');
  rmSync(f.d('out', 'xvfb.args'));
  // 이미 화면이 있으면 그대로 둔다
  assert.equal(run({ DISPLAY: ':5' }).stdout, ':5');
  assert.ok(!existsSync(f.d('out', 'xvfb.args')));
  // Xvfb 가 없으면 건너뛴다(DISPLAY 를 내보내지 않는다)
  assert.equal(callLib(f.env, 'start_display; printf "%s" "${DISPLAY:-}"').stdout, '');
});

test('dockerfilesInstallPortAndMacDefaultTools', () => {
  // Mac 에 기본으로 있어 스크립트가 당연히 쓰는 명령 — 없으면 live-stack·explore-stack 의 포트 찾기가 기동 타임아웃까지 헛돈다(WP-1404).
  // AI 는 Pod 에서 root 가 아니라 깔 수 없으니 이미지에 넣고, 빌드 때 lsof·ss·ip·nc 가 실제로 도는지 본다.
  const want = ['lsof', 'iproute2', 'netcat-openbsd', 'net-tools', 'psmisc', 'file', 'xxd', 'bsdextrautils', 'bc', 'zip', 'dnsutils', 'iputils-ping', 'rsync', 'uuid-runtime'];
  for (const p of [join(appDir, 'Dockerfile'), join(appDir, '..', 'workplace-agent-genia-code', 'Dockerfile')]) {
    const d = readFileSync(p, 'utf8');
    const apt = d.match(/apt-get install -y --no-install-recommends \\\n([^;]*);/)?.[1] ?? '';
    const pkgs = apt.split(/[\s\\]+/).filter(Boolean);
    for (const w of want) assert.ok(pkgs.includes(w), `${p}: ${w}`);
    assert.match(d, /lsof -v 2>&1 \| grep -q revision; ss -V; ip -V; nc -h 2>&1 \| grep -q OpenBSD/, p);
  }
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
  assert.deepEqual(f.read('out', 'npm.log').split('\n').filter(Boolean), ['install 1.60.0']);
  assert.doesNotMatch(e.log(), /oauth-secret-value|ghp_secrettoken|ak_testkey123/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

// WP-1500: AI 폴더(agent.conf)는 Pod 를 지워도 남는다 — 다른 실행기 템플릿으로 돌던 AI 의 cli=opencode 가 남아 있어도
// 부팅마다 cli=claude 로 덮어써 칸이 claude 로 떠야 한다(덮어쓰지 않으면 gw-opencode-loop 를 띄우다 ENOENT 로 멈췄다).
tmuxTest('bootOverwritesLeftoverCliWithClaude', async (t) => {
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const aiDir = f.d('work', 'agents', 'kodi');
  mkdirSync(aiDir, { recursive: true });
  writeFileSync(join(aiDir, 'agent.conf'), 'cli=opencode\n');
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  const conf = readFileSync(join(aiDir, 'agent.conf'), 'utf8');
  assert.match(conf, /^cli=claude$/m);
  assert.doesNotMatch(conf, /opencode/);
  assert.ok(f.read('out', 'pane-WP.env').split('\n').includes('arg /loop /genia-works:work-loop WP --queue "AI 개발팀"'));
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
  const f = fixture(t, { env: { FAKE_NPM_RENDEZVOUS: '2' } });
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
  // 버전별 한 번 — 같은 버전을 쓰는 프로젝트가 둘이어도 npm 은 한 번, 두 버전은 서로 기다리지 않고 함께 돌았다
  assert.deepEqual(f.read('out', 'npm.log').split('\n').filter(Boolean).sort(), ['install 1.60.0', 'install 1.61.0']);
  assert.ok(existsSync(f.d('out', 'npm-seen-1.60.0')) && existsSync(f.d('out', 'npm-seen-1.61.0')), '두 버전이 동시에 돌지 않았습니다');
  // PVC 의 고정 폴더에 받았다(WP-1683) — 옛 받기 표시는 더는 만들지 않는다
  for (const v of ['1.60.0', '1.61.0']) {
    assert.ok(existsSync(f.d('work', '.cache', 'ms-playwright', '.genia-installs', v, 'node_modules', 'playwright-core', 'browsers.json')), v);
    assert.ok(!existsSync(f.d('work', '.cache', 'ms-playwright', `.genia-chromium-${v}`)), v);
  }
  // 폴더 신뢰는 칸을 띄우기 전에 한 번에 적었다
  const trust = JSON.parse(f.read('home', '.claude.json')).projects;
  for (const k of ['AA', 'BB', 'CC']) assert.equal(trust[join(aiDir, 'repos', k)].hasTrustDialogAccepted, true);
  // 임시 폴더는 남기지 않는다
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('boot.')), []);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('sigtermDuringParallelBootExitsZeroWithoutWaiting', async (t) => {
  // 브라우저를 받는 중(npm 이 15초 붙잡힘)에 SIGTERM — 뒤에서 도는 일들이 on_term 을 막지 않고 바로 정리·종료한다.
  const f = fixture(t, { env: { FAKE_NPM_HANG: '1' } });
  severalProjects(f, [{ key: 'AA' }, { key: 'BB', pw: '1.61.0' }]);
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'npm-started-1.60.0')) && existsSync(f.d('out', 'npm-started-1.61.0')), '브라우저 받기 시작', 30000, e.log);
  const t0 = Date.now();
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
  assert.ok(Date.now() - t0 < 10000, 'SIGTERM 이 뒤에서 도는 일을 기다렸습니다');
  assert.ok(!existsSync(f.d('out', 'pane-AA.env')), '종료 신호를 받은 뒤에는 칸을 띄우지 않는다');
  // 서브셸뿐 아니라 실제 일을 하는 손자(npm·그 자식)까지 끝났고, 부팅 임시 폴더도 치웠다
  const pids = f.read('out', 'npm-pids').split('\n').filter(Boolean).map(Number);
  assert.equal(pids.length, 4); // 버전 둘 × (npm, sleep)
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), `pid ${pid} 가 아직 살아 있습니다`);
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('boot.')), []);
});

/**
 * AA(1.60.0)·BB(1.61.0) 로 한 번 부팅해 칸이 뜨면 끈다 — 재부팅 테스트의 첫 부팅. playwright-cli 의 core(rev 1700)를 이미지처럼 두고
 * (GENIA_PLAYWRIGHT_CLI_CORE — seed_browsers 가 설치 기록에 올린다) 그 chromium 은 PVC 에 진짜 폴더로 둔다(호스트에서 받은 모양).
 */
async function bootTwoVersionsThenStop(t) {
  const cli = mkdtempSync(join(tmpdir(), 'gw-pwcli-'));
  t.after(() => rmSync(cli, { recursive: true, force: true }));
  writeFileSync(join(cli, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', revision: '1700' }] }));
  const f = fixture(t, { env: { GENIA_PLAYWRIGHT_CLI_CORE: cli } });
  mkdirSync(pwPath(f, 'chromium-1700'), { recursive: true });
  writeFileSync(pwPath(f, 'chromium-1700', 'INSTALLATION_COMPLETE'), '');
  severalProjects(f, [{ key: 'AA' }, { key: 'BB', pw: '1.61.0' }]);
  const e = startEntrypoint(t, f.env);
  await until(() => ['AA', 'BB'].every((k) => existsSync(f.d('out', `pane-${k}.env`))), 'AA·BB 칸의 claude', 40000, e.log);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
  // AA 의 저장소가 Playwright 를 1.62.0 으로 올렸다 — work-loop 가 MAIN 을 새 main 으로 옮긴 모양(엔트리포인트의 fetch 는 작업 트리를 옮기지 않는다).
  writeFileSync(f.d('work', 'agents', 'kodi', 'repos', 'AA', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\npackages:\n\n  '@playwright/test@1.62.0':\n    resolution: {}\n");
  for (const k of ['AA', 'BB']) rmSync(f.d('out', `pane-${k}.env`));
  return f;
}

tmuxTest('rebootAfterVersionChangeDropsOnlyOldBrowsers', async (t) => {
  // 다른 저장소(BB)가 아직 쓰는 1.61 과 playwright-cli 의 chromium 은 남고, 아무도 쓰지 않게 된 1.60 만 사라진다(WP-1683).
  const f = await bootTwoVersionsThenStop(t);
  const e = startEntrypoint(t, f.env);
  await until(() => ['AA', 'BB'].every((k) => existsSync(f.d('out', `pane-${k}.env`))), '다시 띄운 AA·BB 칸', 40000, e.log);
  for (const n of ['chromium-1600', 'chromium_headless_shell-1600', join('.genia-installs', '1.60.0'), join('.links', '1.60.0')]) {
    assert.ok(!existsSync(pwPath(f, n)), `${n} 가 남았습니다\n${e.log()}`);
  }
  for (const n of ['chromium-1610', 'chromium_headless_shell-1610', 'chromium-1620', 'chromium_headless_shell-1620', join('.genia-installs', '1.61.0'), join('.genia-installs', '1.62.0'), 'chromium-1700']) {
    assert.ok(existsSync(pwPath(f, n)), `${n} 가 사라졌습니다\n${e.log()}`);
  }
  assert.match(e.log(), /브라우저 정리: removed chromium-1600/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('skipsPruneWhenAnyInstallFails', async (t) => {
  // 받기가 하나라도 실패하면 정리하지 않는다 — 실패한 버전 대신 쓸 수 있는 옛 브라우저를 지우지 않게. 칸은 그대로 띄운다.
  const f = await bootTwoVersionsThenStop(t);
  mkdirSync(pwPath(f, 'chromium-1500'), { recursive: true });
  const e = startEntrypoint(t, { ...f.env, FAKE_NPM_FAIL: '1.62.0' });
  await until(() => ['AA', 'BB'].every((k) => existsSync(f.d('out', `pane-${k}.env`))), '다시 띄운 AA·BB 칸', 40000, e.log);
  assert.ok(existsSync(pwPath(f, 'chromium-1500')));
  assert.ok(existsSync(pwPath(f, 'chromium-1600')));
  assert.match(e.log(), /브라우저 받기에 실패한 버전이 있어 이번에는 브라우저를 정리하지 않습니다/);
  assert.doesNotMatch(e.log(), /브라우저 정리: removed/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('legacyPlaywrightVersionStillPrunesBrowsers', async (t) => {
  // 1.48 형식(chromium-headless-shell 없음) 저장소만 있어도 받기가 성공으로 보여 안 쓰는 브라우저 정리가 돈다.
  const f = fixture(t, { env: { FAKE_NPM_LEGACY: '1.48.2' } });
  mkdirSync(pwPath(f, 'chromium-1500'), { recursive: true });
  writeFileSync(pwPath(f, 'chromium-1500', 'INSTALLATION_COMPLETE'), '');
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git'), '1.48.2'))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  assert.ok(!existsSync(pwPath(f, 'chromium-1500')), `chromium-1500 이 남았습니다\n${e.log()}`);
  assert.ok(existsSync(pwPath(f, 'chromium-1482', 'INSTALLATION_COMPLETE')));
  assert.match(e.log(), /브라우저 정리: removed chromium-1500/);
  assert.doesNotMatch(e.log(), /받지 못했습니다|정리하지 않습니다/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

// ---------------------------------------------------------------- 부팅 때 워크트리 정리(WP-1683)

/** 테스트용 git — 커밋 신원·전역 설정에 기대지 않는다. */
function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

/** MAIN/.claude/worktrees/<이슈 키> 워크트리(origin/main 에서 새 브랜치)와 work-loop 가 남기는 notes 파일 — 정리 후보가 되는 모양. */
function issueWorktree(main, key) {
  gitIn(main, 'worktree', 'add', '-q', `.claude/worktrees/${key}`, '-b', `fix/${key.toLowerCase()}`, 'origin/main');
  mkdirSync(join(main, '.work-loop', 'state', 'notes'), { recursive: true });
  writeFileSync(join(main, '.work-loop', 'state', 'notes', `${key}.md`), 'x');
  return join(main, '.claude', 'worktrees', key);
}

tmuxTest('bootSweepsFinishedIssueWorktreesBeforePanes', async (t) => {
  // Pod 가 뜰 때 칸을 띄우기 전에 모든 저장소(목록에 없는 OLD 포함)의 끝난 이슈 워크트리를 서버 상태로 지운다.
  // DONE 인 WP-1 만 사라지고, 진행 중인 WP-2 와 서버가 모르는(404 — 더는 소속이 아님) OLD-1 은 남는다.
  const f = fixture(t);
  const bare = h.bareRepo(f.d('git'), { '.gitignore': '.claude/worktrees/\n.work-loop/state/\n', 'README.md': 'repo\n' });
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bare)));
  const first = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, first.log);
  first.child.kill('SIGTERM');
  assert.equal((await first.exited).code, 0);
  rmSync(f.d('out', 'pane-WP.env'));

  const repos = f.d('work', 'agents', 'kodi', 'repos');
  const wp1 = issueWorktree(join(repos, 'WP'), 'WP-1');
  const wp2 = issueWorktree(join(repos, 'WP'), 'WP-2');
  gitIn(repos, 'clone', '-q', bare, 'OLD');
  const old1 = issueWorktree(join(repos, 'OLD'), 'OLD-1');
  writeFileSync(f.d('out', 'issues.json'), JSON.stringify({ 'WP-1': 'DONE', 'WP-2': 'IN_PROGRESS' }));

  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), '다시 띄운 WP 칸', 40000, e.log);
  assert.ok(!existsSync(wp1), `WP-1 이 남았습니다\n${e.log()}`);
  assert.ok(existsSync(wp2), 'WP-2 가 사라졌습니다');
  assert.ok(existsSync(old1), 'OLD-1 이 사라졌습니다');
  assert.match(e.log(), /워크트리 정리: WP\tremoved /);
  assert.match(e.log(), /워크트리 정리: OLD\tkept OLD-1: 상태 확인 실패\(8\)/);
  assert.ok(existsSync(f.d('work', 'agents', 'kodi', 'state', 'boot-sweep.log')));
  assert.deepEqual(f.read('out', 'issues.log').split('\n').filter(Boolean).sort(), ['OLD-1', 'WP-1', 'WP-2']);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

test('sweepWorktreesRunsOncePerPod', (t) => {
  // 한 Pod 에 한 번만 — 서버에 닿지 못해 남긴 것은 칸의 work-loop(2-1)가 맡는다. 플러그인에 agent-sweep 이 없으면 경고만.
  const f = fixture(t);
  const fake = f.d('fake-scripts');
  mkdirSync(fake);
  exe(join(fake, 'agent-sweep'), `#!/bin/sh
printf '%s\\n' "$1" >> "$FAKE_OUT/agent-sweep.log"
printf 'WP\\tremoved /x/WP-1\\n'
`);
  mkdirSync(f.d('work', 'agents', 'kodi', 'state'), { recursive: true });
  const calls = () => (existsSync(f.d('out', 'agent-sweep.log')) ? f.read('out', 'agent-sweep.log').split('\n').filter(Boolean) : []);
  const skipped = callLib(f.env, `check_required && GW_SCRIPTS="${fake}" && WORKTREES_SWEPT=1 && sweep_worktrees`);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.deepEqual(calls(), []);
  const twice = callLib(f.env, `check_required && GW_SCRIPTS="${fake}" && sweep_worktrees && sweep_worktrees && echo "swept=$WORKTREES_SWEPT"`);
  assert.equal(twice.status, 0, twice.stderr);
  assert.deepEqual(calls(), [f.d('work', 'agents', 'kodi')]);
  assert.match(twice.stderr, /워크트리 정리: WP\tremoved \/x\/WP-1/);
  assert.match(twice.stdout, /swept=1/);
  const none = callLib(f.env, `check_required && GW_SCRIPTS="${f.d('none')}" && sweep_worktrees && echo ok`);
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stderr, /agent-sweep 이 없습니다/);
  assert.match(none.stdout, /^ok$/m);
});

// ---------------------------------------------------------------- /work/tmp 정리(WP-1683)

/** 파일·폴더의 수정 시각을 days 일 전으로 맞춘다(음수면 앞으로). 심볼릭 링크는 링크 자신(lutimes). */
const age = (path, days) => {
  const at = new Date(Date.now() - days * 24 * 3600 * 1000);
  (lstatSync(path).isSymbolicLink() ? lutimesSync : utimesSync)(path, at, at);
};
/**
 * 도는 동안의 tmp 정리는 수정 시각(mtime)과 상태 변경 시각(ctime)이 둘 다 오래되어야 지운다 — 테스트는 ctime 을 되돌릴 수 없으므로,
 * 「지워져야 하는 것」을 보는 테스트는 나이 기준을 0분(GENIA_TMP_MAX_AGE_MIN=0 — ctime 조건은 바로 맞는다)으로 두고 mtime 만으로 가른다.
 * 그때 「최근에 바뀐 것」은 mtime 을 앞으로(미래) 맞춰 나타낸다.
 */
const SWEEP_NOW = { GENIA_TMP_MAX_AGE_MIN: '0' };

test('prepareDirsEmptiesTmpAtBoot', (t) => {
  // 부팅 때는 이 컨테이너의 어느 프로세스도 아직 /work/tmp 를 쓰지 않는다 — 지난 Pod 가 남긴 것을 모두 지운다.
  const f = fixture(t);
  const tmp = f.d('work', 'tmp');
  mkdirSync(join(tmp, 'dir'), { recursive: true });
  writeFileSync(join(tmp, 'file'), 'x');
  writeFileSync(join(tmp, 'dir', 'inner'), 'x');
  symlinkSync(join(tmp, 'file'), join(tmp, 'link'));
  mkdirSync(join(tmp, 'claude-1001', 'x'), { recursive: true });
  const r = callLib(f.env, 'check_required && prepare_dirs');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test('cleanTmpWarnsButContinuesOnUndeletable', (t) => {
  // dind 가 bind mount 로 만든 root 소유 파일처럼 지우지 못하는 것이 있어도 경고만 남기고 부팅을 계속한다.
  if (process.getuid?.() === 0) return t.skip('root 는 권한과 상관없이 지운다');
  const f = fixture(t);
  const locked = f.d('work', 'tmp', 'locked');
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(locked, 'f'), 'x');
  chmodSync(locked, 0o500);
  let r;
  try {
    r = callLib(f.env, 'check_required && prepare_dirs && echo after');
  } finally {
    chmodSync(locked, 0o700); // fixture 의 정리(t.after)가 지울 수 있게 바로 되돌린다
  }
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /\/work\/tmp 를 다 비우지 못했습니다 — 1개 남음/);
  assert.match(r.stdout, /^after$/m);
});

test('sweepTmpDeletesOnlyOldFilesAndKeepsSocketsAndClaudeDirs', (t) => {
  const f = fixture(t, { env: SWEEP_NOW });
  const tmp = f.d('work', 'tmp');
  const p = (...x) => join(tmp, ...x);
  mkdirSync(p('gwA'), { recursive: true });
  mkdirSync(p('gwB'));
  mkdirSync(p('claude-1001', 's', 'scratchpad'), { recursive: true });
  for (const x of ['old.txt', 'new.txt', join('gwA', 'old'), join('gwA', 'new')]) writeFileSync(p(x), 'x');
  assert.equal(spawnSync('mkfifo', [p('old.fifo')]).status, 0);
  // 4일 전 — 폴더 mtime 은 안을 다 만든 뒤 맞춘다(안에 만들면 다시 바뀐다).
  for (const x of ['old.txt', join('gwA', 'old'), 'old.fifo', 'gwB', join('claude-1001', 's', 'scratchpad'), join('claude-1001', 's'), 'claude-1001']) age(p(x), 4);
  // 「최근에 바뀐 것」 — 나이 기준 0분에서는 mtime 을 앞으로 맞춰야 오래되지 않은 것이 된다(위 SWEEP_NOW).
  for (const x of ['new.txt', join('gwA', 'new')]) age(p(x), -1);
  const r = callLib(f.env, 'sweep_tmp');
  assert.equal(r.status, 0, r.stderr);
  for (const x of ['new.txt', join('gwA', 'new'), join('claude-1001', 's', 'scratchpad'), 'old.fifo']) assert.ok(existsSync(p(x)), `${x} 가 사라졌습니다`);
  for (const x of ['old.txt', join('gwA', 'old'), 'gwB']) assert.ok(!existsSync(p(x)), `${x} 가 남았습니다`);
});

test('sweepTmpKeepsJustCreatedFilesWithRestoredOldMtime', (t) => {
  // tar·npm 은 받은 파일의 mtime 을 원래 값(1985 등)으로 되살린다 — 방금 만든 파일이어도 mtime 만 보면 지운다.
  // 상태 변경 시각(ctime — 만든·바꾼 때, 되돌릴 수 없다)도 기준을 넘어야 지운다(코드 리뷰). 기본 3일 기준으로 돈다.
  const f = fixture(t);
  const tmp = f.d('work', 'tmp');
  mkdirSync(join(tmp, 'pkg'), { recursive: true });
  writeFileSync(join(tmp, 'pkg', 'index.js'), 'x');
  symlinkSync('index.js', join(tmp, 'pkg', 'main.js'));
  for (const x of ['index.js', 'main.js']) {
    assert.equal(spawnSync('touch', ['-h', '-d', '1985-10-26 01:21', join(tmp, 'pkg', x)]).status, 0);
  }
  const r = callLib(f.env, 'sweep_tmp');
  assert.equal(r.status, 0, r.stderr);
  for (const x of ['index.js', 'main.js']) assert.ok(lstatSync(join(tmp, 'pkg', x), { throwIfNoEntry: false }), `${x} 가 사라졌습니다`);
});

test('sweepTmpKeepsChromeSingletonLinks', (t) => {
  // Chrome 프로필의 잠금(SingletonLock·SingletonSocket·SingletonCookie)은 심볼릭 링크다 — 오래 도는 브라우저의 것은 mtime 이 오래되어도
  // 지우면 다른 Chrome 이 같은 프로필을 열어 깨진다. 이름이 Singleton* 인 링크는 두고, 다른 오래된 링크는 지운다.
  const f = fixture(t, { env: SWEEP_NOW });
  const prof = f.d('work', 'tmp', 'playwright_chromiumdev_profile-x');
  mkdirSync(prof, { recursive: true });
  for (const n of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'old.link']) {
    symlinkSync(`target-${n}`, join(prof, n));
    age(join(prof, n), 4);
  }
  const r = callLib(f.env, 'sweep_tmp');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(prof).sort(), ['SingletonCookie', 'SingletonLock', 'SingletonSocket']);
});

test('sweepTmpDueRunsAtMostOncePerInterval', (t) => {
  // 감독 회차마다 부르지만 GENIA_TMP_SWEEP_EVERY(운영 1시간)에 한 번만 돈다 — 기록은 AI 폴더의 state/tmp-swept(에포크 초).
  const f = fixture(t, { env: { ...SWEEP_NOW, GENIA_TMP_SWEEP_EVERY: '3600' } });
  const tmp = f.d('work', 'tmp');
  const aiDir = f.d('work', 'agents', 'kodi');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(aiDir, 'state'), { recursive: true });
  const due = () => callLib(f.env, `check_required && adopt_plugin_scripts "${f.d('plugin', 'scripts')}" && sweep_tmp_due`);
  const old = (name) => {
    writeFileSync(join(tmp, name), 'x');
    age(join(tmp, name), 4);
  };
  old('a');
  assert.equal(due().status, 0);
  assert.ok(!existsSync(join(tmp, 'a')));
  assert.ok(existsSync(join(aiDir, 'state', 'tmp-swept')));
  old('b');
  assert.equal(due().status, 0);
  assert.ok(existsSync(join(tmp, 'b')), '한 시간 안에 다시 돌았습니다');
  writeFileSync(join(aiDir, 'state', 'tmp-swept'), `${Math.floor(Date.now() / 1000) - 7200}\n`);
  assert.equal(due().status, 0);
  assert.ok(!existsSync(join(tmp, 'b')));
});

tmuxTest('supervisorSweepsTmpWhileRunning', async (t) => {
  // 도는 동안에도 감독 회차가 3일 지난 tmp 를 지운다(Claude 는 boot 모드 감독 루프가 회차마다 sweep_tmp_due 를 부른다).
  const f = fixture(t, { env: { ...SWEEP_NOW, GENIA_TMP_SWEEP_EVERY: '0' } });
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify(oneProject(bareRepo(f.d('git')))));
  const e = startEntrypoint(t, f.env);
  await until(() => existsSync(f.d('out', 'pane-WP.env')), 'WP 칸의 claude', 30000, e.log);
  const stale = f.d('work', 'tmp', 'stale.bin');
  writeFileSync(stale, 'x');
  age(stale, 4);
  await until(() => !existsSync(stale), '감독 회차의 tmp 정리', 15000, e.log);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

test('tickSweepsTmpOnceEvenWhenItCannotLaunch', (t) => {
  // tick 모드(Gen:iA·Codex·OpenCode)는 로그인 전(can_launch 실패)에도 회차마다 tmp 정리를 부른다 — 로그인을 오래 기다리는 Pod 도 tmp 가 찬다.
  // 띄울 수 있을 때도 한 회차에 한 번만(supervise_once 가 따로 부르지 않는다).
  const f = fixture(t);
  const fake = f.d('fake-scripts');
  mkdirSync(fake);
  exe(join(fake, 'agent-window'), '#!/bin/sh\nexit 0\n');
  mkdirSync(f.d('work', 'agents', 'kodi', 'state'), { recursive: true });
  const run = (launch) =>
    callLib(f.env, `check_required && GW_SCRIPTS="${fake}" && PROJECTS_READY=1 && EVENTS_WARNED=1 && sweep_tmp_due() { echo swept; } && can_launch() { return ${launch}; } && tick && tick`);
  for (const launch of [1, 0]) {
    const r = run(launch);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['swept', 'swept'], `can_launch=${launch}`);
  }
});

test('bootSupervisorSweepsTmpEveryRound', (t) => {
  // boot 모드(Claude)는 회차마다 supervise_once 뒤에 tmp 정리를 한 번 부른다(supervise_nap 을 세 번째에 끝내 두 회차만 본다).
  const f = fixture(t);
  const r = callLib(
    f.env,
    'n=0; supervise_nap() { n=$((n + 1)); [ "$n" -le 2 ] || exit 0; }; start_projects() { echo boot; }; ensure_events() { :; }; supervise_once() { echo once; }; sweep_tmp_due() { echo swept; }; run_supervisor boot',
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['boot', 'once', 'swept', 'once', 'swept']);
});

test('bgWaitTimeout_killsCommandAndWatchdogOnAbortBoot', async (t) => {
  // 종료 신호(abort_boot)에 명령뿐 아니라 지킴이(sleep 뒤 kill_tree)도 끈다 — 지킴이가 남으면 나중에 같은 pid 를 물려받은 다른 프로세스를 끌 수 있다.
  const f = fixture(t);
  const secs = 250 + (process.pid % 40); // 이 테스트만의 sleep 길이 — 다른 sleep 과 섞이지 않게
  const alive = (n) => spawnSync('pgrep', ['-f', `^sleep ${n}$`]).status === 0;
  const sh = spawn('bash', ['-c', `. "${lib}" && trap 'abort_boot; exit 0' TERM && bg_wait_timeout ${secs} sleep ${secs + 1}`], { env: f.env, stdio: 'ignore' });
  t.after(() => sh.kill('SIGKILL'));
  await until(() => alive(secs) && alive(secs + 1), '명령과 지킴이');
  sh.kill('SIGTERM');
  await new Promise((r) => sh.once('exit', r));
  await until(() => !alive(secs) && !alive(secs + 1), '명령과 지킴이가 함께 끝남', 5000);
});

test('bgWaitTimeout_returnsCommandStatusAndCleansBgPids', (t) => {
  // 제한 안에 끝나면 명령의 종료 코드를 돌려주고, 명령·지킴이 pid 를 BG_PIDS 에서 뺀다(다른 뒤의 일은 남긴다). 제한을 넘기면 끊어 128 이상.
  const f = fixture(t);
  const r = callLib(f.env, 'BG_PIDS=" 111"; bg_wait_timeout 5 sh -c "exit 3"; rc=$?; printf "rc=%s pids=%s\\n" "$rc" "$BG_PIDS"; bg_wait_timeout 1 sleep 30; echo "late=$?"');
  assert.match(r.stdout, /^rc=3 pids=111 $/m);
  const late = Number(r.stdout.match(/^late=(\d+)$/m)?.[1]);
  assert.ok(late >= 128, r.stdout);
});

// ---------------------------------------------------------------- 공용 감독·플러그인 도우미(WP-1445)

test('runSupervisor_diesOnUnknownModeWithoutLooping', (t) => {
  // 감독 모드는 tick(Gen:iA·Codex·OpenCode)·boot(Claude) 둘뿐이다 — 오타면 감독 없이 도는 대신 바로 끝나야 Pod 가 다시 뜬다.
  const f = fixture(t);
  const r = callLib(f.env, 'run_supervisor tic');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /알 수 없는 감독 모드입니다 — tic/);
});

test('useBakedPlugin_adoptsScriptsOnlyWhenDriverExists', (t) => {
  // 굳힌 플러그인은 그 실행기의 구동기(<하위 폴더>/driver.mjs)가 있어야 쓴다 — 없으면 1 이고 GW_SCRIPTS 를 정하지 않는다.
  const f = fixture(t);
  const plugin = dirname(pluginScripts);
  const missing = callLib(f.env, `use_baked_plugin "${plugin}" no-such-runner; echo "rc=$? gw=\${GW_SCRIPTS:-}"`);
  assert.match(missing.stdout, /^rc=1 gw=$/m, missing.stderr);
  const ok = callLib(f.env, `use_baked_plugin "${plugin}" codex; echo "rc=$? gw=$GW_SCRIPTS"`);
  assert.match(ok.stdout, /^rc=0 gw=.*plugins\/genia-works\/scripts$/m, ok.stderr);
});
