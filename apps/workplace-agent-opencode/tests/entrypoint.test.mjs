// OpenCode 작업 공간 엔트리포인트 테스트(WP-1410) — Claude Code 이미지의 lib.sh + 이 이미지의 lib-opencode.sh 함수를 하나씩, 그리고 bin/entrypoint 전체를 돌려 본다.
// opencode 는 PATH 앞의 가짜(--version 에 답하고, run 이면 받은 인자·env 를 남기고 기다린다)로, gh·npx·curl(맡는 프로젝트 조회만)도 가짜로 바꾼다.
// tmux 는 진짜를 테스트마다 격리한 서버(-L)로 쓰고, 플러그인은 저장소의 진짜 것(scripts·opencode 구동기·genia/loop.js·hooks·skills)을 링크한다 —
// 칸 명령(agent-project 의 opencode 분기 → gw-opencode-loop → opencode/driver.mjs)과 칸이 물려받는 env 를 진짜로 확인하려는 것이다.
// 연결 정보·키는 모두 가짜 값이다. 진짜 opencode 가 PATH 에 있으면 만든 opencode.json 을 `opencode debug config` 로 읽혀 본다(없으면 건너뜀).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h from '../../workplace-agent-claude-code/tests/harness.mjs';
import { bareRepo, exe, tmuxTest, until } from '../../workplace-agent-claude-code/tests/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repoRoot = join(appDir, '..', '..');
const lib = join(repoRoot, 'apps', 'workplace-agent-claude-code', 'bin', 'lib.sh');
const libOpencode = join(appDir, 'bin', 'lib-opencode.sh');
const entrypoint = join(appDir, 'bin', 'entrypoint');
const MODEL_LIMIT = join(appDir, 'bin', 'model-limit.mjs');
const pluginRoot = join(repoRoot, 'plugins', 'genia-works');
const pluginScripts = join(pluginRoot, 'scripts');

const CONFIG = {
  agent: { userId: 42, username: 'kodi', tenantId: 3, generation: 7 },
  works: { apiUrl: 'http://127.0.0.1:9/api/v1', mcpUrl: 'http://127.0.0.1:9/mcp' },
  template: { name: 'opencode', version: '1' },
  config: { model: 'auto', queue: 'AI 개발팀' },
  plugins: [],
};

/** 가짜 연결 정보(서버가 login-info 로 내는 모양) — 원문(API 키)이 로그에 나오지 않는지도 이 값으로 본다. */
const LOGIN_OBJ = {
  providerId: 'custom',
  name: '사내 모델 서버',
  options: { baseURL: 'https://models.example.test/v1', apiKey: 'sk-fake-secret-value' },
  vision: { 'custom/qwen3-vl': true },
  defaultModel: 'custom/qwen3-27b',
};
const LOGIN = JSON.stringify(LOGIN_OBJ);

/**
 * 테스트 하나의 격리 환경 — 홈·/run/genia·/work·가짜 명령·굳힌 플러그인 폴더·격리 tmux.
 * 굳힌 플러그인 폴더는 이미지가 COPY 하는 폴더들을 저장소의 진짜 것으로 링크하고, scripts 는 파일마다 링크한다.
 */
function fixture(t, { env: extra = {}, config = CONFIG } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-opencode-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['home', 'run', 'work', 'bin', 'out', 'tmp', 'plugin/scripts']) mkdirSync(d(p), { recursive: true });
  writeFileSync(d('run', 'config.json'), JSON.stringify(config));
  writeFileSync(d('run', 'agent-key'), 'ak_testkey123\n');
  mkdirSync(d('run', 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(d('run', 'repo-tokens', 'github', 'github.com'), 'ghp_secrettoken\n');
  writeFileSync(d('tmp', 'system.pem'), 'SYSTEM-ROOTS\n');
  writeFileSync(d('tmp', 'genia-root.crt'), 'GENIA-ROOT\n');

  exe(d('bin', 'gh'), `#!/bin/sh
printf 'args %s\\n' "$*" >> "$FAKE_OUT/gh.log"
[ "$1 $2" = "auth login" ] && cat >/dev/null
exit 0
`);
  exe(d('bin', 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_OUT/npx.log"
exit 0
`);
  // 가짜 opencode — --version, run(구동기가 부른다 — 칸 폴더 이름별로 받은 env·인자를 남기고 기다린다. MCP 토큰은 값 대신 있음만 적는다).
  exe(d('bin', 'opencode'), `#!/bin/sh
case "$1" in
  --version) [ -n "\${FAKE_OPENCODE_BROKEN:-}" ] && exit 1; echo "1.18.31-fake"; exit 0 ;;
  run)
    k=$(basename "$PWD")
    { printf 'XDG_DATA_HOME=%s\\n' "$XDG_DATA_HOME"
      env | grep -E '^(GENIA_WORKS_(AS|AGENT_DIR|RUNNER_WAKES|MCP_URL|TENANT)|GENIA_AGENT_GENERATION|OPENCODE_DISABLE_[A-Z_]+|NODE_EXTRA_CA_CERTS)=' | sort
      [ -n "$GENIA_WORKS_MCP_TOKEN" ] && echo 'mcp-token-present'
      [ -n "$OPENCODE_CONFIG_CONTENT" ] && echo 'config-content-present'
      for a in "$@"; do printf 'arg %s\\n' "$a"; done; } > "$FAKE_OUT/run-$k.tmp"
    mv "$FAKE_OUT/run-$k.tmp" "$FAKE_OUT/run-$k.env"
    # 끝내지 않고 기다린다 — 칸이 도는 것으로 보이게(실제 opencode 는 한 회차가 끝나야 끝난다).
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

  // 이미지가 COPY 하는 플러그인 폴더(Dockerfile)를 진짜 것으로 링크한다 — gw-opencode-loop 가 ../opencode/driver.mjs 를, 구동기가 ../genia/loop.js·
  // ../hooks/lib.js·../skills 를 찾는다.
  for (const p of ['opencode', 'genia', 'hooks', 'skills', '.claude-plugin', 'package.json']) symlinkSync(join(pluginRoot, p), d('plugin', p));
  for (const f of readdirSync(pluginScripts)) symlinkSync(join(pluginScripts, f), d('plugin', 'scripts', f));
  writeFileSync(d('out', 'projects.json'), '[]');
  writeFileSync(d('bin', 'model-limit-noop.mjs'), '');

  const { wrapper, tmux } = h.isolatedTmux(d('bin'), 'gwopencode');
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
    GENIA_ROOT_CRT: d('tmp', 'genia-root.crt'),
    OPENCODE_PLUGIN_DIR: d('plugin'),
    DOCKER_HOST: `unix://${d('no-docker.sock')}`,
    PLAYWRIGHT_BROWSERS_PATH: d('work', '.cache', 'ms-playwright'),
    GENIA_BASE_BROWSERS: d('no-base-browsers'),
    GENIA_PLAYWRIGHT_CLI_CORE: d('no-playwright-cli'),
    GENIA_XVFB: d('no-xvfb'), // 시험 기계에 Xvfb 가 있어도 진짜 화면을 띄우지 않는다
    GENIA_DIND_WAIT: '0',
    GENIA_SUPERVISE_INTERVAL: '1',
    // 문맥 한도 조회(WP-1735)는 기본으로 아무것도 하지 않는 가짜로 — 가짜 연결 주소로 밖에 묻지 않게. 한도 테스트만 진짜(MODEL_LIMIT)를 쓴다.
    OPENCODE_MODEL_LIMIT: d('bin', 'model-limit-noop.mjs'),
    GENIA_MODELS_TIMEOUT_MS: '1000',
    GW_TMUX: wrapper,
    FAKE_OUT: d('out'),
    ...extra,
  };
  const configFile = d('home', '.config', 'opencode', 'opencode.json');
  return {
    root,
    d,
    env,
    tmux,
    configFile,
    config: () => JSON.parse(readFileSync(configFile, 'utf8')),
    read: (...p) => readFileSync(d(...p), 'utf8'),
    withLogin: (obj = LOGIN_OBJ) => writeFileSync(d('run', 'login-info'), typeof obj === 'string' ? obj : JSON.stringify(obj)),
    withModel: (model) => writeFileSync(d('run', 'config.json'), JSON.stringify({ ...CONFIG, config: { ...CONFIG.config, model } })),
  };
}

/** lib.sh + lib-opencode.sh 를 읽고 함수(셸 한 줄)를 부른다. */
const callLib = (env, script) => h.callLib([lib, libOpencode], env, script);
/** 엔트리포인트를 뒤에서 띄운다 — 끝나기를 기다리는 exited 와 지금까지의 로그. */
const startEntrypoint = (t, env) => h.startEntrypoint(t, entrypoint, env);
/** 지금까지 돈 감독 회차 수 — 시간 대신 회차를 기다린다. */
const ticks = (f) => h.ticks(f.d('work', 'agents', 'kodi'));
const BOOT = 'check_required && prepare_dirs && use_plugin && opencode_env';

// ---------------------------------------------------------------- 플러그인(use_plugin)

test('usePlugin_adoptsBakedPluginScripts', (t) => {
  const f = fixture(t);
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin && echo "GW=$GW_SCRIPTS"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^GW=${f.d('plugin', 'scripts')}$`, 'm'));
});

test('usePlugin_failsWhenOpencodeDriverMissing', (t) => {
  // 구동기(opencode/driver.mjs)가 없는 플러그인으로는 칸을 띄울 수 없다 — 엔트리포인트가 이것으로 끝낸다.
  const f = fixture(t);
  rmSync(f.d('plugin', 'opencode'));
  const r = callLib(f.env, 'check_required && prepare_dirs && use_plugin');
  assert.notEqual(r.status, 0);
});

// ---------------------------------------------------------------- 환경(opencode_env)

test('opencodeEnv_keepsConversationsOnPersistentDiskAndTurnsOffUpdatesAndModelFetch', (t) => {
  // 대화 기록(이어 받기)은 /work 아래 AI 폴더(영속)로 — 홈은 Pod 를 다시 만들면 사라진다. 자동 갱신·모델 정보 내려받기는 끈다.
  const f = fixture(t);
  const r = callLib(f.env, `${BOOT} && echo "DATA=$XDG_DATA_HOME" && echo "UPD=$OPENCODE_DISABLE_AUTOUPDATE" && echo "FETCH=$OPENCODE_DISABLE_MODELS_FETCH"`);
  assert.equal(r.status, 0, r.stderr);
  const data = f.d('work', 'agents', 'kodi', 'opencode', 'data');
  assert.match(r.stdout, new RegExp(`^DATA=${data}$`, 'm'));
  assert.match(r.stdout, /^UPD=1$/m);
  assert.match(r.stdout, /^FETCH=1$/m);
  assert.equal(statSync(data).isDirectory(), true);
  assert.equal(statSync(f.d('work', 'agents', 'kodi', 'opencode')).mode & 0o777, 0o700);
  assert.equal(statSync(dirname(f.configFile)).mode & 0o777, 0o700);
});

test('setupCa_passesExtraCaToOpencodeBunRuntimeViaNodeExtraCaCertsAndMergedBundle', (t) => {
  // 사내 모델 서버가 사설 CA 면 OpenCode 가 믿어야 한다 — 11-08 opencode 1.18.31 로 NODE_EXTRA_CA_CERTS(추가분)·SSL_CERT_FILE(합친 번들) 둘 다 먹음을 확인했다.
  // 공용 setup_ca 가 둘 다 내보내는지(이 이미지는 따로 하지 않는다) 본다.
  const f = fixture(t);
  mkdirSync(f.d('run', 'ca'), { recursive: true });
  writeFileSync(f.d('run', 'ca', 'ca.crt'), 'PRIVATE-CA\n');
  const r = callLib(f.env, 'check_required && prepare_dirs && setup_ca && echo "EXTRA=$NODE_EXTRA_CA_CERTS" && echo "BUNDLE=$SSL_CERT_FILE"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^EXTRA=${f.d('run', 'ca', 'ca.crt')}$`, 'm'));
  const bundle = r.stdout.match(/^BUNDLE=(.*)$/m)[1];
  assert.equal(readFileSync(bundle, 'utf8'), 'SYSTEM-ROOTS\nPRIVATE-CA\n');
});

test('opencodeCa_passesModelServerRootWithOrWithoutLocationCa', (t) => {
  // 사내 모델 서버(사설 루트 genia-root)에 OpenCode(Bun)가 붙으려면 NODE_EXTRA_CA_CERTS 에 그 루트가 있어야 한다(11-09 AI 테스터1 회차 실패).
  // 위치 추가 CA 가 있으면 뒤에 잇고, 없어도(setup_ca 가 아무것도 내보내지 않음) 루트는 넘어간다.
  for (const [locationCa, want] of [['PRIVATE-CA\n', 'GENIA-ROOT\nPRIVATE-CA\n'], [null, 'GENIA-ROOT\n']]) {
    const f = fixture(t);
    if (locationCa) {
      mkdirSync(f.d('run', 'ca'), { recursive: true });
      writeFileSync(f.d('run', 'ca', 'ca.crt'), locationCa);
    }
    const r = callLib(f.env, 'check_required && prepare_dirs && setup_ca && opencode_ca && echo "EXTRA=$NODE_EXTRA_CA_CERTS"');
    assert.equal(r.status, 0, r.stderr);
    const extra = r.stdout.match(/^EXTRA=(.*)$/m)[1];
    assert.equal(extra, f.d('home', '.genia-node-ca.pem'));
    assert.equal(readFileSync(extra, 'utf8'), want);
  }
});

test('opencodeCa_whenBundleCannotBeWritten_fallsBackToRootAlone', (t) => {
  // 홈에 묶음을 못 쓰면(가득 참 등) 루트만이라도 넘긴다 — 위치 추가 CA 는 setup_ca 의 합친 번들(SSL_CERT_FILE)에 남는다.
  const f = fixture(t);
  mkdirSync(f.d('home', '.genia-node-ca.pem.tmp'), { recursive: true }); // 임시 파일 자리를 폴더로 막아 쓰기를 실패시킨다
  const r = callLib(f.env, 'check_required && prepare_dirs && opencode_ca && echo "EXTRA=$NODE_EXTRA_CA_CERTS"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^EXTRA=${f.d('tmp', 'genia-root.crt')}$`, 'm'));
  assert.match(r.stdout + r.stderr, /루트 CA 만 넘깁니다/);
});

test('opencodeCa_whenRootFileMissing_warnsAndKeepsLocationCa', (t) => {
  // 루트 파일이 없으면(이미지 밖) 경고만 하고 setup_ca 가 정한 추가분을 그대로 둔다 — 부팅은 이어진다.
  const f = fixture(t, { env: { GENIA_ROOT_CRT: '/nonexistent/genia-root.crt' } });
  mkdirSync(f.d('run', 'ca'), { recursive: true });
  writeFileSync(f.d('run', 'ca', 'ca.crt'), 'PRIVATE-CA\n');
  const r = callLib(f.env, 'check_required && prepare_dirs && setup_ca && opencode_ca && echo "EXTRA=$NODE_EXTRA_CA_CERTS"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^EXTRA=${f.d('run', 'ca', 'ca.crt')}$`, 'm'));
  assert.match(r.stdout + r.stderr, /루트 CA/);
});

// ---------------------------------------------------------------- 설정(write_opencode_config)

test('writeOpencodeConfig_usesConnectionDefaultModelWhenTemplateModelIsAuto', (t) => {
  const f = fixture(t);
  f.withLogin();
  const r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(f.configFile).mode & 0o777, 0o600);
  const cfg = f.config();
  assert.deepEqual(cfg, {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    permission: 'allow',
    provider: {
      custom: {
        npm: '@ai-sdk/openai-compatible',
        name: '사내 모델 서버',
        options: LOGIN_OBJ.options,
        models: { 'qwen3-27b': {} },
      },
    },
    model: 'custom/qwen3-27b',
  });
  // OpenCode 가 모르는 키(vision·defaultModel)와 MCP·플러그인(구동기가 넘긴다)은 설정 파일에 두지 않는다
  assert.doesNotMatch(readFileSync(f.configFile, 'utf8'), /vision|defaultModel|"mcp"|"plugin"/);
  // 원문(API 키)은 로그에 남지 않는다 — 연결 이름·모델만
  assert.doesNotMatch(r.stdout + r.stderr, /sk-fake-secret-value|models\.example\.test/);
  assert.match(r.stderr, /OpenCode 설정을 썼습니다\(연결 custom, 모델 custom\/qwen3-27b\)/);
});

test('writeOpencodeConfig_usesTemplateModelWhenItBelongsToThisConnection', (t) => {
  // 칸에서 고른 모델(providerId/modelId — 실시간 모델 목록의 값)이 이 연결의 것이면 그것이 연결에 지정한 모델보다 앞선다.
  const f = fixture(t);
  f.withLogin();
  f.withModel('custom/Qwen/Qwen3-Coder-30B');
  const r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  const cfg = f.config();
  assert.equal(cfg.model, 'custom/Qwen/Qwen3-Coder-30B'); // 모델 id 에 '/' 가 있어도 providerId 접두만 떼어 낸다
  assert.deepEqual(Object.keys(cfg.provider.custom.models), ['Qwen/Qwen3-Coder-30B']);
  assert.doesNotMatch(r.stderr, /경고/);
});

test('writeOpencodeConfig_fallsBackToConnectionModelWithWarningWhenTemplateModelHasOtherPrefix', (t) => {
  // 연결을 다른 것으로 바꿨는데 템플릿에 옛 연결의 모델이 남은 경우 — 남의 접두를 쓰지 않고 연결에 지정한 모델로 띄운다(경고).
  const f = fixture(t);
  f.withLogin();
  f.withModel('other/gpt-x');
  const r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.config().model, 'custom/qwen3-27b');
  assert.match(r.stderr, /경고: 설정한 모델 other\/gpt-x 은 이 연결\(custom\)의 모델이 아니라 쓰지 않습니다/);
});

test('writeOpencodeConfig_rejectsUnprefixedConnectionModelAndFailsClearlyWhenNoModelAtAll', (t) => {
  const f = fixture(t);
  // 연결에 지정한 모델이 이 연결의 「providerId/」 접두가 아니면(옛 Claude 기본값·다른 연결의 값) 추측해 붙이지 않고 「못 정함」으로 실패한다
  // — 서버도 그런 값은 defaultModel null 로 보낸다(WP-1410). 옛 설정은 지운다.
  f.withLogin({ ...LOGIN_OBJ, defaultModel: 'custom/qwen3-27b' });
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  for (const defaultModel of ['bare-model', 'claude-sonnet-4-5', 'other/qwen3', 'custom/']) {
    f.withLogin({ ...LOGIN_OBJ, defaultModel });
    const bare = callLib(f.env, `${BOOT} && write_opencode_config`);
    assert.notEqual(bare.status, 0, defaultModel);
    assert.match(bare.stderr, /오류: 모델을 정할 수 없습니다 — 연결에 지정한 모델 .+ 이 이 연결\(custom\)의 모델이 아닙니다/, defaultModel);
    assert.equal(existsSync(f.configFile), false, defaultModel);
    assert.doesNotMatch(bare.stdout + bare.stderr, /sk-fake-secret-value/);
  }
  // auto 인데 연결에도 모델이 없다 — 분명한 오류로 실패하고 옛 설정은 지운다(칸을 띄우지 않는다)
  for (const defaultModel of [undefined, null, '']) {
    const { defaultModel: _drop, ...rest } = LOGIN_OBJ;
    f.withLogin(defaultModel === undefined ? rest : { ...rest, defaultModel });
    const r = callLib(f.env, `${BOOT} && write_opencode_config`);
    assert.notEqual(r.status, 0, JSON.stringify(defaultModel));
    assert.match(r.stderr, /오류: 모델을 정할 수 없습니다 — 설정의 모델이 auto 인데 OpenAI 호환 연결에도 지정한 모델이 없습니다/);
    assert.equal(existsSync(f.configFile), false);
  }
});

test('writeOpencodeConfig_failsAndRemovesStaleConfigWithoutLoginInfo', (t) => {
  // 연결을 끊으면 runner 가 마운트를 뺀다 — 옛 설정(API 키가 든)을 지워 실제로 끊기게 하고 경고를 남긴다.
  const f = fixture(t);
  f.withLogin();
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  assert.equal(existsSync(f.configFile), true);
  rmSync(f.d('run', 'login-info'));
  const r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(f.configFile), false);
  assert.match(r.stderr, /OpenAI 호환 연결 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요\(연결 전에는 칸을 띄우지 않습니다\)/);
  // 빈 파일도 같다
  writeFileSync(f.d('run', 'login-info'), '');
  assert.notEqual(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
});

test('writeOpencodeConfig_rejectsMalformedLoginInfoAndUnsafeModelWithoutLeakingValues', (t) => {
  const f = fixture(t);
  for (const bad of ['not json', '[]', JSON.stringify({ providerId: 'a/b', options: {} }), JSON.stringify({ providerId: 'custom' }), JSON.stringify({ providerId: 'custom', options: 'sk-secret' })]) {
    f.withLogin(bad);
    const r = callLib(f.env, `${BOOT} && write_opencode_config`);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /연결 정보의 꼴이 올바르지 않습니다/);
    assert.doesNotMatch(r.stdout + r.stderr, /sk-secret/);
    assert.equal(existsSync(f.configFile), false);
  }
  // 따옴표·공백·개행이 든 모델 id 는 받지 않는다
  f.withLogin({ ...LOGIN_OBJ, defaultModel: 'custom/bad"model x' });
  const unsafe = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /모델 값의 꼴이 올바르지 않습니다/);
  assert.equal(existsSync(f.configFile), false);
});

test('writeOpencodeConfig_keepsProviderOverridesMergesModelsAndDeclaresVisionOnlyWhenTrue', (t) => {
  const f = fixture(t);
  const login = {
    providerId: 'genia',
    npm: '@ai-sdk/openai',
    options: { baseURL: 'https://x.test/v1', apiKey: 'k', headers: { 'X-A': '1' } },
    models: { 'm-a': { limit: { context: 1000, output: 100 } }, 'm-b': { name: 'B' } },
    vision: true,
    defaultModel: 'genia/m-b',
  };
  f.withLogin(login);
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  let p = f.config().provider.genia;
  assert.equal(p.npm, '@ai-sdk/openai');
  assert.equal(p.name, 'genia'); // 이름이 없으면 providerId
  assert.deepEqual(p.options, login.options);
  // 연결 정보의 models 는 그대로 두고, 고른 모델 항목에만 이미지 입력을 선언한다
  assert.deepEqual(p.models['m-a'], { limit: { context: 1000, output: 100 } });
  assert.deepEqual(p.models['m-b'], { name: 'B', modalities: { input: ['text', 'image'], output: ['text'] } });
  // vision 이 false 이거나 이 모델 항목이 없으면 선언하지 않는다
  f.withLogin({ ...login, vision: { 'genia/m-b': false, 'genia/m-a': true } });
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  p = f.config().provider.genia;
  assert.equal(p.models['m-b'].modalities, undefined);
  // models 가 객체가 아니면(꼴이 다름) 무시하고 고른 모델 한 항목만 둔다
  f.withLogin({ ...login, models: ['x'], vision: undefined });
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  assert.deepEqual(f.config().provider.genia.models, { 'm-b': {} });
});

/**
 * 가짜 모델 서버를 다른 프로세스로 띄운다(WP-1735) — callLib 은 spawnSync 라 이 프로세스의 이벤트 루프가 멈춰, 같은 프로세스의 서버는 답하지 못한다.
 * body 가 있으면 GET /v1/models 에 그 JSON 으로, 'hang' 이면 답하지 않는다. 받은 요청(경로·Authorization)은 seen() 으로 읽는다.
 */
async function childModelServer(t, f, body) {
  const seenFile = f.d('out', `models-seen-${Math.random().toString(36).slice(2)}.log`);
  const code = `
    const { appendFileSync } = require('node:fs');
    const body = process.env.BODY;
    require('node:http').createServer((req, res) => {
      appendFileSync(process.env.SEEN, JSON.stringify({ url: req.url, auth: req.headers.authorization ?? null }) + '\\n');
      if (body === 'hang') return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    }).listen(0, '127.0.0.1', function () { console.log(this.address().port); });`;
  const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, BODY: body === 'hang' ? 'hang' : JSON.stringify(body), SEEN: seenFile }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    child.once('exit', (c) => reject(new Error(`가짜 모델 서버가 끝났습니다(${c})`)));
  });
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    seen: () => (existsSync(seenFile) ? readFileSync(seenFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

test('writeOpencodeConfig_putsModelServerContextLimitIntoSelectedModel', async (t) => {
  // vLLM 의 max_model_len — models.dev 에 없는 provider(custom)는 출력 한도를 모르면 output 0(모름)으로 둔다(ai-agent 와 같은 규칙, 사례 파일).
  const f = fixture(t, { env: { OPENCODE_MODEL_LIMIT: MODEL_LIMIT } });
  const s = await childModelServer(t, f, { data: [{ id: 'qwen3-27b', object: 'model', max_model_len: 131072 }, { id: 'other', max_model_len: 4096 }] });
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: s.baseURL, apiKey: 'sk-fake-secret-value' } });
  const r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': { limit: { context: 131072, output: 0 } } });
  assert.deepEqual(s.seen(), [{ url: '/v1/models', auth: 'Bearer sk-fake-secret-value' }]);
  assert.match(r.stderr, /모델 서버에서 문맥 한도를 읽었습니다\(모델 qwen3-27b, 문맥 131072 · 출력 0\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /sk-fake-secret-value/);

  // metadata.limits(문맥·출력) — 이미지 입력 선언과 함께 놓인다.
  const meta = await childModelServer(t, f, { data: [{ id: 'qwen3-vl', metadata: { limits: { max_context_length: 262128, max_output_tokens: 131072 } } }] });
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: meta.baseURL }, defaultModel: 'custom/qwen3-vl' });
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  assert.deepEqual(f.config().provider.custom.models['qwen3-vl'], {
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 262128, output: 131072 },
  });
});

test('writeOpencodeConfig_withoutKnownLimitOrWhenModelServerFailsLaunchesWithoutLimit', async (t) => {
  const f = fixture(t, { env: { OPENCODE_MODEL_LIMIT: MODEL_LIMIT } });
  // 한도 필드가 없다 — 경고 없이 limit 을 두지 않는다(지금 동작).
  const none = await childModelServer(t, f, { data: [{ id: 'qwen3-27b', object: 'model' }] });
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: none.baseURL } });
  let r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': {} });
  assert.doesNotMatch(r.stderr, /경고/);
  // 답이 없다(시간 초과) — 칸 띄우기를 막지 않고 경고만 남긴다.
  const hang = await childModelServer(t, f, 'hang');
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: hang.baseURL, apiKey: 'sk-fake-secret-value' } });
  r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': {} });
  assert.match(r.stderr, /\[entrypoint\] 경고: 모델 서버에서 문맥 한도를 읽지 못했습니다\(1000ms 안에 답이 없음\) — 한도 없이 띄웁니다/);
  assert.doesNotMatch(r.stdout + r.stderr, /sk-fake-secret-value|127\.0\.0\.1/);
  // 서버가 없다(연결 거절)도 같다.
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: 'http://127.0.0.1:9/v1' } });
  r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': {} });
  assert.match(r.stderr, /경고: 모델 서버에서 문맥 한도를 읽지 못했습니다/);
});

test('writeOpencodeConfig_keepsLimitWrittenInConnectionWithoutAsking', async (t) => {
  // 연결 정보에 사람이 적은 limit 이 있으면 그 값을 쓰고 모델 서버에 묻지 않는다.
  const f = fixture(t, { env: { OPENCODE_MODEL_LIMIT: MODEL_LIMIT } });
  const s = await childModelServer(t, f, { data: [{ id: 'qwen3-27b', max_model_len: 131072 }] });
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: s.baseURL }, models: { 'qwen3-27b': { limit: { context: 50000, output: 4000 } } } });
  let r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': { limit: { context: 50000, output: 4000 } } });
  assert.deepEqual(s.seen(), []);
  // 꼴이 틀린 limit(null·output 없음)은 OpenCode 가 설정을 거절하므로 경고하고 모델 서버 값으로 바꾼다.
  for (const limit of [null, { context: 50000 }]) {
    f.withLogin({ ...LOGIN_OBJ, options: { baseURL: s.baseURL }, models: { 'qwen3-27b': { name: 'Q', limit } } });
    r = callLib(f.env, `${BOOT} && write_opencode_config`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': { name: 'Q', limit: { context: 131072, output: 0 } } }, JSON.stringify(limit));
    assert.match(r.stderr, /경고: 연결 정보의 모델 qwen3-27b limit 꼴이 올바르지 않아/);
  }
  // 꼴이 틀렸는데 모델 서버도 모르면 limit 을 빼고 띄운다(틀린 값을 넘기지 않는다).
  const none = await childModelServer(t, f, { data: [{ id: 'qwen3-27b' }] });
  f.withLogin({ ...LOGIN_OBJ, options: { baseURL: none.baseURL }, models: { 'qwen3-27b': { limit: null } } });
  r = callLib(f.env, `${BOOT} && write_opencode_config`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.config().provider.custom.models, { 'qwen3-27b': {} });
});

test('modelLimitScript_runsThroughSymlinkedPath', async (t) => {
  // 경로에 심볼릭 링크가 있어도 명령으로 불린 것을 알아본다 — 못 알아보면 말없이 아무것도 내지 않아 한도가 빠진다(리뷰 지적).
  const f = fixture(t);
  const s = await childModelServer(t, f, { data: [{ id: 'm', max_model_len: 131072 }] });
  writeFileSync(f.d('run', 'login-info'), JSON.stringify({ providerId: 'custom', options: { baseURL: s.baseURL } }));
  symlinkSync(join(appDir, 'bin'), f.d('linked-bin'));
  const r = spawnSync(process.execPath, [f.d('linked-bin', 'model-limit.mjs'), f.d('run', 'login-info'), 'm'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { context: 131072, output: 0 });
});

// 진짜 opencode 가 있으면 만든 설정이 설정 검증을 통과하고 구동기가 넘기는 설정과 병합되는지 본다(OpenCode 는 모르는 키가 있으면 시작하지 않는다).
const realOpencode = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).status === 0;
test('writeOpencodeConfig_isAcceptedByRealOpencodeAndMergesWithInlineConfig', { skip: !realOpencode && 'opencode 없음' }, (t) => {
  const f = fixture(t);
  f.withLogin();
  assert.equal(callLib(f.env, `${BOOT} && write_opencode_config`).status, 0);
  const content = JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: 'allow', mcp: { 'genia-works': { type: 'remote', url: 'http://127.0.0.1:9/mcp', oauth: false } } });
  const home = f.d('home');
  const r = spawnSync('opencode', ['debug', 'config'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: f.d('work', 'xdg-data'),
      XDG_CACHE_HOME: f.d('work', 'xdg-cache'),
      XDG_STATE_HOME: f.d('work', 'xdg-state'),
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_CONFIG_CONTENT: content,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 0, r.stderr);
  const merged = JSON.parse(r.stdout);
  assert.equal(merged.model, 'custom/qwen3-27b');
  assert.deepEqual(Object.keys(merged.provider), ['custom']);
  assert.deepEqual(Object.keys(merged.mcp), ['genia-works']);
  assert.equal(merged.share, 'disabled');
});

// ---------------------------------------------------------------- 전역 지시(write_opencode_agents_md)

test('writeOpencodeAgentsMd_pointsToUsingSuperpowersSkillEveryBoot', (t) => {
  // OpenCode 는 세션 시작 hook 이 없다 — superpowers 의 using-superpowers 안내를 ~/.config/opencode/AGENTS.md(전역 지시)로 싣는다. 매번 새로 쓴다.
  const f = fixture(t);
  const skill = f.d('home', '.agents', 'skills', 'superpowers', 'using-superpowers', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: using-superpowers\n---\n');
  const out = join(dirname(f.configFile), 'AGENTS.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, 'stale\n');
  const r = callLib(f.env, `${BOOT} && write_opencode_agents_md`);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(out, 'utf8');
  assert.doesNotMatch(md, /stale/);
  assert.ok(md.includes(`using-superpowers 스킬 파일 ${skill} 을 읽고 그대로 따른다`), md);
  assert.match(md, /Skill → skill, Task\(서브에이전트\) → task, TodoWrite → todowrite/);
  assert.equal(statSync(out).mode & 0o777, 0o600);
});

test('writeOpencodeAgentsMd_removesStaleFileAndWarnsWhenSkillMissing', (t) => {
  // 이미지에 스킬이 없으면 없는 경로를 가리키지 않게 옛 파일을 지우고 경고만 한다.
  const f = fixture(t);
  const out = join(dirname(f.configFile), 'AGENTS.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, 'stale\n');
  const r = callLib(f.env, `${BOOT} && write_opencode_agents_md`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(out), false);
  assert.match(r.stderr, /using-superpowers 스킬\(.*\)이 없습니다/);
});

// ---------------------------------------------------------------- 칸을 띄울 수 있는지(can_launch)

test('canLaunch_trueOnlyWhenOpencodeJsonWasWritten', (t) => {
  const f = fixture(t);
  f.withLogin();
  const without = callLib(f.env, `${BOOT} && can_launch`);
  assert.notEqual(without.status, 0);
  const withCfg = callLib(f.env, `${BOOT} && write_opencode_config && can_launch`);
  assert.equal(withCfg.status, 0, withCfg.stderr);
});

// ---------------------------------------------------------------- 이미지·카탈로그

test('dockerfileKeepsSharedToolBlockIdenticalToGeniaImage', () => {
  // 도구 블록(apt·glab·Claude Code·사용자)은 Gen:iA Code 이미지와 글자까지 같아야 한다 — 한쪽만 바뀌면 실행기들의 작업 공간이 갈린다.
  const block = (p) => readFileSync(p, 'utf8').match(/^# ---- Claude 이미지 Dockerfile 과 같은 도구 블록[\s\S]*?^# ---- 같은 도구 블록 끝 ----$/m)?.[0];
  const mine = block(join(appDir, 'Dockerfile'));
  assert.ok(mine);
  assert.equal(mine, block(join(appDir, '..', 'workplace-agent-genia-code', 'Dockerfile')));
  // Claude Code·npm(WP-1574) 버전은 Claude 이미지와 같아야 한다
  for (const arg of ['CLAUDE_CODE_VERSION', 'NPM_VERSION']) {
    const version = (d) => d.match(new RegExp(`^ARG ${arg}=(\\S+)$`, 'm'))?.[1];
    assert.equal(version(readFileSync(join(appDir, 'Dockerfile'), 'utf8')), version(readFileSync(join(appDir, '..', 'workplace-agent-claude-code', 'Dockerfile'), 'utf8')), arg);
  }
});

test('dockerfilePinsOpencodeAndBakesDriverPluginAndSkills', () => {
  const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
  // OpenCode 는 고정 버전 — latest 로 두면 구동기 인자·설정 키가 말없이 바뀔 수 있다. 11-08 실측은 1.18.31.
  assert.match(dockerfile, /^ARG OPENCODE_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /npm install -g --no-fund --no-audit "opencode-ai@\$\{OPENCODE_VERSION\}"/);
  // 구동기와 그것이 import 하는 것(genia/loop.js → hooks/lib.js), 버전 파일, 스크립트·스킬
  for (const p of ['opencode', 'genia', 'hooks', 'scripts', 'skills', '.claude-plugin']) {
    assert.match(dockerfile, new RegExp(`^COPY plugins/genia-works/${p.replace('.', '\\.')}/ /opt/genia/plugin/genia-works/${p.replace('.', '\\.')}/$`, 'm'), p);
  }
  assert.doesNotMatch(dockerfile, /plugins\/genia-works\/(tests|codex)|^RUN .*chmod/m);
  assert.match(dockerfile, /^COPY --chmod=755 apps\/workplace-agent-claude-code\/bin\/lib\.sh \/opt\/genia\/bin\/lib\.sh$/m);
  assert.match(dockerfile, /^COPY --chmod=755 apps\/workplace-agent-claude-code\/bin\/agent-screen apps\/workplace-agent-opencode\/bin\/ \/opt\/genia\/bin\/$/m);
  // OpenCode 설치는 플러그인 받기 뒤(버전만 올려도 그 단계를 다시 하지 않게). 버전은 빌드 ARG 로만 — ENV 로 두면 모든 칸·빌드에 새어 나간다
  assert.ok(dockerfile.indexOf('install_plugins /opt/genia/plugins.lock') < dockerfile.indexOf('"opencode-ai@${OPENCODE_VERSION}"'));
  assert.doesNotMatch(dockerfile, /^ENV OPENCODE_VERSION/m);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--", "\/opt\/genia\/bin\/entrypoint"\]/);
  // 개발 절차 플러그인(WP-1336): Claude 이미지와 같은 lock 으로 받아 스킬 폴더를 OpenCode 가 읽는 ~/.agents/skills 로 잇는다
  assert.match(dockerfile, /install_plugins \/opt\/genia\/plugins\.lock "" genia-works@genia-works/);
  assert.match(dockerfile, /ln -sfn "\$path\/skills" "\/home\/agent\/\.agents\/skills\/\$\{id%@\*\}"/);
  assert.match(dockerfile, /test -f \/home\/agent\/\.agents\/skills\/superpowers\/using-superpowers\/SKILL\.md/);
  assert.match(dockerfile, /COPY --chown=1001:1001 apps\/workplace-agent-genia-code\/skills\/ \/home\/agent\/\.agents\/skills\//);
  // 사내 모델 서버 루트 CA 는 넣는다 — 연결이 그 서버를 가리키면 OpenCode 가 믿어야 한다(11-09 AI 테스터1, opencode_ca 가 칸에 넘긴다)
  assert.match(dockerfile, /^COPY --chmod=644 apps\/workplace-agent-genia-code\/genia-root\.crt \/usr\/local\/share\/ca-certificates\/genia-root\.crt$/m);
  assert.match(dockerfile, /^RUN update-ca-certificates$/m);
  // 그 밖의 사내 Gen:iA 것(배포 서버·실행기 설정)·Codex 것은 넣지 않는다
  assert.doesNotMatch(dockerfile, /genia-code-server|GENIA_SKIP_VERSION_CHECK|@openai\/codex|gw-models/);
});

test('catalogRebuildsImageWhenItsInputsChange', () => {
  // 이 이미지가 COPY 하는 저장소 파일이 바뀌면 다시 빌드한다(릴리스 카탈로그의 paths).
  const catalog = JSON.parse(readFileSync(join(repoRoot, 'deploy', 'release', 'image-catalog.json'), 'utf8'));
  const entry = catalog.images.find((i) => i.id === 'agent-opencode');
  assert.ok(entry);
  assert.equal(entry.repository, 'docker.io/iacloudops/genia-works-agent-opencode');
  assert.equal(entry.dockerfile, 'apps/workplace-agent-opencode/Dockerfile');
  assert.equal(entry.helm, false);
  for (const p of [
    'apps/workplace-agent-opencode/',
    'apps/workplace-agent-genia-code/genia-root.crt',
    'apps/workplace-agent-claude-code/bin/lib.sh',
    'apps/workplace-agent-claude-code/bin/agent-screen',
    'apps/workplace-agent-claude-code/plugins.lock',
    'apps/workplace-agent-genia-code/skills/',
    'plugins/genia-works/',
  ]) {
    assert.ok(entry.paths.includes(p), p);
  }
});

// ---------------------------------------------------------------- 엔트리포인트 전체(진짜 tmux·플러그인 스크립트·opencode 구동기)

tmuxTest('entrypoint_launchesOpencodeLoopPaneWithConfigAndStopsOnSigterm', async (t) => {
  const f = fixture(t);
  const skill = f.d('home', '.agents', 'skills', 'superpowers', 'using-superpowers', 'SKILL.md');
  mkdirSync(dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: using-superpowers\n---\n');
  f.withLogin();
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, { ...f.env, GENIA_LOGIN_VERSION: '11' });
  await until(() => existsSync(f.d('out', 'run-WP.env')), 'WP 칸의 opencode run', 30000, e.log);
  const lines = f.read('out', 'run-WP.env').split('\n');
  const aiDir = f.d('work', 'agents', 'kodi');
  for (const want of [
    `XDG_DATA_HOME=${aiDir}/opencode/data`,
    'OPENCODE_DISABLE_AUTOUPDATE=1',
    'OPENCODE_DISABLE_MODELS_FETCH=1',
    'GENIA_WORKS_AS=kodi',
    `GENIA_WORKS_AGENT_DIR=${aiDir}`,
    'GENIA_WORKS_RUNNER_WAKES=1',
    'GENIA_WORKS_MCP_URL=http://127.0.0.1:9/mcp',
    'GENIA_WORKS_TENANT=3',
    'GENIA_AGENT_GENERATION=7',
    // 사내 모델 서버 루트 CA 묶음(opencode_ca)이 칸의 opencode 까지 간다(11-09 운영 AI 테스터1)
    `NODE_EXTRA_CA_CERTS=${f.d('home', '.genia-node-ca.pem')}`,
    'mcp-token-present',
    'config-content-present',
    'arg run',
    'arg --format',
    'arg json',
  ]) {
    assert.ok(lines.includes(want), `${want} 가 없습니다:\n${lines.join('\n')}`);
  }
  // 프롬프트는 굳힌 플러그인의 work-loop 스킬을 가리키고 대기열 라벨을 넘긴다
  assert.ok(lines.some((l) => l.includes('work-loop')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('WP --queue "AI 개발팀"')), lines.join('\n'));
  // 실행기는 opencode 로 적혔고, 설정은 연결 정보에서 만들어졌다. Claude 의 ~/.claude.json 은 만들지 않는다.
  assert.match(readFileSync(join(aiDir, 'agent.conf'), 'utf8'), /cli=opencode/);
  assert.match(e.log(), /^\[entrypoint\] OpenCode 1\.18\.31-fake$/m); // 부팅 때 opencode --version 으로 실제로 도는지 본다
  assert.equal(JSON.parse(readFileSync(f.configFile, 'utf8')).model, 'custom/qwen3-27b');
  assert.match(readFileSync(join(dirname(f.configFile), 'AGENTS.md'), 'utf8'), /using-superpowers 스킬 파일 \S+\/using-superpowers\/SKILL\.md 을 읽고/);
  assert.equal(existsSync(f.d('home', '.claude.json')), false);
  // 띄운 칸을 다시 띄우거나 실패로 적지 않는다. 원문 값은 로그에 없다.
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  assert.equal((e.log().match(/WP: started/g) ?? []).length, 1, e.log());
  assert.doesNotMatch(e.log(), /WP: (revived|restarted)|WP 칸을 띄우지 못했습니다/);
  assert.doesNotMatch(e.log(), /sk-fake-secret-value|ghp_secrettoken|ak_testkey123/);
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

tmuxTest('entrypoint_doesNotLaunchPaneWithoutLoginInfoButKeepsRunning', async (t) => {
  // 연결 정보가 없으면 칸·알림 감시 창을 띄우지 않는다 — 경고만, 엔트리포인트는 끝내지 않는다.
  const f = fixture(t);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  // opencode 가 버전에 답하지 않으면(바이너리 깨짐) 부팅 로그에 경고가 남는다 — 끝내지는 않는다.
  const e = startEntrypoint(t, { ...f.env, FAKE_OPENCODE_BROKEN: '1' });
  await until(() => /OpenAI 호환 연결 정보가 연결되지 않았습니다/.test(e.log()), '연결 정보 없음 경고', 15000, e.log);
  assert.match(e.log(), /경고: opencode --version 이 답하지 않습니다/);
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  assert.equal(e.child.exitCode, null, e.log());
  assert.equal(existsSync(f.d('out', 'run-WP.env')), false);
  assert.equal(existsSync(f.d('work', 'agents', 'kodi', 'repos', 'WP')), false);
  assert.equal(existsSync(f.configFile), false);
  assert.notEqual(f.tmux('list-sessions').status, 0);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('entrypoint_doesNotLaunchPaneWhenModelCannotBeDecidedButKeepsRunning', async (t) => {
  // 연결은 있는데 모델을 정할 수 없으면(auto + 연결에 지정한 모델 없음) 분명한 오류를 남기고 칸을 띄우지 않는다 — 끝내지 않는다(끝내면 kubelet 이 헛돈다).
  const f = fixture(t);
  const { defaultModel: _drop, ...noModel } = LOGIN_OBJ;
  f.withLogin(noModel);
  writeFileSync(f.d('out', 'projects.json'), JSON.stringify([{ projectKey: 'WP', name: 'WP', repositoryUrl: bareRepo(f.d('git')), repositoryBranch: null }]));
  const e = startEntrypoint(t, f.env);
  await until(() => /오류: 모델을 정할 수 없습니다/.test(e.log()), '모델 오류', 15000, e.log);
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  assert.equal(e.child.exitCode, null, e.log());
  assert.equal(existsSync(f.d('out', 'run-WP.env')), false);
  assert.doesNotMatch(e.log(), /sk-fake-secret-value/);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

// ---------------------------------------------------------------- 칸 차단 보고(gw-boot — WP-1913)

/**
 * 칸 차단 보고(PUT /api/v1/agent-runtime/me/pane)를 받는 로컬 stub 서버(WP-1913) — 401행 가짜 모델 서버와 같은 node:http.createServer
 * 패턴. 받은 본문(state·message)을 모아 나중에 본다. 엔트리포인트를 뒤에서 띄우는 테스트는 이벤트 루프가 비어 있으므로 같은 프로세스에 둔다.
 */
async function paneServer(t) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'PUT' && req.url.endsWith('/agent-runtime/me/pane')) {
        seen.push(JSON.parse(body));
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, seen: () => seen };
}

tmuxTest('모델을 정할 수 없으면 gw-boot 로 차단을 보고하고 계속 돈다', async (t) => {
  // write_opencode_config 가 실패하면(모델 못 정함) tick 이 매 회차 gw-boot blocked 로 서버에 보고한다 — 진입점은 끝내지 않는다(끝내면 kubelet 이 헛돈다).
  // 기존처럼 fixture 의 API 주소 기본값(못 닿음)은 그대로 두고, 이 테스트만 env 로 stub 서버 주소를 넘겨 보고를 받는다.
  const f = fixture(t);
  const s = await paneServer(t);
  const { defaultModel: _drop, ...noModel } = LOGIN_OBJ;
  f.withLogin(noModel);
  const e = startEntrypoint(t, { ...f.env, GENIA_WORKS_API_URL: s.url });
  await until(() => s.seen().some((b) => b.state === 'BLOCKED' && b.message.includes('모델을 정할 수 없습니다')), 'gw-boot 차단 보고', 15000, e.log);
  // 보고를 받은 뒤에도 감독 회차가 계속 돈다.
  await until(() => ticks(f) >= 2, '감독 회차 두 번', 15000, e.log);
  assert.equal(e.child.exitCode, null, e.log());
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

tmuxTest('정상 기동하면 차단을 보고하지 않는다(pane-boot-ok-sent 표식만)', async (t) => {
  // 정상 기동(can_launch 성공)에서는 차단을 보고하지 않는다 — 부팅 후 처음 한 번 gw-boot ok 만 보내 $AI_DIR/state/pane-boot-ok-sent 표식을 남긴다.
  const f = fixture(t);
  const s = await paneServer(t);
  f.withLogin();
  const e = startEntrypoint(t, { ...f.env, GENIA_WORKS_API_URL: s.url });
  const stateDir = f.d('work', 'agents', 'kodi', 'state');
  await until(() => existsSync(join(stateDir, 'pane-boot-ok-sent')), 'pane-boot-ok-sent 표식', 15000, e.log);
  await until(() => ticks(f) >= 3, '감독 회차 세 번', 15000, e.log);
  // 부팅당 한 번 ok — 그 밖의 보고(BLOCKED)는 없다. 차단 사유 파일도 남지 않는다.
  assert.deepEqual(s.seen().map((b) => b.state), ['OK'], JSON.stringify(s.seen()));
  assert.equal(existsSync(join(stateDir, 'pane-blocked')), false);
  e.child.kill('SIGTERM');
  assert.equal((await e.exited).code, 0);
});

/**
 * 기록만 하는 가짜 gw-boot(WP-1913) — 받은 인자를 한 줄씩 FAKE_OUT/gw-boot-calls 에 이어 붙이고 늘 0 으로 끝난다(진짜 계약과 같음).
 * gw-boot-fail 파일이 있는 동안만 stderr 에 경고 한 줄을 더한다 — 진짜 gw-boot 의 실패(출력 있음·종료 0)를 흉내 낸다.
 */
function fakeBoot(f) {
  const dir = f.d('fake-scripts');
  mkdirSync(dir, { recursive: true });
  exe(join(dir, 'gw-boot'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_OUT/gw-boot-calls"
[ -f "$FAKE_OUT/gw-boot-fail" ] && echo "gw-boot: 칸 차단 보고 실패(HTTP 500) — 보고하지 않고 계속합니다" >&2
exit 0
`);
  return dir;
}

/** 감독 한 회차를 부른다 — 띄울 수 있음(can_launch)·칸 살피기만 가짜로 두고 보고 훅(pane_report_*)은 진짜로 돈다(이 이미지의 can_launch 는 설정 파일을 보므로 따로 연다). */
const tickRun = (f, fake, tail = 'tick') => callLib(f.env, `${BOOT} && GW_SCRIPTS="${fake}" && can_launch() { return 0; } && supervise_once() { :; } && ${tail}`);

test('ok 보고가 실패하면 표식을 남기지 않고 다음 회차에 다시 보고한다', (t) => {
  // gw-boot 는 실패해도 늘 종료 0 이라(최선 노력 계약) 종료 코드로는 성공을 못 본다 — 출력(경고 한 줄)으로만 성공을 판정한다.
  // 실패하면 표식을 남기지 않아야 다음 회차가 다시 보고한다(한 번 시도로 끝나면 서버에 차단 표시가 남는다).
  const f = fixture(t);
  const fake = fakeBoot(f);
  const mark = f.d('work', 'agents', 'kodi', 'state', 'pane-boot-ok-sent');
  writeFileSync(f.d('out', 'gw-boot-fail'), '');

  // 첫 회차 — 보고 실패: 경고는 로그로만 남기고 표식은 없다.
  const first = tickRun(f, fake);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /gw-boot: 칸 차단 보고 실패/);
  assert.equal(existsSync(mark), false);

  // 서버가 고쳐진 뒤 다음 회차 — 표식이 없으니 다시 보고하고, 성공하면 표식을 남긴다.
  rmSync(f.d('out', 'gw-boot-fail'));
  const second = tickRun(f, fake);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(existsSync(mark), true);
  assert.deepEqual(readFileSync(f.d('out', 'gw-boot-calls'), 'utf8').trim().split('\n'), ['ok', 'ok']);
});

test('차단이 풀리면 표식과 무관하게 ok 를 다시 보고하고 차단 사유 파일을 지운다', (t) => {
  // 같은 부팅에서 정상(ok·표식) → 막힘(차단 사유·blocked 보고) → 다시 띄움으로 바뀌는 경우 — 표식만 보면 서버가 FAILED 에 갇힌다.
  // 그래서 차단 사유 파일이 남아 있는 성공 회차는 표식과 무관하게 ok 를 다시 보내고 파일을 지운다(서버 표시 cleared).
  const f = fixture(t);
  const fake = fakeBoot(f);
  const state = f.d('work', 'agents', 'kodi', 'state');

  // 1) 정상 기동 — ok 한 번과 표식.
  const healthy = tickRun(f, fake);
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.equal(existsSync(join(state, 'pane-boot-ok-sent')), true);

  // 2) 같은 부팅에서 막힘 — 차단 사유를 남기고 회차는 blocked 를 보고한다(표식은 이미 있는 상태).
  const blocked = tickRun(f, fake, 'can_launch() { return 1; } && pane_blocked "설정을 바꿨습니다 — 칸을 띄우지 않습니다" && tick');
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.equal(existsSync(join(state, 'pane-blocked')), true);

  // 3) 차단이 풀림 — 표식이 있어도 ok 를 다시 보고하고 차단 사유 파일을 지운다.
  const cleared = tickRun(f, fake);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(existsSync(join(state, 'pane-blocked')), false);
  assert.equal(existsSync(join(state, 'pane-boot-ok-sent')), true);
  assert.deepEqual(readFileSync(f.d('out', 'gw-boot-calls'), 'utf8').trim().split('\n'), [
    'ok',
    'blocked 설정을 바꿨습니다 — 칸을 띄우지 않습니다',
    'ok',
  ]);
});
