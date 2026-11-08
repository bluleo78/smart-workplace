// Codex 작업 공간 엔트리포인트 테스트(WP-1297) — Claude Code 이미지의 lib.sh + 이 이미지의 lib-codex.sh 함수를 하나씩, 그리고 bin/entrypoint 전체를 돌려 본다.
// codex 는 PATH 앞의 가짜(모델 목록 JSON 을 내고, exec 면 받은 인자·env 를 남기고 기다린다)로, gh·npx·curl(맡는 프로젝트 조회만)도 가짜로 바꾼다.
// tmux 는 진짜를 테스트마다 격리한 서버(-L)로 쓰고, 플러그인은 저장소의 진짜 것(scripts·codex 구동기·genia/loop.js·hooks·skills)을 링크한다 —
// 칸 명령(agent-project 의 codex 분기 → gw-codex-loop → codex/driver.mjs)과 칸이 물려받는 env 를 진짜로 확인하려는 것이다.
// gw-models 만 가짜(받은 본문·신원을 남긴다)로 바꾼다. 키·로그인 정보는 모두 가짜 값이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h from '../../workplace-agent-claude-code/tests/harness.mjs';
import { bareRepo, exe, tmuxTest, until } from '../../workplace-agent-claude-code/tests/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repoRoot = join(appDir, '..', '..');
const lib = join(repoRoot, 'apps', 'workplace-agent-claude-code', 'bin', 'lib.sh');
const libCodex = join(appDir, 'bin', 'lib-codex.sh');
const entrypoint = join(appDir, 'bin', 'entrypoint');
const pluginRoot = join(repoRoot, 'plugins', 'genia-works');
const pluginScripts = join(pluginRoot, 'scripts');


const CONFIG = {
  agent: { userId: 42, username: 'kodi', tenantId: 3, generation: 7 },
  works: { apiUrl: 'http://127.0.0.1:9/api/v1', mcpUrl: 'http://127.0.0.1:9/mcp' },
  template: { name: 'codex', version: '1' },
  config: { model: 'gpt-6-luna', effort: 'high', queue: 'AI 개발팀' },
  plugins: [],
};

/** 가짜 로그인 정보(Codex auth.json 모양) — 원문이 로그에 나오지 않는지도 이 값으로 본다. */
const LOGIN = '{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"access_token":"fake-access-value","refresh_token":"fake-refresh-value","id_token":"x.y.z","account_id":"acc"}}';

/** codex debug models 가짜 출력 — 숨김(hide) 항목과 뒤섞인 priority 를 넣어 거르기·정렬을 본다. */
const MODELS_RAW = {
  models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 3, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }] },
    { slug: 'gpt-daybreak', display_name: 'Daybreak', visibility: 'hide', priority: 0, supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', priority: 4, default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low', description: 'x' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'max' }] },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'medium' }] },
  ],
};
const MODELS_REPORTED = {
  models: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['medium'] },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'high', 'ultra'] },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'max'] },
  ],
};

/**
 * 테스트 하나의 격리 환경 — 홈·/run/genia·/work·가짜 명령·굳힌 플러그인 폴더·격리 tmux.
 * 굳힌 플러그인 폴더는 이미지가 COPY 하는 폴더들을 저장소의 진짜 것으로 링크하고, scripts 는 파일마다 링크하되 gw-models 만 가짜로 둔다.
 */
function fixture(t, { env: extra = {}, gwModels = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-codex-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['home', 'run', 'work', 'bin', 'out', 'tmp', 'plugin/scripts']) mkdirSync(d(p), { recursive: true });
  writeFileSync(d('run', 'config.json'), JSON.stringify(CONFIG));
  writeFileSync(d('run', 'agent-key'), 'ak_testkey123\n');
  mkdirSync(d('run', 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(d('run', 'repo-tokens', 'github', 'github.com'), 'ghp_secrettoken\n');
  writeFileSync(d('tmp', 'system.pem'), 'SYSTEM-ROOTS\n');
  writeFileSync(d('out', 'models.raw.json'), JSON.stringify(MODELS_RAW));

  exe(d('bin', 'gh'), `#!/bin/sh
printf 'args %s\\n' "$*" >> "$FAKE_OUT/gh.log"
[ "$1 $2" = "auth login" ] && cat >/dev/null
exit 0
`);
  exe(d('bin', 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_OUT/npx.log"
exit 0
`);
  // 가짜 codex — --version, debug models(FAKE_OUT/models.raw.json, models-fail 이 있으면 stderr 에 비밀 비슷한 줄을 내고 3),
  // exec(구동기가 부른다 — 칸 폴더 이름별로 받은 env·인자를 남기고 기다린다. MCP 토큰은 값 대신 있음만 적는다).
  exe(d('bin', 'codex'), `#!/bin/sh
case "$1" in
  --version) [ -n "\${FAKE_CODEX_BROKEN:-}" ] && exit 1; echo "codex-cli 0.167.0-fake"; exit 0 ;;
  debug)
    [ "$2" = models ] || exit 2
    n=$(cat "$FAKE_OUT/models-count" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_OUT/models-count"
    printf '%s\\n' "$CODEX_HOME" > "$FAKE_OUT/models-home"
    ls "$FAKE_OUT" | grep -c '^exec-.*\\.env$' >> "$FAKE_OUT/models-panes"
    if [ -f "$FAKE_OUT/models-fail" ]; then echo "stderr-should-not-leak" >&2; exit 3; fi
    [ -f "$FAKE_OUT/models-hang" ] && exec sleep 300
    cat "$FAKE_OUT/models.raw.json"; exit 0 ;;
  exec)
    k=$(basename "$PWD")
    { printf 'CODEX_HOME=%s\\n' "$CODEX_HOME"
      env | grep -E '^(GENIA_WORKS_(AS|AGENT_DIR|RUNNER_WAKES|MCP_URL|TENANT)|GENIA_AGENT_GENERATION)=' | sort
      [ -n "$GENIA_WORKS_MCP_TOKEN" ] && echo 'mcp-token-present'
      for a in "$@"; do printf 'arg %s\\n' "$a"; done; } > "$FAKE_OUT/exec-$k.tmp"
    mv "$FAKE_OUT/exec-$k.tmp" "$FAKE_OUT/exec-$k.env"
    # exec 하지 않고 기다린다 — 이 명령줄(codex exec … --skip-git-repo-check)이 남아 있어야 엔트리포인트가 칸이 도는 것을 안다(codex_panes_busy).
    sleep 300 & trap 'kill $! 2>/dev/null; exit 0' TERM INT; wait ;;
esac
exit 2
`);
  // 가짜 curl — 맡는 프로젝트 조회만 FAKE_OUT/projects.json 으로 답하고, 나머지는 진짜 curl 로 보낸다(닿지 않는 127.0.0.1:9).
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

  // 이미지가 COPY 하는 플러그인 폴더(Dockerfile)를 진짜 것으로 링크한다 — gw-codex-loop 가 ../codex/driver.mjs 를, 구동기가 ../genia/loop.js·
  // ../hooks/lib.js·../skills 를 찾는다.
  for (const p of ['codex', 'genia', 'hooks', 'skills', '.claude-plugin', 'package.json']) symlinkSync(join(pluginRoot, p), d('plugin', p));
  for (const f of readdirSync(pluginScripts)) {
    if (f === 'gw-models') continue;
    symlinkSync(join(pluginScripts, f), d('plugin', 'scripts', f));
  }
  if (gwModels) {
    exe(d('plugin', 'scripts', 'gw-models'), `#!/bin/sh
if [ -f "$FAKE_OUT/gw-models-fail" ]; then echo "gw-models: 모델 목록 보고 실패(HTTP 503) — 보고하지 않고 계속합니다" >&2; exit 0; fi
n=$(ls "$FAKE_OUT" | grep -c '^gw-models-[0-9]')
{ printf 'as=%s\\n' "$GENIA_WORKS_AS"; cat; } > "$FAKE_OUT/gw-models-$((n + 1))"
exit 0
`);
  }
  writeFileSync(d('out', 'projects.json'), '[]');

  const { wrapper, tmux } = h.isolatedTmux(d('bin'), 'gwcodex');
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
    GENIA_SYSTEM_CA: d('tmp', 'system.pem'),
    CODEX_PLUGIN_DIR: d('plugin'),
    DOCKER_HOST: `unix://${d('no-docker.sock')}`,
    PLAYWRIGHT_BROWSERS_PATH: d('work', '.cache', 'ms-playwright'),
    GENIA_BASE_BROWSERS: d('no-base-browsers'),
    GENIA_PLAYWRIGHT_CLI_CORE: d('no-playwright-cli'),
    GENIA_XVFB: d('no-xvfb'), // 시험 기계에 Xvfb 가 있어도 진짜 화면을 띄우지 않는다
    GENIA_DIND_WAIT: '0',
    GENIA_SUPERVISE_INTERVAL: '1',
    GW_TMUX: wrapper,
    FAKE_OUT: d('out'),
    // 칸의 codex exec 찾기 — 이 fixture 의 가짜 codex 만 보게 좁힌다(테스트를 돌리는 컴퓨터의 다른 codex 와 섞이지 않게).
    CODEX_EXEC_PATTERN: `${d('bin')}/codex exec .*--skip-git-repo-check`,
    ...extra,
  };
  const reports = () =>
    readdirSync(d('out'))
      .filter((n) => /^gw-models-\d+$/.test(n))
      .sort()
      .map((n) => readFileSync(d('out', n), 'utf8'));
  const modelsCalls = () => (existsSync(d('out', 'models-count')) ? Number(readFileSync(d('out', 'models-count'), 'utf8').trim()) : 0);
  return { root, d, env, tmux, reports, modelsCalls, read: (...p) => readFileSync(d(...p), 'utf8') };
}

/** lib.sh + lib-codex.sh 를 읽고 함수(셸 한 줄)를 부른다. */
const callLib = (env, script) => h.callLib([lib, libCodex], env, script);
/** 엔트리포인트를 뒤에서 띄운다 — 끝나기를 기다리는 exited 와 지금까지의 로그. */
const startEntrypoint = (t, env) => h.startEntrypoint(t, entrypoint, env);
/** 지금까지 돈 감독 회차 수 — 시간 대신 회차를 기다린다. */
const ticks = (f) => h.ticks(f.d('work', 'agents', 'kodi'));
const BOOT = 'check_required && prepare_dirs && use_plugin && codex_env';
const parseReport = (r) => {
  const [first, ...rest] = r.split('\n');
  return { as: first.replace(/^as=/, ''), body: JSON.parse(rest.join('\n')) };
};

// ---------------------------------------------------------------- 플러그인(use_plugin)

test('usePlugin_adoptsBakedPluginScripts', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin && echo "GW=$GW_SCRIPTS"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^GW=${f.d('plugin', 'scripts')}$`, 'm'));
});

test('usePlugin_failsWhenCodexDriverMissing', (t) => {
  // 구동기(codex/driver.mjs)가 없는 플러그인으로는 칸을 띄울 수 없다 — 엔트리포인트가 이것으로 끝낸다.
  const f = fixture(t);
  rmSync(f.d('plugin', 'codex'));
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin');
  assert.notEqual(r.status, 0);
});

// ---------------------------------------------------------------- Codex 설정(write_codex_config)

test('writeCodexConfig_overwritesWithModelEffortAndFileStore', (t) => {
  const f = fixture(t);
  const home = f.d('work', 'agents', 'kodi', 'codex');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.toml'), 'model = "old"\nstale = true\n');
  const r = callLib(f.env, `${BOOT} && write_codex_config && echo "HOME=$CODEX_HOME"`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^HOME=${home}$`, 'm'));
  assert.equal(statSync(home).mode & 0o777, 0o700);
  const toml = readFileSync(join(home, 'config.toml'), 'utf8');
  const keys = toml.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(keys, ['cli_auth_credentials_store = "file"', 'check_for_update_on_startup = false', 'model = "gpt-6-luna"', 'model_reasoning_effort = "high"']);
  // MCP·승인·hook 은 구동기가 -c 로 넘긴다 — 설정 파일에 두 벌 적지 않는다
  assert.doesNotMatch(toml, /mcp_servers|approval|hooks|stale/);
});

test('writeCodexConfig_skipsMalformedOrEmptyValues', (t) => {
  // 따옴표·개행이 든 값은 TOML 을 깨거나 다른 키를 끼워 넣을 수 있다 — 넣지 않고 경고한다. 빈 값은 조용히 뺀다(codex 기본값).
  const f = fixture(t);
  writeFileSync(f.d('run', 'config.json'), JSON.stringify({ ...CONFIG, config: { model: 'gpt"\nsandbox_mode = "x', effort: '' } }));
  const r = callLib(f.env, `${BOOT} && write_codex_config`);
  assert.equal(r.status, 0, r.stderr);
  const toml = f.read('work', 'agents', 'kodi', 'codex', 'config.toml');
  assert.doesNotMatch(toml, /^model|sandbox_mode/m);
  assert.match(toml, /^cli_auth_credentials_store = "file"$/m);
  assert.match(r.stderr, /모델 값의 꼴이 이상해 넣지 않습니다/);
  assert.doesNotMatch(r.stderr, /추론 강도/);
});

// ---------------------------------------------------------------- 전역 지시(write_codex_agents_md)

test('writeCodexAgentsMd_pointsToUsingSuperpowersSkillEveryBoot', (t) => {
  // Codex 는 세션 시작 hook 을 돌리지 않는다 — superpowers 의 using-superpowers 안내를 $CODEX_HOME/AGENTS.md(전역 지시)로 싣는다. 매번 새로 쓴다.
  const f = fixture(t);
  const skill = f.d('home', '.agents', 'skills', 'superpowers', 'using-superpowers', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: using-superpowers\n---\n');
  const out = f.d('work', 'agents', 'kodi', 'codex', 'AGENTS.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, 'stale\n');
  const r = callLib(f.env, `${BOOT} && write_codex_agents_md`);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(out, 'utf8');
  assert.doesNotMatch(md, /stale/);
  assert.ok(md.includes(`using-superpowers 스킬 파일 ${skill} 을 읽고 그대로 따른다`), md);
  assert.match(md, /references\/codex-tools\.md/);
  assert.equal(statSync(out).mode & 0o777, 0o600);
});

test('writeCodexAgentsMd_removesStaleFileAndWarnsWhenSkillMissing', (t) => {
  // 이미지에 스킬이 없으면 없는 경로를 가리키지 않게 옛 파일을 지우고 경고만 한다.
  const f = fixture(t);
  const out = f.d('work', 'agents', 'kodi', 'codex', 'AGENTS.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, 'stale\n');
  const r = callLib(f.env, `${BOOT} && write_codex_agents_md`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(out), false);
  assert.match(r.stderr, /using-superpowers 스킬\(.*\)이 없습니다/);
});

// ---------------------------------------------------------------- 로그인 정보(seed_login)

test('seedLogin_copiesOnFirstBootKeepsOnSameVersionAndReplacesOnNewVersion', (t) => {
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  const run = (version) => callLib({ ...f.env, GENIA_LOGIN_VERSION: version }, `${BOOT} && seed_login`);
  const auth = f.d('work', 'agents', 'kodi', 'codex', 'auth.json');
  const mark = f.d('work', 'agents', 'kodi', 'state', 'login-version');

  // 처음 — 600 으로 복사하고 표식을 적는다. 원문은 로그에 없다.
  const first = run('11');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(auth, 'utf8'), `${LOGIN}\n`); // gw_write_atomic 이 줄바꿈 하나를 붙인다
  assert.equal(statSync(auth).mode & 0o777, 0o600);
  assert.equal(readFileSync(mark, 'utf8').trim(), '11');
  assert.doesNotMatch(first.stdout + first.stderr, /fake-access-value|fake-refresh-value/);

  // 같은 버전 — codex 가 스스로 갱신해 다시 쓴 보관본을 옛 Secret 값으로 덮지 않는다.
  writeFileSync(auth, '{"auth_mode":"chatgpt","tokens":{"refresh_token":"refreshed-by-codex"}}');
  assert.equal(run('11').status, 0);
  assert.match(readFileSync(auth, 'utf8'), /refreshed-by-codex/);

  // 버전이 바뀜(새로 연결) — 덮어쓴다.
  assert.equal(run('12').status, 0);
  assert.equal(readFileSync(auth, 'utf8'), `${LOGIN}\n`);
  assert.equal(readFileSync(mark, 'utf8').trim(), '12');
});

test('seedLogin_removesCopyAndMarkerWhenMountDisappears', (t) => {
  // 연결을 끊으면 runner 가 마운트를 뺀다 — 보관본·표식을 지워 실제로 끊기게 하고 경고를 남긴다.
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  assert.equal(callLib({ ...f.env, GENIA_LOGIN_VERSION: '11' }, `${BOOT} && seed_login`).status, 0);
  rmSync(f.d('run', 'login-info'));
  const r = callLib(f.env, `${BOOT} && seed_login`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'codex', 'auth.json')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'state', 'login-version')), false);
  assert.match(r.stderr, /ChatGPT 로그인 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요\(연결 전에는 칸을 띄우지 않습니다\)/);
});

// ---------------------------------------------------------------- 모델 목록 보고(report_models)

test('reportModels_sendsListedModelsSortedByPriorityAsThisAgent', (t) => {
  // 칸에 보이는 것(visibility list)만 priority 순으로 {id, label, efforts} — 신원은 이 AI, codex 는 이 AI 의 CODEX_HOME 으로 묻는다.
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && report_models`);
  assert.equal(r.status, 0, r.stderr);
  const reports = f.reports();
  assert.equal(reports.length, 1, r.stderr);
  const { as, body } = parseReport(reports[0]);
  assert.equal(as, 'kodi');
  assert.deepEqual(body, MODELS_REPORTED);
  assert.equal(f.read('out', 'models-home').trim(), f.d('work', 'agents', 'kodi', 'codex'));
  assert.match(r.stderr, /Codex 모델 목록을 알렸습니다\(3개\)/);
  assert.ok(existsSync(f.d('work', 'agents', 'kodi', 'state', 'models-reported')));
  // 임시 파일을 남기지 않는다
  assert.deepEqual(readdirSync(f.d('work', 'tmp')).filter((n) => n.startsWith('codex-models.')), []);
});

test('reportModels_waitsForIntervalAfterSuccess', (t) => {
  // 한 번 알린 뒤에는 간격(CODEX_MODELS_INTERVAL)이 지나기 전까지 다시 묻지 않는다 — 감독 회차(60초)마다 codex 를 부르지 않게.
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && report_models && report_models && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.modelsCalls(), 1);
  assert.equal(f.reports().length, 1);
  const again = callLib({ ...f.env, CODEX_MODELS_INTERVAL: '0' }, `${BOOT} && report_models && report_models`);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(f.modelsCalls(), 3);
});

test('reportModels_warnsWithExitCodeOnlyAndRetriesAfterFailure', (t) => {
  // codex 가 실패하면 종료 코드만 남기고(stderr 는 버린다) 보고하지 않는다. 다시 해 볼 때(CODEX_MODELS_RETRY)까지는 묻지 않는다.
  const f = fixture(t);
  writeFileSync(f.d('out', 'models-fail'), '');
  const r = callLib(f.env, `${BOOT} && report_models && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.modelsCalls(), 1);
  assert.equal(f.reports().length, 0);
  assert.match(r.stderr, /Codex 모델 목록을 읽지 못했습니다\(codex 종료 코드 3 — /);
  assert.doesNotMatch(r.stderr, /stderr-should-not-leak/);
  // 다시 해 볼 때가 되면(여기서는 0초) 다시 묻고, 성공하면 알린다
  rmSync(f.d('out', 'models-fail'));
  const retry = callLib({ ...f.env, CODEX_MODELS_RETRY: '0' }, `${BOOT} && CODEX_MODELS_NEXT=0 && report_models`);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.reports().length, 1);
});

test('reportModels_retriesSoonWhenGwModelsReportsFailure', (t) => {
  // gw-models 는 늘 0 으로 끝나고 실패를 stderr 한 줄로 알린다 — 그 줄을 로그에 옮기고 성공으로 치지 않는다(6시간 기다리지 않게).
  const f = fixture(t);
  writeFileSync(f.d('out', 'gw-models-fail'), '');
  const r = callLib({ ...f.env, CODEX_MODELS_RETRY: '0' }, `${BOOT} && report_models && sleep 1 && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.modelsCalls(), 2);
  assert.match(r.stderr, /경고: gw-models: 모델 목록 보고 실패\(HTTP 503\)/);
  assert.doesNotMatch(r.stderr, /알렸습니다/);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'state', 'models-reported')), false);
});

test('reportModels_doesNotSendEmptyOrMalformedList', (t) => {
  // 보이는 모델이 없거나 형식이 다르면 보내지 않는다 — 빈 목록으로 Works 의 선택지를 지우지 않게.
  const f = fixture(t);
  writeFileSync(f.d('out', 'models.raw.json'), JSON.stringify({ models: [{ slug: 'x', display_name: 'X', visibility: 'hide', priority: 1, supported_reasoning_levels: [] }] }));
  const empty = callLib(f.env, `${BOOT} && report_models`);
  assert.equal(empty.status, 0, empty.stderr);
  writeFileSync(f.d('out', 'models.raw.json'), 'not json');
  const bad = callLib(f.env, `${BOOT} && report_models`);
  assert.equal(bad.status, 0, bad.stderr);
  assert.equal(f.reports().length, 0);
  assert.match(empty.stderr + bad.stderr, /형식이 다르거나 비었습니다/);
});

test('reportModels_warnsAboutMissingGwModelsEvenWhenListingFails', (t) => {
  // 옛 플러그인 알림은 목록 받기 앞에서 한 번 — 받기가 계속 실패해도 보인다.
  const f = fixture(t, { gwModels: false });
  writeFileSync(f.d('out', 'models-fail'), '');
  const r = callLib({ ...f.env, CODEX_MODELS_RETRY: '0' }, `${BOOT} && report_models && sleep 1 && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.modelsCalls(), 2);
  assert.equal((r.stderr.match(/gw-models 가 없습니다/g) ?? []).length, 1);
  assert.equal((r.stderr.match(/Codex 모델 목록을 읽지 못했습니다/g) ?? []).length, 2);
});

test('reportModels_warnsWhenTempFileCannotBeMade', (t) => {
  // 임시 파일을 못 만들면(디스크) 다른 실패처럼 경고 한 줄과 다시 해 보기 — codex 는 부르지 않는다.
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && GENIA_WORK=${f.d('no-such-dir')} && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.modelsCalls(), 0);
  assert.match(r.stderr, /모델 목록을 받을 임시 파일을 .* 만들지 못했습니다 — 600 초 뒤 다시 합니다/);
});

test('reportModels_warnsOnceAndStillFitsEffortWhenPluginHasNoGwModels', (t) => {
  // 옛 플러그인(gw-models 없음) — 한 번만 알린다. 목록은 추론 강도 맞추기에 쓰려고 그대로 묻는다(보고만 못 한다).
  const f = fixture(t, { gwModels: false });
  const r = callLib({ ...f.env, CODEX_MODELS_INTERVAL: '0' }, `${BOOT} && report_models && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stderr.match(/gw-models 가 없습니다/g) ?? []).length, 1);
  assert.equal(f.modelsCalls(), 2);
  assert.doesNotMatch(r.stderr, /알렸습니다/);
});

// ---------------------------------------------------------------- 추론 강도 맞추기(codex_fit_effort)

const effortOf = (f) => f.read('work', 'agents', 'kodi', 'codex', 'config.toml').match(/^model_reasoning_effort = "(.*)"$/m)?.[1];
const withConfig = (f, config) => writeFileSync(f.d('run', 'config.json'), JSON.stringify({ ...CONFIG, config: { ...CONFIG.config, ...config } }));

test('fitEffort_fallsBackToModelDefaultWhenEffortUnsupported', (t) => {
  // gpt-6-sol 은 xhigh 를 받지 않는다(가짜 목록: low·high·ultra, 기본 high) — 받은 목록으로 그 모델의 기본값으로 다시 쓰고 경고 한 줄.
  const f = fixture(t);
  writeFileSync(f.d('out', 'models.raw.json'), JSON.stringify({ models: [...MODELS_RAW.models.filter((m) => m.slug !== 'gpt-6-sol'), { ...MODELS_RAW.models[0], default_reasoning_level: 'high' }] }));
  withConfig(f, { model: 'gpt-6-sol', effort: 'xhigh' });
  const r = callLib(f.env, `${BOOT} && write_codex_config && report_models`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(effortOf(f), 'high');
  assert.match(f.read('work', 'agents', 'kodi', 'codex', 'config.toml'), /^model = "gpt-6-sol"$/m);
  assert.equal((r.stderr.match(/모델 gpt-6-sol 은 추론 강도 xhigh 를 받지 않아 그 모델의 기본값 high 으로 띄웁니다/g) ?? []).length, 1);
  assert.equal(f.modelsCalls(), 1); // 보고와 같은 한 번의 목록으로 한다
  assert.equal(f.reports().length, 1);
});

test('fitEffort_keepsConfiguredEffortWhenSupportedUnknownModelOrListingFails', (t) => {
  const f = fixture(t);
  // 받는 강도 — 그대로
  const ok = callLib(f.env, `${BOOT} && write_codex_config && report_models`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(effortOf(f), 'high');
  assert.doesNotMatch(ok.stderr, /추론 강도/);
  // 목록에 없는 모델 — 판단할 근거가 없어 설정값 그대로
  withConfig(f, { model: 'gpt-9-unknown', effort: 'xhigh' });
  const unknown = callLib(f.env, `${BOOT} && write_codex_config && report_models`);
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.equal(effortOf(f), 'xhigh');
  // 목록을 못 받음 — 설정값 그대로
  withConfig(f, { model: 'gpt-6-sol', effort: 'xhigh' });
  writeFileSync(f.d('out', 'models-fail'), '');
  const failed = callLib(f.env, `${BOOT} && write_codex_config && report_models`);
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(effortOf(f), 'xhigh');
});

test('fitEffort_restoresConfiguredEffortOnceModelSupportsItAgain', (t) => {
  // 같은 셸에서 목록이 바뀌어(6시간 뒤 다시 물음) 설정한 강도를 받게 되면 설정값으로 되돌린다.
  const f = fixture(t);
  withConfig(f, { model: 'gpt-6-sol', effort: 'xhigh' });
  const bad = JSON.stringify({ models: [{ ...MODELS_RAW.models[0], default_reasoning_level: 'high' }] });
  const good = JSON.stringify({ models: [{ ...MODELS_RAW.models[0], supported_reasoning_levels: [{ effort: 'xhigh' }] }] });
  const raw = f.d('out', 'models.raw.json');
  const r = callLib(
    { ...f.env, CODEX_MODELS_INTERVAL: '0' },
    `${BOOT} && write_codex_config && printf '%s' '${bad}' > '${raw}' && report_models && grep effort "$CODEX_HOME/config.toml" && printf '%s' '${good}' > '${raw}' && report_models`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /model_reasoning_effort = "high"/);
  assert.equal(effortOf(f), 'xhigh');
  assert.match(r.stderr, /추론 강도 xhigh 를 받게 되어 설정값으로 되돌렸습니다/);
});

// ---------------------------------------------------------------- 칸이 도는 동안 미루기(로그인 갱신 겹침)

test('reportModels_defersWhilePaneCodexExecRunsThenRunsWhenIdle', async (t) => {
  // 칸의 codex exec 가 도는 동안에는 codex debug models 를 부르지 않는다 — ChatGPT 갱신 토큰은 1회용이라 두 프로세스가 함께 새로 고치면 로그인이 풀릴 수 있다.
  const f = fixture(t);
  mkdirSync(f.d('pane-X'), { recursive: true });
  const pane = spawn(join(f.d('bin'), 'codex'), ['exec', '--json', '-o', f.d('out', 'last.txt'), '--skip-git-repo-check', 'prompt'], { cwd: f.d('pane-X'), env: f.env, stdio: 'ignore' });
  t.after(() => pane.kill('SIGKILL'));
  await until(() => existsSync(f.d('out', 'exec-pane-X.env')), '칸 codex exec');
  const busy = callLib(f.env, `${BOOT} && report_models`);
  assert.equal(busy.status, 0, busy.stderr);
  assert.equal(f.modelsCalls(), 0);
  assert.match(busy.stderr, /칸의 codex 가 도는 중이라 모델 목록 묻기를 600 초 미룹니다/);
  pane.kill('SIGTERM');
  await new Promise((r) => pane.once('exit', r));
  const idle = callLib(f.env, `${BOOT} && report_models`);
  assert.equal(idle.status, 0, idle.stderr);
  assert.equal(f.modelsCalls(), 1);
  assert.equal(f.reports().length, 1);
});

// ---------------------------------------------------------------- 이미지·카탈로그

test('dockerfileKeepsSharedToolBlockIdenticalToGeniaImage', () => {
  // 도구 블록(apt·glab·Claude Code·사용자)은 Gen:iA Code 이미지와 글자까지 같아야 한다 — 한쪽만 바뀌면 두 실행기의 작업 공간이 갈린다.
  const block = (p) => readFileSync(p, 'utf8').match(/^# ---- Claude 이미지 Dockerfile 과 같은 도구 블록[\s\S]*?^# ---- 같은 도구 블록 끝 ----$/m)?.[0];
  const mine = block(join(appDir, 'Dockerfile'));
  assert.ok(mine);
  assert.equal(mine, block(join(appDir, '..', 'workplace-agent-genia-code', 'Dockerfile')));
  const version = (d) => d.match(/^ARG CLAUDE_CODE_VERSION=(\S+)$/m)?.[1];
  assert.equal(version(readFileSync(join(appDir, 'Dockerfile'), 'utf8')), version(readFileSync(join(appDir, '..', 'workplace-agent-claude-code', 'Dockerfile'), 'utf8')));
});

test('dockerfilePinsCodexAndBakesDriverPluginAndSkills', () => {
  const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
  // Codex 는 고정 버전 — latest 로 두면 구동기 인자·설정 키가 말없이 바뀔 수 있다
  assert.match(dockerfile, /^ARG CODEX_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /npm install -g --no-fund --no-audit "@openai\/codex@\$\{CODEX_VERSION\}"/);
  // 구동기와 그것이 import 하는 것(genia/loop.js → hooks/lib.js), 버전 파일, 스크립트·스킬
  for (const p of ['codex', 'genia', 'hooks', 'scripts', 'skills', '.claude-plugin']) {
    assert.match(dockerfile, new RegExp(`^COPY plugins/genia-works/${p.replace('.', '\\.')}/ /opt/genia/plugin/genia-works/${p.replace('.', '\\.')}/$`, 'm'), p);
  }
  assert.doesNotMatch(dockerfile, /plugins\/genia-works\/tests|^RUN .*chmod/m);
  assert.match(dockerfile, /^COPY --chmod=755 apps\/workplace-agent-claude-code\/bin\/lib\.sh \/opt\/genia\/bin\/lib\.sh$/m);
  assert.match(dockerfile, /^COPY --chmod=755 apps\/workplace-agent-claude-code\/bin\/agent-screen apps\/workplace-agent-codex\/bin\/ \/opt\/genia\/bin\/$/m);
  // Codex 설치는 플러그인 받기 뒤(버전만 올려도 그 단계를 다시 하지 않게). 버전은 빌드 ARG 로만 — ENV 로 두면 모든 칸·빌드에 새어 나간다
  assert.ok(dockerfile.indexOf('install_plugins /opt/genia/plugins.lock') < dockerfile.indexOf('"@openai/codex@${CODEX_VERSION}"'));
  assert.doesNotMatch(dockerfile, /^ENV CODEX_VERSION/m);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--", "\/opt\/genia\/bin\/entrypoint"\]/);
  // 개발 절차 플러그인(WP-1336): Claude 이미지와 같은 lock 으로 받아 스킬 폴더를 Codex 가 읽는 ~/.agents/skills 로 잇는다
  assert.match(dockerfile, /install_plugins \/opt\/genia\/plugins\.lock "" genia-works@genia-works/);
  assert.match(dockerfile, /ln -sfn "\$path\/skills" "\/home\/agent\/\.agents\/skills\/\$\{id%@\*\}"/);
  assert.match(dockerfile, /test -f \/home\/agent\/\.agents\/skills\/superpowers\/using-superpowers\/SKILL\.md/);
  assert.match(dockerfile, /COPY --chown=1001:1001 apps\/workplace-agent-genia-code\/skills\/ \/home\/agent\/\.agents\/skills\//);
  // 사내 Gen:iA 것은 넣지 않는다
  assert.doesNotMatch(dockerfile, /genia-root\.crt|genia-code-server|GENIA_SKIP_VERSION_CHECK/);
});

test('catalogRebuildsImageWhenItsInputsChange', () => {
  // 이 이미지가 COPY 하는 저장소 파일이 바뀌면 다시 빌드한다(릴리스 카탈로그의 paths).
  const catalog = JSON.parse(readFileSync(join(repoRoot, 'deploy', 'release', 'image-catalog.json'), 'utf8'));
  const entry = catalog.images.find((i) => i.id === 'agent-codex');
  assert.ok(entry);
  assert.equal(entry.repository, 'docker.io/iacloudops/genia-works-agent-codex');
  assert.equal(entry.dockerfile, 'apps/workplace-agent-codex/Dockerfile');
  assert.equal(entry.helm, false);
  for (const p of [
    'apps/workplace-agent-codex/',
    'apps/workplace-agent-claude-code/bin/lib.sh',
    'apps/workplace-agent-claude-code/bin/agent-screen',
    'apps/workplace-agent-claude-code/plugins.lock',
    'apps/workplace-agent-genia-code/skills/',
    'plugins/genia-works/',
  ]) {
    assert.ok(entry.paths.includes(p), p);
  }
});

// ---------------------------------------------------------------- 엔트리포인트 전체(진짜 tmux·플러그인 스크립트·codex 구동기)

tmuxTest('entrypoint_launchesCodexLoopPaneReportsModelsAndStopsOnSigterm', async (t) => {
  const f = fixture(t);
  const skill = f.d('home', '.agents', 'skills', 'superpowers', 'using-superpowers', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: using-superpowers\n---\n');
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, { ...f.env, GENIA_LOGIN_VERSION: '11', CODEX_MODELS_INTERVAL: '1', CODEX_MODELS_RETRY: '1' });
  await until(() => existsSync(f.d('out', 'exec-WP.env')), 'WP 칸의 codex exec', 30000, e.log);
  const lines = f.read('out', 'exec-WP.env').split('\n');
  const aiDir = f.d('work', 'agents', 'kodi');
  for (const want of [
    `CODEX_HOME=${aiDir}/codex`,
    'GENIA_WORKS_AS=kodi',
    `GENIA_WORKS_AGENT_DIR=${aiDir}`,
    'GENIA_WORKS_RUNNER_WAKES=1',
    'GENIA_WORKS_MCP_URL=http://127.0.0.1:9/mcp',
    'GENIA_WORKS_TENANT=3',
    'GENIA_AGENT_GENERATION=7',
    'mcp-token-present',
    'arg exec',
    'arg --json',
    'arg --dangerously-bypass-approvals-and-sandbox',
    'arg mcp_servers.genia-works.url="http://127.0.0.1:9/mcp"',
  ]) {
    assert.ok(lines.includes(want), `${want} 가 없습니다:\n${lines.join('\n')}`);
  }
  // 프롬프트는 굳힌 플러그인의 work-loop 스킬을 가리키고 대기열 라벨을 넘긴다
  assert.ok(lines.some((l) => l.startsWith('arg genia-works work-loop 스킬을 한 번 실행한다')), lines.join('\n'));
  assert.ok(lines.some((l) => /^이 스킬 폴더는 \S+\/skills\/work-loop 이다\. 인자: WP --queue "AI 개발팀"$/.test(l)), lines.join('\n'));
  // 실행기는 codex 로 적혔고, 로그인은 보관본 자리에, 설정은 매번 새로. Claude 의 ~/.claude.json 은 만들지 않는다.
  assert.match(readFileSync(join(aiDir, 'agent.conf'), 'utf8'), /cli=codex/);
  assert.match(e.log(), /^\[entrypoint\] Codex codex-cli 0\.167\.0-fake$/m); // 부팅 때 codex --version 으로 실제로 도는지 본다
  assert.equal(readFileSync(join(aiDir, 'codex', 'auth.json'), 'utf8'), `${LOGIN}\n`);
  assert.match(readFileSync(join(aiDir, 'codex', 'config.toml'), 'utf8'), /^model = "gpt-6-luna"$/m);
  // 이미지에 굳힌 superpowers 가 있으면 세션 시작 안내를 전역 지시로 싣는다(fixture 홈에 스킬을 둔다 — 아래 startEntrypoint 전)
  assert.match(readFileSync(join(aiDir, 'codex', 'AGENTS.md'), 'utf8'), /using-superpowers 스킬 파일 \S+\/using-superpowers\/SKILL\.md 을 읽고/);
  assert.equal(existsSync(f.d('home', '.claude.json')), false);
  // 모델 목록은 부팅 회차에 칸을 띄우기 전에 한 번 묻는다. 그 뒤 간격(여기서는 1초)이 지나도 칸의 codex exec 가 도는 동안에는 미룬다.
  await until(() => ticks(f) >= 4, '감독 회차 네 번', 15000, e.log);
  assert.equal(f.modelsCalls(), 1, e.log());
  assert.equal(f.read('out', 'models-panes').trim(), '0'); // 처음 물을 때 칸은 아직 없었다
  assert.match(e.log(), /칸의 codex 가 도는 중이라 모델 목록 묻기를 1 초 미룹니다/);
  assert.deepEqual(parseReport(f.reports()[0]).body, MODELS_REPORTED);
  // 띄운 칸을 다시 띄우거나 실패로 적지 않는다
  assert.equal((e.log().match(/WP: started/g) ?? []).length, 1, e.log());
  assert.doesNotMatch(e.log(), /WP: (revived|restarted)|WP 칸을 띄우지 못했습니다/);
  assert.doesNotMatch(e.log(), /fake-access-value|fake-refresh-value|ghp_secrettoken|ak_testkey123/);
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

tmuxTest('entrypoint_launchesPaneEvenWhenModelListingHangs', async (t) => {
  // codex debug models 가 멈춰도(밖으로 못 나감 등) 감독은 제한 시간 뒤 넘어가 칸을 띄운다.
  const f = fixture(t);
  writeFileSync(f.d('run', 'login-info'), LOGIN);
  writeFileSync(f.d('out', 'models-hang'), '');
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, { ...f.env, GENIA_LOGIN_VERSION: '11', CODEX_MODELS_TIMEOUT: '1' });
  await until(() => existsSync(f.d('out', 'exec-WP.env')), '모델 목록이 멈춘 뒤 WP 칸', 30000, e.log);
  assert.match(e.log(), /Codex 모델 목록을 읽지 못했습니다\(codex 종료 코드 1\d\d — 128 이상은 1 초 제한으로 끊은 것\)/);
  assert.equal(f.reports().length, 0);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('entrypoint_doesNotLaunchPaneOrReportModelsWithoutLoginInfo', async (t) => {
  // 로그인 정보가 없으면 칸·알림 감시 창을 띄우지 않고 모델 목록도 묻지 않는다 — 경고만, 엔트리포인트는 끝내지 않는다.
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  // codex 가 버전에 답하지 않으면(바이너리 깨짐) 부팅 로그에 경고가 남는다 — 끝내지는 않는다.
  const e = startEntrypoint(t, { ...f.env, FAKE_CODEX_BROKEN: '1' });
  await until(() => /ChatGPT 로그인 정보가 연결되지 않았습니다/.test(e.log()), '로그인 없음 경고', 15000, e.log);
  assert.match(e.log(), /경고: codex --version 이 답하지 않습니다/);
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  assert.equal(e.child.exitCode, null, e.log());
  assert.equal(existsSync(f.d('out', 'exec-WP.env')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'repos', 'WP')), false);
  assert.equal(f.modelsCalls(), 0);
  assert.notEqual(f.tmux('list-sessions').status, 0);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});
