// 체크리스트 순수 함수 테스트 (WP-441) — 합성 diff·제목·매니페스트만 쓴다. git·파일시스템·네트워크 없음.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { changedMigrationFiles, dockerEnvNames, extractEnvVars, filterAlreadySet, helmNames, newApps, parseExistingSecretKeys, parseMigrations, pickIssues, renderChecklist, stripHelmComments } from '../lib/checklist.mjs';
import { REPO, baseManifest, catalog } from './helpers.mjs';

/** `git diff -U0` 한 파일 분량을 흉내낸다 — added 는 `+` 줄, removed 는 `-` 줄. path === null 이면 삭제(`+++ /dev/null`). */
function fileDiff(path, added, removed = []) {
  const head = [`diff --git a/${path ?? 'gone.txt'} b/${path ?? 'gone.txt'}`, 'index 111..222 100644', `--- a/${path ?? 'gone.txt'}`, `+++ ${path === null ? '/dev/null' : `b/${path}`}`];
  return [...head, '@@ -1,1 +1,1 @@', ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`), ''].join('\n');
}
/** 삭제된 파일의 diff — `--- a/<경로>` / `+++ /dev/null`, 본문은 `-` 줄만. */
function deletedFileDiff(path, removed) {
  return [`diff --git a/${path} b/${path}`, 'deleted file mode 100644', 'index 111..000', `--- a/${path}`, '+++ /dev/null', '@@ -1,1 +0,0 @@', ...removed.map((l) => `-${l}`), ''].join('\n');
}
const names = (vars) => vars.map((v) => v.name);
const find = (vars, name) => vars.find((v) => v.name === name);

// ---------- extractEnvVars: 파일 종류별 규칙 ----------

test('extractEnvVars: application yml 의 ${A} 는 기본값 없음, ${B:x} 는 기본값 있음, ${C:}(빈 기본값)는 없음', () => {
  const diff = fileDiff('apps/workplace-api/src/main/resources/application.yml', ['  url: ${A}', '  other: ${B:x}', '  empty: ${C:}']);
  const vars = extractEnvVars(diff);
  assert.deepEqual(vars, [
    { name: 'A', hasDefault: false, file: 'apps/workplace-api/src/main/resources/application.yml' },
    { name: 'B', hasDefault: true, file: 'apps/workplace-api/src/main/resources/application.yml' },
    { name: 'C', hasDefault: false, file: 'apps/workplace-api/src/main/resources/application.yml' },
  ]);
});

test('extractEnvVars: application-prod.yaml 도 대상이고 소문자 스프링 프로퍼티(${spring.x})는 무시', () => {
  const vars = extractEnvVars(fileDiff('apps/workplace-api/src/main/resources/application-prod.yaml', ['a: ${spring.datasource.url}', 'b: ${FOo}', 'c: ${REAL_ONE}']));
  assert.deepEqual(names(vars), ['REAL_ONE']);
});

test('extractEnvVars: application 이 아닌 yml 은 무시', () => {
  assert.deepEqual(extractEnvVars(fileDiff('docker-compose.yml', ['  image: ${TAG}'])), []);
});

test('extractEnvVars: 중첩 기본값 ${A:${B}} 는 A(기본값 있음)·B(기본값 없음) 둘 다', () => {
  const vars = extractEnvVars(fileDiff('apps/x/application.yml', ['v: ${A:${B}}']));
  assert.equal(find(vars, 'A').hasDefault, true);
  assert.equal(find(vars, 'B').hasDefault, false);
});

test('extractEnvVars: Python 세 형태와 기본값 판정(두 번째 인자 있으면 기본값 있음)', () => {
  const diff = fileDiff('apps/workplace-converter/app/config.py', [
    'a = os.getenv("PY_A")',
    "b = os.getenv('PY_B', 'x')",
    'c = os.environ.get("PY_C")',
    'd = os.environ.get("PY_D", "x")',
    'e = os.environ["PY_E"]',
    "f = os.environ['PY_F']",
  ]);
  const vars = extractEnvVars(diff);
  assert.deepEqual(vars.map((v) => [v.name, v.hasDefault]), [['PY_A', false], ['PY_B', true], ['PY_C', false], ['PY_D', true], ['PY_E', false], ['PY_F', false]]);
});

test('extractEnvVars: Node 두 형태(.NAME, ["NAME"])', () => {
  const diff = fileDiff('apps/workplace-ai-agent/src/config.ts', ['const a = process.env.NODE_A;', 'const b = process.env["NODE_B"];', "const c = process.env['NODE_C'] ?? 'x';"]);
  assert.deepEqual(names(extractEnvVars(diff)), ['NODE_A', 'NODE_B', 'NODE_C']);
});

test('extractEnvVars: .mts·.js·.mjs 도 대상, process.env.FOO_bar 처럼 소문자가 이어지면 무시', () => {
  const vars = extractEnvVars([fileDiff('apps/a/x.mts', ['process.env.M1']), fileDiff('apps/a/x.js', ['process.env.J1']), fileDiff('apps/a/x.mjs', ['process.env.E1; process.env.BAD_name'])].join(''));
  assert.deepEqual(names(vars), ['E1', 'J1', 'M1']);
});

test('extractEnvVars: 다른 확장자(.md·.sh)와 apps/ 밖의 .java 는 무시', () => {
  const diff = [fileDiff('README.md', ['process.env.IN_DOC']), fileDiff('deploy/run.sh', ['echo ${IN_SHELL}', 'os.getenv("IN_SH")']), fileDiff('A.java', ['System.getenv("IN_JAVA")'])].join('');
  assert.deepEqual(extractEnvVars(diff), []);
});

// ---------- extractEnvVars: 제외·잡음 ----------

test('extractEnvVars: 테스트 경로(tests/ e2e/ __tests__/ test/)는 제외', () => {
  const diff = [
    fileDiff('apps/workplace-converter/tests/test_x.py', ['os.getenv("IN_TESTS")']),
    fileDiff('apps/workplace-web/e2e/helpers.ts', ['process.env.IN_E2E']),
    fileDiff('apps/workplace-web/src/__tests__/a.ts', ['process.env.IN_DUNDER']),
    fileDiff('apps/workplace-api/src/test/resources/application.yml', ['a: ${IN_TEST_DIR}']),
    fileDiff('apps/workplace-ai-agent/src/real.ts', ['process.env.REAL']),
  ].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['REAL']);
});

test('extractEnvVars: *.test.* · *.spec.* · conftest.py 는 제외', () => {
  const diff = [
    fileDiff('apps/a/src/x.test.ts', ['process.env.IN_TEST_TS']),
    fileDiff('apps/a/src/x.spec.mjs', ['process.env.IN_SPEC']),
    fileDiff('apps/b/conftest.py', ['os.getenv("IN_CONFTEST")']),
    fileDiff('apps/b/app.py', ['os.getenv("REAL_PY")']),
  ].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['REAL_PY']);
});

test('extractEnvVars: 경로 조각 일부일 뿐인 이름(latest/, contest/)은 제외하지 않는다', () => {
  const vars = extractEnvVars([fileDiff('apps/latest/a.ts', ['process.env.KEEP_1']), fileDiff('apps/contest/a.ts', ['process.env.KEEP_2'])].join(''));
  assert.deepEqual(names(vars), ['KEEP_1', 'KEEP_2']);
});

test('extractEnvVars: 셸 스크립트·Dockerfile 의 ${TARGETARCH} 같은 변수는 잡음이라 무시', () => {
  const diff = [
    fileDiff('apps/workplace-converter/Dockerfile', ['ARG TARGETARCH', 'RUN echo ${TARGETARCH} ${DOC_MAIL_ID}']),
    fileDiff('deploy/deploy.sh', ['echo "${DOC_MAIL_ID}"']),
    fileDiff('apps/workplace-api/src/main/resources/application.yml', ['a: ${REAL_YML}']),
  ].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['REAL_YML']);
});

test('extractEnvVars: 주석 줄의 예시는 무시', () => {
  const diff = [fileDiff('apps/a/app.py', ['# os.getenv("IN_PY_COMMENT")', 'x = os.getenv("REAL_PY")']), fileDiff('apps/a/x.ts', ['// process.env.IN_TS_COMMENT', ' * process.env.IN_JSDOC', 'process.env.REAL_TS']), fileDiff('apps/a/application.yml', ['# ${IN_YML_COMMENT}', 'a: ${REAL_YML}'])].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['REAL_PY', 'REAL_TS', 'REAL_YML']);
});

test('extractEnvVars: `-` 줄(삭제)과 `+++` 헤더는 변수로 세지 않는다', () => {
  const diff = fileDiff('apps/a/src/x.ts', ['process.env.ADDED_ONE'], ['process.env.REMOVED_ONE']);
  assert.deepEqual(names(extractEnvVars(diff)), ['ADDED_ONE']);
});

test('extractEnvVars: 파일이 삭제된 섹션(+++ /dev/null)에는 추가된 것이 없다', () => {
  const diff = fileDiff(null, [], ['process.env.WAS_HERE']) + fileDiff('apps/a/y.ts', ['process.env.STILL']);
  assert.deepEqual(names(extractEnvVars(diff)), ['STILL']);
});

test('extractEnvVars: 직전 파일의 종류가 다음 파일로 새지 않는다(헤더 상태 초기화)', () => {
  // 앞은 대상 파일, 뒤는 대상 아닌 파일 — 뒤의 줄이 앞 파일 것으로 읽히면 안 된다.
  const diff = fileDiff('apps/a/x.ts', ['process.env.FIRST']) + fileDiff('docs/notes.md', ['process.env.SECOND']);
  assert.deepEqual(names(extractEnvVars(diff)), ['FIRST']);
});

test('extractEnvVars: 한글·공백 경로도 +++ b/ 헤더에서 그대로 읽는다', () => {
  const vars = extractEnvVars(fileDiff('apps/앱 폴더/a.ts', ['process.env.KO_PATH']));
  assert.equal(vars[0].file, 'apps/앱 폴더/a.ts');
});

test('extractEnvVars: 내용이 `++`로 시작하는 추가 줄(`+++x`)도 hunk 안에서는 추가 줄로 읽는다', () => {
  const diff = fileDiff('apps/a/x.ts', ['++ process.env.PLUS_PLUS']);
  assert.deepEqual(names(extractEnvVars(diff)), ['PLUS_PLUS']);
});

test('extractEnvVars: 빈 입력은 빈 배열', () => {
  assert.deepEqual(extractEnvVars(''), []);
});

// ---------- extractEnvVars: 병합 ----------

test('extractEnvVars: 같은 변수는 하나로 — 하나라도 기본값 없으면 기본값 없음, 파일은 기본값 없는 처음 곳', () => {
  const diff = [
    fileDiff('apps/workplace-api/src/main/resources/application.yml', ['a: ${SHARED:dflt}']),
    fileDiff('apps/workplace-converter/app/config.py', ['x = os.environ["SHARED"]']),
    fileDiff('apps/z.ts', ['process.env.SHARED']),
  ].join('');
  const vars = extractEnvVars(diff);
  assert.equal(vars.length, 1);
  // 처음 본 yml 은 기본값이 있으니, 기본값 없는 첫 곳(py)이 파일로 남는다.
  assert.deepEqual(vars[0], { name: 'SHARED', hasDefault: false, file: 'apps/workplace-converter/app/config.py' });
});

test('extractEnvVars: 모두 기본값이 있으면 기본값 있음이고 파일은 처음 나온 곳', () => {
  const diff = [fileDiff('apps/a/x.ts', ['process.env.BOTH ?? 1']), fileDiff('apps/b/y.ts', ['process.env.BOTH || 2'])].join('');
  assert.deepEqual(extractEnvVars(diff), [{ name: 'BOTH', hasDefault: true, file: 'apps/a/x.ts' }]);
});

test('extractEnvVars: 이름순 정렬', () => {
  const vars = extractEnvVars(fileDiff('apps/a/x.ts', ['process.env.ZED, process.env.ALPHA, process.env.MID_1']));
  assert.deepEqual(names(vars), ['ALPHA', 'MID_1', 'ZED']);
});

// ---------- extractEnvVars: 기본값 판정 ----------

test('extractEnvVars: 빈 리터럴 기본값(yml ${X:}, Python getenv("X", "")·get("X", \'\')·None)은 기본값 없음', () => {
  const vars = extractEnvVars(
    fileDiff('apps/a/application.yml', ['a: ${EMPTY_YML:}', 'b: ${FULL_YML:x}']) +
      fileDiff('apps/a/c.py', ['a = os.getenv("EMPTY_PY", "")', "b = os.environ.get('EMPTY_PY2', '')", 'c = os.getenv("NONE_PY", None)', 'd = os.getenv("FULL_PY", "x")']),
  );
  assert.deepEqual(vars.map((v) => [v.name, v.hasDefault]), [['EMPTY_PY', false], ['EMPTY_PY2', false], ['EMPTY_YML', false], ['FULL_PY', true], ['FULL_YML', true], ['NONE_PY', false]]);
});

test('extractEnvVars: Python `os.environ.get("X") or …`·`os.getenv("X") or …`(빈 기본값 뒤 or 포함)는 기본값 있음', () => {
  const vars = extractEnvVars(fileDiff('apps/a/c.py', ['a = os.environ.get("OR_A") or "x"', 'b = os.getenv("OR_B") or default_b', 'c = os.getenv("OR_C", "") or "y"', 'd = os.getenv("NO_OR")', 'e = os.getenv("NO_OR2") + " or "']));
  assert.deepEqual(vars.map((v) => [v.name, v.hasDefault]), [['NO_OR', false], ['NO_OR2', false], ['OR_A', true], ['OR_B', true], ['OR_C', true]]);
});

test('extractEnvVars: Node `process.env.X ?? …`·`|| …`는 기본값 있음, 그 밖에는 없음', () => {
  const vars = extractEnvVars(fileDiff('apps/a/x.ts', ['const a = process.env.N_A ?? "x";', "const b = process.env['N_B'] || 3;", 'const c = process.env.N_C;', 'const d = process.env.N_D === "1";', 'f(process.env.N_E, x ?? 1);']));
  assert.deepEqual(vars.map((v) => [v.name, v.hasDefault]), [['N_A', true], ['N_B', true], ['N_C', false], ['N_D', false], ['N_E', false]]);
});

// ---------- extractEnvVars: 범위 ----------

test('extractEnvVars: apps/ 밖의 파일은 무시', () => {
  const diff = [fileDiff('deploy/release/x.mjs', ['process.env.OUT_DEPLOY']), fileDiff('packages/x/src/a.ts', ['process.env.OUT_PKG']), fileDiff('apps/a/src/a.ts', ['process.env.IN_APPS'])].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['IN_APPS']);
});

test('extractEnvVars: *.config.{ts,mts,js,mjs} 와 eval/·scripts/ 경로는 무시', () => {
  const diff = [
    fileDiff('apps/workplace-web/playwright.config.ts', ['process.env.E2E_BASE']),
    fileDiff('apps/workplace-web/vite.config.mts', ['process.env.VITE_PROXY']),
    fileDiff('apps/a/tailwind.config.js', ['process.env.CFG_JS']),
    fileDiff('apps/a/x.config.mjs', ['process.env.CFG_MJS']),
    fileDiff('apps/workplace-ai-agent/eval/run.ts', ['process.env.IN_EVAL']),
    fileDiff('apps/workplace-worker/scripts/seed.py', ['os.getenv("IN_SCRIPTS")']),
    fileDiff('apps/workplace-web/src/real.ts', ['process.env.REAL_ONE']),
  ].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['REAL_ONE']);
});

test('extractEnvVars: yml 은 application(-prod).yml|yaml 만 — local/test 등 다른 프로파일은 무시', () => {
  const dir = 'apps/workplace-api/src/main/resources';
  const diff = [
    fileDiff(`${dir}/application.yml`, ['a: ${YML_BASE}']),
    fileDiff(`${dir}/application.yaml`, ['a: ${YAML_BASE}']),
    fileDiff(`${dir}/application-prod.yml`, ['a: ${YML_PROD}']),
    fileDiff(`${dir}/application-prod.yaml`, ['a: ${YAML_PROD}']),
    fileDiff(`${dir}/application-local.yml`, ['a: ${YML_LOCAL}']),
    fileDiff(`${dir}/application-test.yml`, ['a: ${YML_TEST}']),
    fileDiff(`${dir}/application-dev.yaml`, ['a: ${YAML_DEV}']),
  ].join('');
  assert.deepEqual(names(extractEnvVars(diff)), ['YAML_BASE', 'YAML_PROD', 'YML_BASE', 'YML_PROD']);
});

// ---------- extractEnvVars: 옮긴 줄 ----------

test('extractEnvVars: 같은 파일의 삭제 줄에도 있던 변수(줄 이동·수정)는 새 변수가 아니다', () => {
  const diff =
    fileDiff('apps/a/x.ts', ['const moved = process.env.MOVED_VAR;', 'const n = process.env.NEW_VAR;'], ['const old = process.env.MOVED_VAR;']) +
    fileDiff('apps/b/y.ts', ['process.env.ONLY_IN_B']);
  assert.deepEqual(names(extractEnvVars(diff)), ['NEW_VAR', 'ONLY_IN_B']);
});

test('extractEnvVars: 삭제 줄 제외는 앱 단위 — 다른 앱에서 지워진 변수가 이 앱의 추가를 가리지 않는다(새 앱은 자기 설정이 필요)', () => {
  const diff = fileDiff('apps/a/x.ts', ['process.env.SHARED_NAME'], []) + fileDiff('apps/b/y.ts', [], ['process.env.SHARED_NAME']);
  assert.deepEqual(extractEnvVars(diff), [{ name: 'SHARED_NAME', hasDefault: false, file: 'apps/a/x.ts' }]);
});

test('extractEnvVars: 같은 앱의 다른 파일로 옮긴 변수는 새 변수가 아니다(추가 파일이 먼저여도 뒤여도)', () => {
  const added = fileDiff('apps/a/src/new.ts', ['const v = process.env.MOVED_ACROSS;', 'const n = process.env.TRULY_NEW;']);
  const removed = fileDiff('apps/a/src/old.ts', [], ['const v = process.env.MOVED_ACROSS;']);
  assert.deepEqual(names(extractEnvVars(added + removed)), ['TRULY_NEW']);
  assert.deepEqual(names(extractEnvVars(removed + added)), ['TRULY_NEW']);
});

test('extractEnvVars: 삭제된 파일(+++ /dev/null)의 - 줄도 삭제로 센다 — 경로와 종류는 `--- a/<경로>` 에서 읽는다', () => {
  const diff = fileDiff('apps/a/src/new.py', ['x = os.getenv("MOVED_FROM_GONE")', 'y = os.getenv("FRESH")']) + deletedFileDiff('apps/a/src/old.py', ['x = os.getenv("MOVED_FROM_GONE")']);
  assert.deepEqual(names(extractEnvVars(diff)), ['FRESH']);
});

test('extractEnvVars: 삭제된 파일이 대상 밖(테스트 경로·앱 밖)이면 아무것도 가리지 않는다', () => {
  const diff = fileDiff('apps/a/src/new.ts', ['process.env.KEEP_ME']) + deletedFileDiff('apps/a/tests/old.ts', ['process.env.KEEP_ME']) + deletedFileDiff('docs/old.ts', ['process.env.KEEP_ME']);
  assert.deepEqual(names(extractEnvVars(diff)), ['KEEP_ME']);
});

test('extractEnvVars: 앱 사이로 옮긴 변수(옛 앱 삭제 + 새 앱 추가)는 여전히 보고한다 — 새 앱이 자기 설정을 가져야 한다', () => {
  const diff = deletedFileDiff('apps/old-app/src/cfg.ts', ['process.env.MOVED_BETWEEN_APPS']) + fileDiff('apps/new-app/src/cfg.ts', ['process.env.MOVED_BETWEEN_APPS']);
  assert.deepEqual(extractEnvVars(diff), [{ name: 'MOVED_BETWEEN_APPS', hasDefault: false, file: 'apps/new-app/src/cfg.ts' }]);
});

// ---------- extractEnvVars: Java / Kotlin ----------

test('extractEnvVars: Java·Kotlin System.getenv("X") 는 기본값 없음, Kotlin 엘비스 `?: …` 가 이어지면 있음', () => {
  const diff =
    fileDiff('apps/workplace-api/src/main/java/com/x/Cfg.java', ['String a = System.getenv("JV_A");', 'String b = System.getenv( "JV_B" ) + "x";']) +
    fileDiff('apps/workplace-api/src/main/kotlin/com/x/Cfg.kt', ['val c = System.getenv("KT_C")', 'val d = System.getenv("KT_D") ?: "x"', 'val e = System.getenv("kt_lower")']);
  assert.deepEqual(extractEnvVars(diff).map((v) => [v.name, v.hasDefault]), [['JV_A', false], ['JV_B', false], ['KT_C', false], ['KT_D', true]]);
});

test('extractEnvVars: @Value("${X}") 는 기본값 없음, ("${X:d}") 는 있음, ("${X:}") 는 없음 — 소문자 프로퍼티·#{…} 는 무시', () => {
  const diff = fileDiff('apps/workplace-api/src/main/java/com/x/Svc.java', [
    '@Value("${VAL_A}") private String a;',
    '@Value("${VAL_B:fallback}") private String b;',
    '@Value("${VAL_C:}") private String c;',
    '@Value("${app.lower.prop}") private String d;',
    '@Value("#{systemProperties[\'X\']}") private String e;',
    '@Value("${VAL_N:${VAL_INNER}}") private String f;',
    'String s = "${NOT_VALUE_ANNOTATION}";',
  ]);
  assert.deepEqual(extractEnvVars(diff).map((v) => [v.name, v.hasDefault]), [['VAL_A', false], ['VAL_B', true], ['VAL_C', false], ['VAL_INNER', false], ['VAL_N', true]]);
});

test('extractEnvVars: Kotlin 의 이스케이프 @Value("\\${X:d}") 도 읽는다', () => {
  const vars = extractEnvVars(fileDiff('apps/workplace-api/src/main/kotlin/Svc.kt', ['@Value("\\${KT_VAL}") val a: String,', '@Value("\\${KT_VAL_D:x}") val b: String,']));
  assert.deepEqual(vars.map((v) => [v.name, v.hasDefault]), [['KT_VAL', false], ['KT_VAL_D', true]]);
});

test('extractEnvVars: Java·Kotlin 도 src/test·주석 줄은 제외하고, 같은 앱 안에서 옮긴 것은 새 변수가 아니다', () => {
  const diff =
    fileDiff('apps/workplace-api/src/test/java/com/x/CfgTest.java', ['System.getenv("JV_IN_TEST");']) +
    fileDiff('apps/workplace-api/src/main/java/com/x/Doc.java', ['// System.getenv("JV_IN_COMMENT")', ' * @Value("${JV_IN_JAVADOC}")', 'System.getenv("JV_REAL");', 'System.getenv("JV_MOVED");']) +
    deletedFileDiff('apps/workplace-api/src/main/java/com/x/Old.java', ['System.getenv("JV_MOVED");']);
  assert.deepEqual(names(extractEnvVars(diff)), ['JV_REAL']);
});

// ---------- stripHelmComments · filterAlreadySet 의 주석 처리 ----------

test('stripHelmComments: 줄 전체·줄 끝 # 주석과 Go 템플릿 주석({{/* */}}, {{- /* */ -}}, 여러 줄)을 지운다', () => {
  const text = [
    '# FULL_LINE_ONLY',
    '  # INDENTED_ONLY',
    '- name: REAL_ONE',
    '  value: x   # TRAILING_ONLY',
    '{{/* GO_ONLY */}}',
    '{{- /* GO_TRIM_ONLY */ -}}',
    '{{/* MULTI_FIRST',
    '   MULTI_SECOND */}}',
    '- name: REAL_TWO',
  ].join('\n');
  const out = stripHelmComments(text);
  for (const gone of ['FULL_LINE_ONLY', 'INDENTED_ONLY', 'TRAILING_ONLY', 'GO_ONLY', 'GO_TRIM_ONLY', 'MULTI_FIRST', 'MULTI_SECOND']) assert.ok(!out.includes(gone), gone);
  assert.ok(out.includes('- name: REAL_ONE') && out.includes('- name: REAL_TWO') && out.includes('value: x'));
});

test('stripHelmComments: 따옴표 안의 #, 공백 없이 붙은 #(a#b)은 주석이 아니다', () => {
  const out = stripHelmComments('value: "keep #IN_QUOTES"\nname: \'also #SINGLE\'\nurl: a#NO_SPACE_BEFORE\nreal: 1 # drop');
  assert.ok(out.includes('#IN_QUOTES') && out.includes('#SINGLE') && out.includes('a#NO_SPACE_BEFORE'));
  assert.ok(!out.includes('drop'));
});

test('filterAlreadySet: 주석에만 나오는 변수는 설정된 것으로 치지 않는다(실제 설정과 함께 있어도)', () => {
  const vars = ['IN_HASH_COMMENT', 'IN_TRAILING', 'IN_GO_COMMENT', 'REALLY_SET'].map((name) => ({ name, hasDefault: false, file: 'a' }));
  const helm = '# IN_HASH_COMMENT\n- name: REALLY_SET # IN_TRAILING\n{{/* IN_GO_COMMENT\n */}}\n';
  assert.deepEqual(names(filterAlreadySet(vars, helmNames(helm))), ['IN_HASH_COMMENT', 'IN_TRAILING', 'IN_GO_COMMENT']);
});

// ---------- parseExistingSecretKeys · existingSecretKeys ----------

test('parseExistingSecretKeys: existingSecretKeys 블록의 `  - NAME` 줄만 읽고(주석·빈 줄 허용) 다른 키가 나오면 멈춘다', () => {
  const values = ['existingSecret: s', '# 설명', 'existingSecretKeys:', '  # 목록', '  - A_KEY', '', '  - B_KEY   # 뒤 주석', '  - c_lower_1', 'release:', '  - NOT_IN_BLOCK'].join('\n');
  assert.deepEqual(parseExistingSecretKeys(values), ['A_KEY', 'B_KEY', 'c_lower_1']);
});

test('parseExistingSecretKeys: 키가 없거나 목록이 비면 [] — 다른 곳의 `- NAME` 은 읽지 않는다', () => {
  assert.deepEqual(parseExistingSecretKeys(''), []);
  assert.deepEqual(parseExistingSecretKeys('imagePullSecrets:\n  - name: dockerhub-pull\n'), []);
  assert.deepEqual(parseExistingSecretKeys('existingSecretKeys:\nrelease:\n  version: ""\n'), []);
  assert.deepEqual(parseExistingSecretKeys('existingSecretKeys: []\n  - X\n'), []);
});

test('parseExistingSecretKeys: 실제 deploy/helm/values.yaml 의 여섯 키를 읽는다', () => {
  const real = readFileSync(join(REPO, 'deploy/helm/values.yaml'), 'utf8');
  assert.deepEqual(parseExistingSecretKeys(real), ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_MASTER_KEY', 'WORKPLACE_AI_AGENT_TOKEN', 'M365_CLIENT_SECRET', 'SSO_M365_CLIENT_SECRET']);
});

test('filterAlreadySet: existingSecretKeys 에 있는 변수는 템플릿에 이름이 없어도 이미 설정된 것으로 뺀다', () => {
  const vars = ['JWT_SECRET', 'M365_CLIENT_SECRET', 'BRAND_NEW'].map((name) => ({ name, hasDefault: false, file: 'a' }));
  assert.deepEqual(names(filterAlreadySet(vars, new Set(['JWT_SECRET', 'M365_CLIENT_SECRET']))), ['BRAND_NEW']);
});

// ---------- filterAlreadySet ----------

test('filterAlreadySet: Helm 템플릿에 이미 있는 변수는 뺀다', () => {
  const vars = [{ name: 'INTERNAL_SERVICE_TOKEN', hasDefault: false, file: 'a' }, { name: 'WORKER_BLOB_BASE', hasDefault: false, file: 'b' }, { name: 'BRAND_NEW', hasDefault: false, file: 'c' }];
  const helm = '- name: INTERNAL_SERVICE_TOKEN\n  value: x\n- name: WORKER_BLOB_BASE\n';
  assert.deepEqual(names(filterAlreadySet(vars, helmNames(helm))), ['BRAND_NEW']);
});

test('filterAlreadySet: 다른 변수 이름의 일부로만 나오면 있는 것으로 치지 않는다', () => {
  const vars = [{ name: 'API_URL', hasDefault: false, file: 'a' }];
  assert.deepEqual(names(filterAlreadySet(vars, helmNames('- name: WORKPLACE_API_URL'))), ['API_URL']);
});

test('helmNames: 식별자 토큰만 모은다 — 주석은 빠지고, 다른 이름에 붙은 조각(WORKPLACE_API_URL 속 API_URL, 숫자 뒤 ABC)은 따로 잡히지 않는다', () => {
  const names = helmNames('# ONLY_COMMENT\n- name: WORKPLACE_API_URL\n  value: 1ABC {{ .Values.x }}\n');
  assert.ok(names.has('WORKPLACE_API_URL') && names.has('1ABC') && names.has('Values'));
  for (const gone of ['ONLY_COMMENT', 'API_URL', 'ABC']) assert.ok(!names.has(gone), gone);
});

test('filterAlreadySet: 설정이 없으면 그대로', () => {
  const vars = [{ name: 'X', hasDefault: false, file: 'a' }];
  assert.deepEqual(filterAlreadySet(vars, helmNames('')), vars);
  assert.deepEqual(filterAlreadySet(vars, new Set()), vars);
});

test('filterAlreadySet: Dockerfile ENV 에 있는 TMPDIR·HOME·NODE_ENV 는 뺀다', () => {
  const dockerfile = ['FROM node', 'ENV NODE_ENV=production', 'ENV HOME=/tmp TMPDIR=/tmp PATH="/app/.venv/bin:$PATH"'].join('\n');
  const vars = ['TMPDIR', 'HOME', 'NODE_ENV', 'BRAND_NEW'].map((name) => ({ name, hasDefault: false, file: 'a' }));
  assert.deepEqual(names(filterAlreadySet(vars, dockerEnvNames(dockerfile))), ['BRAND_NEW']);
});

// ---------- dockerEnvNames ----------

test('dockerEnvNames: `ENV A=1 B="x y"`, 옛 형식 `ENV A 1`, 줄 이음, 소문자 env 를 읽고 주석·RUN·ARG 는 무시', () => {
  const text = [
    'ENV A=1 B="x y z" C=\'q r\'',
    'ENV LEGACY some value',
    'env LOWER=1',
    'ENV MULTI_1=a \\',
    '    MULTI_2=b',
    '# ENV IN_COMMENT=1',
    'ARG IN_ARG=1',
    'RUN export IN_RUN=1 && ENV=x',
    'ENV PATH="/app/.venv/bin:$PATH"',
  ].join('\n');
  assert.deepEqual([...dockerEnvNames(text)].sort(), ['A', 'B', 'C', 'LEGACY', 'LOWER', 'MULTI_1', 'MULTI_2', 'PATH']);
});

test('dockerEnvNames: ENV 가 없으면 빈 집합', () => {
  assert.equal(dockerEnvNames('FROM x\nRUN y\n').size, 0);
});

// ---------- parseMigrations ----------

test('parseMigrations: 버전 숫자순(V9 < V10)과 첫 줄 요약(-- 떼고 trim)', () => {
  const dir = 'apps/workplace-api/src/main/resources/db/migration';
  const out = parseMigrations([
    { path: `${dir}/V10__b.sql`, firstLine: '--   두 번째  ' },
    { path: `${dir}/V9__a.sql`, firstLine: '-- 첫 번째' },
    { path: `${dir}/V183__c.sql`, firstLine: 'CREATE TABLE x ();' },
  ]);
  assert.deepEqual(out, [
    { file: 'V9__a.sql', version: 9, summary: '첫 번째' },
    { file: 'V10__b.sql', version: 10, summary: '두 번째' },
    { file: 'V183__c.sql', version: 183, summary: 'CREATE TABLE x ();' },
  ]);
});

test('parseMigrations: 첫 줄이 없거나 BOM 이 붙어도 깨지지 않고, 버전 없는 파일명은 건너뛴다', () => {
  const out = parseMigrations([{ path: 'x/V1__a.sql', firstLine: '﻿-- bom' }, { path: 'x/V2__b.sql' }, { path: 'x/notes.sql', firstLine: '-- n' }]);
  assert.deepEqual(out, [{ file: 'V1__a.sql', version: 1, summary: 'bom' }, { file: 'V2__b.sql', version: 2, summary: '' }]);
});

// ---------- changedMigrationFiles ----------

test('changedMigrationFiles: 경로에서 V<숫자>__ 파일명만, 중복 제거·이름순(반복 마이그레이션 R__ 는 제외)', () => {
  const dir = 'apps/workplace-api/src/main/resources/db/migration';
  assert.deepEqual(changedMigrationFiles([`${dir}/V12__b.sql`, `${dir}/V3__a.sql`, `${dir}/R__views.sql`, `${dir}/README.md`, `${dir}/V3__a.sql`]), ['V12__b.sql', 'V3__a.sql']);
  assert.deepEqual(changedMigrationFiles([]), []);
});

// ---------- pickIssues ----------

test('pickIssues: feat/fix + (WP-n) 만, merge·chore 제외, 키마다 한 번 — 처음 그 키를 단 제목과 함께, 나온 순서', () => {
  const subjects = [
    'feat(infra): 이미지 카탈로그 (WP-440)',
    'merge: 이미지 카탈로그·버전 빌드 (WP-440)',
    'fix: 정지된 구성원 (WP-420, WP-414)',
    'chore: 정리 (WP-1)',
    'feat(web): 이슈 번호 없는 기능',
    'feat(infra): 같은 이슈 후속 (WP-440)',
    'docs: 문서 (WP-2)',
  ];
  assert.deepEqual(pickIssues(subjects), [
    { key: 'WP-440', subject: 'feat(infra): 이미지 카탈로그 (WP-440)' },
    { key: 'WP-420', subject: 'fix: 정지된 구성원 (WP-420, WP-414)' },
    { key: 'WP-414', subject: 'fix: 정지된 구성원 (WP-420, WP-414)' },
  ]);
});

test('pickIssues: 제목 하나에 키가 여럿이면 각각 센다 — 뒤 제목이 이미 나온 키는 건너뛰고 새 키만 더한다', () => {
  assert.deepEqual(pickIssues(['feat: 둘 (WP-5, WP-6)', 'fix: 셋 (WP-6, WP-7)', 'feat: 괄호 둘 (WP-8) (WP-5)']), [
    { key: 'WP-5', subject: 'feat: 둘 (WP-5, WP-6)' },
    { key: 'WP-6', subject: 'feat: 둘 (WP-5, WP-6)' },
    { key: 'WP-7', subject: 'fix: 셋 (WP-6, WP-7)' },
    { key: 'WP-8', subject: 'feat: 괄호 둘 (WP-8) (WP-5)' },
  ]);
});

test('pickIssues: feat!: · fix(api)!: 같은 호환 깨짐 표기도 고른다', () => {
  assert.deepEqual(pickIssues(['feat!: 큰 변경 (WP-5)', 'fix(api)!: 또 큰 변경 (WP-6)', 'feat-x: 아님 (WP-7)']).map((i) => i.key), ['WP-5', 'WP-6']);
});

// ---------- newApps ----------

const HELM_WITH = (id) => `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${id}\n  labels:\n`;

test('newApps: 기준 매니페스트에 없는 카탈로그 앱만, Helm 템플릿 유무를 helmMissing 으로', () => {
  const base = baseManifest();
  delete base.images.converter;
  delete base.images.db;
  const helmText = HELM_WITH('converter'); // db 는 템플릿 없음
  assert.deepEqual(newApps({ catalog, baseManifest: base, helmText }), [{ id: 'converter', helmMissing: false }, { id: 'db', helmMissing: true }]);
});

test('newApps: 기준 매니페스트가 null 이면 null(판정하지 않음)', () => {
  assert.equal(newApps({ catalog, baseManifest: null, helmText: '' }), null);
});

test('newApps: 새 앱이 없으면 빈 배열', () => {
  assert.deepEqual(newApps({ catalog, baseManifest: baseManifest(), helmText: '' }), []);
});

test('newApps: StatefulSet 도 인정하고, Service·컨테이너 이름만 같은 것은 템플릿으로 치지 않는다', () => {
  const base = baseManifest();
  delete base.images.db;
  delete base.images.converter;
  const onlyService = 'kind: Service\nmetadata:\n  name: converter\n';
  const containerOnly = 'kind: Deployment\nmetadata:\n  name: other\nspec:\n  containers:\n    - name: converter\n';
  const sts = 'apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: db\n';
  assert.deepEqual(newApps({ catalog, baseManifest: base, helmText: `${onlyService}\n${containerOnly}\n${sts}` }), [{ id: 'converter', helmMissing: true }, { id: 'db', helmMissing: false }]);
});

test('newApps: id 가 다른 이름의 앞부분이어도(api ↔ api-gateway) 템플릿으로 치지 않는다', () => {
  const base = baseManifest();
  delete base.images.api;
  assert.deepEqual(newApps({ catalog, baseManifest: base, helmText: HELM_WITH('api-gateway') }), [{ id: 'api', helmMissing: true }]);
});

test('newApps: 주석 처리된 워크로드는 템플릿으로 치지 않는다', () => {
  const base = baseManifest();
  delete base.images.converter;
  const commented = '{{/*\nkind: Deployment\nmetadata:\n  name: converter\n*/}}\n';
  assert.deepEqual(newApps({ catalog, baseManifest: base, helmText: commented }), [{ id: 'converter', helmMissing: true }]);
});

// ---------- renderChecklist ----------

const emptyInput = { from: 'v0.8.0', to: 'HEAD', newApps: [], envVars: [], migrations: { added: [], changed: [] }, helmChanges: [], manifest: null, issues: [] };
const HEADINGS = ['## ⚠ 새 앱', '## ⚠ Helm 에 없는 새 환경변수', '## ⚠ DB 마이그레이션', '## ⚠ Helm 차트 변경', '## 이미지', '## 포함 이슈'];

test('renderChecklist: 머리 제목과 섹션 제목이 정해진 순서로 나온다', () => {
  const md = renderChecklist(emptyInput);
  assert.ok(md.startsWith('# 배포 체크리스트 v0.8.0 → HEAD\n'));
  const positions = HEADINGS.map((h) => md.indexOf(`\n${h}\n`));
  assert.ok(positions.every((p) => p >= 0), `제목 누락: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('renderChecklist: 해당 없는 ⚠ 섹션은 「없음」 한 줄이고 마이그레이션 경고는 없다', () => {
  const md = renderChecklist(emptyInput);
  for (const h of HEADINGS.slice(0, 4)) assert.match(md, new RegExp(`${h}\\n\\n없음\\n`));
  assert.match(md, /## 이미지\n\n매니페스트 없음\n/);
  assert.match(md, /## 포함 이슈\n\n없음\n/);
  assert.ok(!md.includes('helm rollback'));
});

test('renderChecklist: 새 앱 판정 불가(null)는 안내 문구, Helm 템플릿 없는 앱은 표시', () => {
  assert.match(renderChecklist({ ...emptyInput, newApps: null }), /## ⚠ 새 앱\n\n기준 매니페스트 없음 — 판정하지 않음\n/);
  const md = renderChecklist({ ...emptyInput, newApps: [{ id: 'converter', helmMissing: true }, { id: 'db', helmMissing: false }] });
  assert.match(md, /- `converter` — Helm 템플릿 없음\n/);
  assert.match(md, /- `db`\n/);
});

test('renderChecklist: 환경변수 줄은 이름·기본값 있음/없음·파일을 적는다', () => {
  const md = renderChecklist({ ...emptyInput, envVars: [{ name: 'A_VAR', hasDefault: false, file: 'apps/a.ts' }, { name: 'B_VAR', hasDefault: true, file: 'apps/b.py' }] });
  assert.match(md, /- `A_VAR` — 기본값 없음 \(`apps\/a\.ts`\)\n/);
  assert.match(md, /- `B_VAR` — 기본값 있음 \(`apps\/b\.py`\)\n/);
});

test('renderChecklist: envNote 가 있으면 환경변수 섹션 머리에 한 줄 안내', () => {
  const md = renderChecklist({ ...emptyInput, envNote: '이 지점에는 deploy/helm 차트가 없어 Helm 비교를 하지 않았다', envVars: [{ name: 'A_VAR', hasDefault: false, file: 'a.ts' }] });
  assert.match(md, /## ⚠ Helm 에 없는 새 환경변수\n\n이 지점에는 deploy\/helm 차트가 없어 Helm 비교를 하지 않았다\n\n- `A_VAR`/);
});

test('renderChecklist: 마이그레이션이 있으면 목록과 롤백 경고', () => {
  const md = renderChecklist({ ...emptyInput, migrations: { added: [{ file: 'V183__x.sql', version: 183, summary: '첨부 테이블' }], changed: [] } });
  assert.match(md, /- `V183__x\.sql` — 첨부 테이블\n/);
  assert.ok(md.includes('> 롤백(helm rollback)해도 DB 스키마는 되돌아가지 않는다.'));
  // 경고는 마이그레이션 섹션 안에 있다.
  assert.ok(md.indexOf('helm rollback') > md.indexOf('## ⚠ DB 마이그레이션') && md.indexOf('helm rollback') < md.indexOf('## ⚠ Helm 차트 변경'));
});

test('renderChecklist: Helm 차트 변경 파일 목록', () => {
  const md = renderChecklist({ ...emptyInput, helmChanges: ['deploy/helm/templates/api-deployment.yaml', 'deploy/helm/values.yaml'] });
  assert.match(md, /## ⚠ Helm 차트 변경\n\n- `deploy\/helm\/templates\/api-deployment\.yaml`\n- `deploy\/helm\/values\.yaml`\n/);
});

test('renderChecklist: 이미지 표는 빌드/승계·사유·digest 앞 19자·원 빌드 버전', () => {
  const manifest = {
    images: {
      api: { digest: `sha256:${'a'.repeat(64)}`, action: 'build', reasons: ['path:apps/workplace-api/', 'workspace:packages/x'], builtVersion: '0.9.0' },
      web: { digest: `sha256:${'b'.repeat(64)}`, action: 'carry', reasons: [], builtVersion: '0.8.0' },
    },
  };
  const md = renderChecklist({ ...emptyInput, manifest });
  assert.match(md, /\| 앱 \| 빌드\/승계 \| 사유 \| digest \| 원 빌드 버전 \|\n\| --- \| --- \| --- \| --- \| --- \|\n/);
  assert.match(md, new RegExp(`\\| api \\| 빌드 \\| path:apps/workplace-api/, workspace:packages/x \\| sha256:${'a'.repeat(12)} \\| 0\\.9\\.0 \\|\\n`));
  assert.match(md, new RegExp(`\\| web \\| 승계 \\| - \\| sha256:${'b'.repeat(12)} \\| 0\\.8\\.0 \\|\\n`));
  assert.ok(!md.includes('a'.repeat(13)), 'digest 는 앞 19자만');
});

test('renderChecklist: 포함 이슈는 `WP-n — 제목` 한 줄씩', () => {
  const md = renderChecklist({ ...emptyInput, issues: [{ key: 'WP-1', subject: 'feat: 하나 (WP-1)' }, { key: 'WP-2', subject: 'fix: 둘 (WP-2)' }] });
  assert.match(md, /## 포함 이슈\n\n- WP-1 — feat: 하나 \(WP-1\)\n- WP-2 — fix: 둘 \(WP-2\)\n/);
});

test('renderChecklist: 새 앱을 판정하지 못한 이유(appsNote)가 있으면 그 안내를, 기준 매니페스트가 없으면 기존 안내를 쓴다', () => {
  assert.match(renderChecklist({ ...emptyInput, newApps: null, appsNote: '이 지점에는 deploy/release/image-catalog.json 이 없어 새 앱을 판정하지 않았다' }), /## ⚠ 새 앱\n\n이 지점에는 deploy\/release\/image-catalog\.json 이 없어 새 앱을 판정하지 않았다\n/);
  assert.match(renderChecklist({ ...emptyInput, newApps: null }), /## ⚠ 새 앱\n\n기준 매니페스트 없음 — 판정하지 않음\n/);
});

test('renderChecklist: 이미지 표 셀의 `|` 는 `\\|` 로 이스케이프한다(사유 등에 들어 있어도 열이 늘지 않는다)', () => {
  const manifest = { images: { 'a|b': { digest: `sha256:${'a'.repeat(64)}`, action: 'build', reasons: ['x|y', 'z'], builtVersion: '0.9.0|rc' } } };
  const md = renderChecklist({ ...emptyInput, manifest });
  assert.ok(md.includes('| a\\|b | 빌드 | x\\|y, z | sha256:aaaaaaaaaaaa | 0.9.0\\|rc |\n'), md);
});

test('renderChecklist: 매니페스트 모양이 틀리면 앱 id 와 필드를 담아 throw 한다 — images 가 객체 아님·항목 누락/타입 오류', () => {
  const ok = { digest: `sha256:${'a'.repeat(64)}`, action: 'build', reasons: [], builtVersion: '0.9.0' };
  const render = (manifest) => renderChecklist({ ...emptyInput, manifest });
  assert.throws(() => render({}), /images 가 객체가 아니다/);
  assert.throws(() => render({ images: [] }), /images 가 객체가 아니다/);
  assert.throws(() => render({ images: { api: 'x' } }), /images\.api 가 객체가 아니다/);
  assert.throws(() => render({ images: { good: ok, web: { ...ok, action: undefined } } }), /images\.web\.action/);
  assert.throws(() => render({ images: { api: { ...ok, reasons: 'path:x' } } }), /images\.api\.reasons 가 배열이 아니다/);
  assert.throws(() => render({ images: { db: { ...ok, digest: 123 } } }), /images\.db\.digest/);
  assert.throws(() => render({ images: { db: { ...ok, builtVersion: null } } }), /images\.db\.builtVersion/);
  assert.doesNotThrow(() => render({ images: { api: ok } }));
});

test('renderChecklist: 결과는 줄바꿈으로 끝난다', () => {
  assert.ok(renderChecklist(emptyInput).endsWith('\n'));
});

test('renderChecklist: 기존 마이그레이션 수정/삭제는 Flyway checksum 경고 한 줄 — 새 마이그레이션과 함께면 목록 뒤에', () => {
  const md = renderChecklist({ ...emptyInput, migrations: { added: [{ file: 'V190__n.sql', version: 190, summary: '새것' }], changed: ['V12__a.sql', 'V30__b.sql'] } });
  assert.match(md, /- `V190__n\.sql` — 새것\n- ⚠ 기존 마이그레이션 수정\/삭제 — 운영 api 기동 실패\(Flyway checksum\) 위험: `V12__a\.sql`, `V30__b\.sql`\n/);
  assert.ok(md.includes('> 롤백(helm rollback)해도 DB 스키마는 되돌아가지 않는다.'));
});

test('renderChecklist: 새 마이그레이션이 없어도 수정/삭제가 있으면 마이그레이션 섹션은 「없음」이 아니다(롤백 경고는 없음)', () => {
  const md = renderChecklist({ ...emptyInput, migrations: { added: [], changed: ['V12__a.sql'] } });
  assert.match(md, /## ⚠ DB 마이그레이션\n\n- ⚠ 기존 마이그레이션 수정\/삭제 — 운영 api 기동 실패\(Flyway checksum\) 위험: `V12__a\.sql`\n\n## ⚠ Helm 차트 변경/);
  assert.ok(!md.includes('helm rollback'));
});
