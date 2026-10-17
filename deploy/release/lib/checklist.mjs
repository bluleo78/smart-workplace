// 배포 체크리스트 순수 함수 (WP-441) — 두 git 지점 사이에서 「배포 전 확인할 것」을 뽑고 마크다운으로 만든다.
// git·파일시스템·네트워크에 접근하지 않는다: 호출자(CLI)가 diff 텍스트·파일 목록·커밋 제목·매니페스트를 모아 넘기고,
// 여기서는 같은 입력이면 항상 같은 결과를 내서 합성 데이터만으로 모든 규칙을 테스트한다.
import { posix } from 'node:path';
import { cmp, isPlainObject } from './catalog.mjs';

const VAR = '[A-Z][A-Z0-9_]*';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byName = (a, b) => cmp(a.name, b.name);

/** 운영 코드가 아닌 경로(테스트·평가·보조 스크립트·도구 설정) — 하나라도 걸리면 대상 아님. 디렉터리는 조각 전체가 같아야 한다(`latest/` 같은 일부 일치는 아님). */
const EXCLUDE = [
  /\/(?:eval|scripts|test|tests|e2e|__tests__)\//,
  /\.(?:test|spec)\.[^/]*$/,
  /(?:^|\/)conftest\.py$/,
  /\.config\.(?:ts|mts|js|mjs)$/,
];
/** 파일 종류 — 앞에서부터 처음 맞는 것. yml 은 운영 프로파일(application·application-prod)만 읽힌다. */
const KINDS = [
  ['yml', /(?:^|\/)application(?:-prod)?\.ya?ml$/],
  ['py', /\.py$/],
  ['node', /\.(?:ts|mts|js|mjs)$/],
  ['jvm', /\.(?:java|kt)$/],
];

/** `apps/` 아래 운영 코드·설정의 종류('yml'·'py'·'node'·'jvm'), 대상이 아니면 null — 앱이 실제로 읽는 환경변수만 뽑으려는 범위 제한(셸·Dockerfile·문서의 `${TARGETARCH}` 같은 빌드 변수가 새지 않게). */
function fileKind(path) {
  if (!path.startsWith('apps/') || EXCLUDE.some((re) => re.test(path))) return null;
  return KINDS.find(([, re]) => re.test(path))?.[0] ?? null;
}

/**
 * Spring 플레이스홀더 `${VAR}`(기본값 없음) · `${VAR:기본값}`(있음) · `${VAR:}`(빈 기본값 → 없음)를 한 줄에서 모두 뽑는다 — yml 과 `@Value` 가 같은 문법.
 * 뒤가 `}` 나 `:` 가 아니면(소문자 이어짐 등) 변수가 아니다. 중첩 기본값 `${A:${B}}` 은 A·B 둘 다 나온다.
 */
function placeholderVars(line) {
  return [...line.matchAll(new RegExp(`\\$\\{(${VAR})(?=[}:])(:?)(\\}?)`, 'g'))].map((m) => ({ name: m[1], hasDefault: m[2] === ':' && m[3] === '' }));
}

// 같은 줄에서 읽기 바로 뒤에 대체값 연산자가 이어지면 기본값이 있는 것: Node `??`·`||`, Kotlin 엘비스 `?:`, 파이썬 `) or`(rest 는 호출의 `)` 부터).
const NODE_DEFAULT = /^\s*(?:\?\?|\|\|)/;
const KOTLIN_DEFAULT = /^\s*\?:/;
const PY_DEFAULT = /^\s*\)\s*or\b/;
const afterMatch = (line, m) => line.slice(m.index + m[0].length);
/** re 로 찾은 읽기마다 `{ name: m[nameGroup], hasDefault }` — 대체값 연산자(defaultOp)가 바로 이어지면 기본값 있음. */
const readsWith = (line, re, nameGroup, defaultOp) => [...line.matchAll(re)].map((m) => ({ name: m[nameGroup], hasDefault: defaultOp.test(afterMatch(line, m)) }));

const NODE_DOT = new RegExp(`\\bprocess\\.env\\.(${VAR})(?![A-Za-z0-9_])`, 'g');
const NODE_INDEX = new RegExp(`\\bprocess\\.env\\[\\s*(["'])(${VAR})\\1\\s*\\]`, 'g');
const JVM_GETENV = new RegExp(`\\bSystem\\.getenv\\(\\s*"(${VAR})"\\s*\\)`, 'g'); // 인자 하나뿐이라 기본값이 없다(엘비스가 이어지면 있음).
const PY_GETENV = new RegExp(`\\bos\\.(?:getenv|environ\\.get)\\(\\s*(["'])(${VAR})\\1\\s*(,?)`, 'g');
const PY_INDEX = new RegExp(`\\bos\\.environ\\[\\s*(["'])(${VAR})\\1\\s*\\]`, 'g'); // 없으면 KeyError — 기본값 없음.

/** 파이썬: getenv("V") / environ.get("V") — 쉼표가 이어지면 두 번째 인자가 기본값(빈 문자열·None 이면 없음), 그 뒤에 `) or x` 가 이어지면 그쪽이 기본값. */
function pythonVars(line) {
  const found = [];
  for (const m of line.matchAll(PY_GETENV)) {
    const rest = afterMatch(line, m);
    let hasDefault;
    if (m[3] === ',') {
      const empty = /^\s*(?:""|''|None)\s*(?=\))/.exec(rest);
      hasDefault = empty === null || PY_DEFAULT.test(rest.slice(empty[0].length));
    } else {
      hasDefault = PY_DEFAULT.test(rest);
    }
    found.push({ name: m[2], hasDefault });
  }
  for (const m of line.matchAll(PY_INDEX)) found.push({ name: m[2], hasDefault: false });
  return found;
}

/** 자바·코틀린: `System.getenv("X")` 와 `@Value("${X}")`(플레이스홀더 규칙은 yml 과 같고, 코틀린의 `\${X}` 이스케이프도 `$` 부터 읽힌다). */
function jvmVars(line) {
  const at = line.search(/@Value\s*\(/);
  return [...readsWith(line, JVM_GETENV, 1, KOTLIN_DEFAULT), ...(at >= 0 ? placeholderVars(line.slice(at)) : [])];
}

/**
 * 파일 종류별 줄 규칙. comment: 주석만 있는 줄(예시 코드가 환경변수로 잡히지 않게 — 줄 끝 주석·문서 문자열은 구분하지 않는다).
 * scan(line): 한 줄의 환경변수 → `{ name, hasDefault }[]`. hasDefault=false 는 「기본값 없음」 — 배포 설정에 없으면 앱이 기동·동작에 실패할 수 있는 것.
 * 빈 리터럴 기본값(`${X:}`, `getenv("X", "")`)은 값을 주지 않은 것과 같아 기본값 없음으로 센다.
 */
const SCANNERS = {
  yml: { comment: /^\s*#/, scan: placeholderVars },
  py: { comment: /^\s*#/, scan: pythonVars },
  node: { comment: /^\s*(?:\/\/|\/\*|\*)/, scan: (line) => [...readsWith(line, NODE_DOT, 1, NODE_DEFAULT), ...readsWith(line, NODE_INDEX, 2, NODE_DEFAULT)] },
  jvm: { comment: /^\s*(?:\/\/|\/\*|\*)/, scan: jvmVars },
};

/** 앱 디렉터리(`apps/<이름>`) — 같은 앱 안에서 옮긴 변수를 가려내는 단위. 호출 전에 `apps/` 아래 경로임이 확인된 경우만 쓴다. */
const appDirOf = (path) => path.split('/').slice(0, 2).join('/');

/**
 * `git diff -U0 --no-renames <from> <to> -- apps/` 출력 전체에서 새로 쓰인 환경변수를 뽑는다 → `{ name, hasDefault, file }[]`.
 * 추가된 줄(`+`)을 변수로 모으되, 같은 앱(`apps/<이름>/`) 어디서든 삭제 줄(`-`)에도 있던 이름은 새 변수가 아니다 —
 * 같은 파일 안에서 고친 것이든 같은 앱의 다른 파일로 옮긴 것이든 설정은 그대로다. 삭제된 파일(`+++ /dev/null`)의 줄도 삭제 줄로 센다(경로는 `--- a/<경로>` 에서).
 * 앱이 다르면 가리지 않는다: 새 앱은 옛 앱과 별개로 자기 설정이 필요하다.
 * 같은 변수가 여러 곳이면 하나로 합친다: 하나라도 기본값이 없으면 기본값 없음이고 파일은 기본값 없는 처음 곳, 아니면 처음 나온 곳. 이름순 정렬.
 *
 * 헤더/본문 구분: `diff --git` 직후부터 첫 `@@` 전까지가 헤더다. 헤더에서만 `--- `·`+++ ` 를 파일 표지로 읽고,
 * `@@` 뒤에서는 `+++x`(내용이 `++x` 인 추가 줄)도 추가 줄로 센다.
 */
export function extractEnvVars(diffText) {
  const added = []; // { name, hasDefault, file, app }
  const removedByApp = new Map(); // 앱 디렉터리 → 삭제 줄에 있던 변수 이름 집합
  let kind = null;
  let file = null; // 추가 줄이 속한 새 경로 (삭제된 파일이면 null)
  let app = null;
  let oldPath = null; // `--- a/<경로>` — 삭제된 파일의 경로를 알려 준다
  let inHeader = false;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      kind = null;
      file = null;
      app = null;
      oldPath = null;
      inHeader = true;
    } else if (inHeader && line.startsWith('--- ')) {
      const m = /^--- a\/(.*?)(?:\t.*)?$/.exec(line);
      oldPath = m ? m[1] : null; // '--- /dev/null' (새 파일) → 삭제 줄이 없다
    } else if (inHeader && line.startsWith('+++ ')) {
      const m = /^\+\+\+ b\/(.*?)(?:\t.*)?$/.exec(line);
      file = m ? m[1] : null; // '+++ /dev/null' (삭제) → 추가 줄이 없고, 삭제 줄은 옛 경로로 판정
      const path = file ?? oldPath;
      kind = path === null ? null : fileKind(path);
      app = kind === null ? null : appDirOf(path);
    } else if (line.startsWith('@@')) {
      inHeader = false;
    } else if (kind !== null && (line.startsWith('+') || line.startsWith('-'))) {
      const body = line.slice(1);
      const { comment, scan } = SCANNERS[kind];
      if (comment.test(body)) continue;
      for (const v of scan(body)) {
        if (line.startsWith('+')) {
          if (file !== null) added.push({ ...v, file, app });
        } else {
          if (!removedByApp.has(app)) removedByApp.set(app, new Set());
          removedByApp.get(app).add(v.name);
        }
      }
    }
  }
  // 삭제 줄은 diff 의 뒤쪽 파일에 있을 수도 있으니, 전부 읽은 뒤에 가린다.
  const merged = new Map();
  for (const { name, hasDefault, file: f, app: a } of added) {
    if (removedByApp.get(a)?.has(name)) continue;
    const prev = merged.get(name);
    if (prev === undefined) merged.set(name, { name, hasDefault, file: f });
    else if (prev.hasDefault && !hasDefault) {
      prev.hasDefault = false;
      prev.file = f;
    }
  }
  return [...merged.values()].sort(byName);
}

/**
 * Dockerfile 본문에서 `ENV` 로 이미 정해 둔 변수 이름 집합. `ENV A=1 B="x y"` 와 옛 형식 `ENV A 1` 둘 다 읽고, `\` 줄 이음도 편다.
 * 이미지에 구워 둔 값은 배포 때 따로 챙길 설정이 아니므로 Helm 에 있는 것과 같이 취급한다.
 */
export function dockerEnvNames(dockerfileText) {
  const names = new Set();
  const pair = /\s*([A-Za-z_][A-Za-z0-9_]*)=(?:"(?:[^"\\]|\\.)*"|'[^']*'|(?:\\.|[^\s\\])*)/y;
  for (const raw of dockerfileText.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const m = /^\s*ENV\s+(.*)$/i.exec(raw);
    if (m === null) continue;
    const rest = m[1];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
      pair.lastIndex = 0;
      for (let p = pair.exec(rest); p !== null; p = pair.exec(rest)) names.add(p[1]);
    } else {
      const legacy = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)/.exec(rest);
      if (legacy !== null) names.add(legacy[1]);
    }
  }
  return names;
}

// Helm 템플릿에서 주석(Go `{{/* … */}}`·`{{- /* … */ -}}` 여러 줄 포함, 공백 앞 `#` 부터 줄 끝)을 지운다 — 주석에 적힌 변수 이름이 「설정돼 있음」으로 읽히지 않게.
// 따옴표 안의 `#` 은 주석이 아니고, 판단이 애매하면(짝 안 맞는 따옴표 등) 지우지 않는다 — 주석을 못 지우는 쪽이 변수를 잘못 숨기는 쪽보다 안전하다.
export function stripHelmComments(text) {
  return text.replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, '').split('\n').map(stripLineComment).join('\n');
}

/** 한 줄에서 따옴표 밖의 `#`(줄 머리 또는 공백 바로 뒤)부터 끝까지 지운다. */
function stripLineComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === '\\' && quote === '"') i += 1; // 이스케이프된 문자는 건너뛴다
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * values.yaml 의 `existingSecretKeys:` 블록 목록(`  - NAME` 줄들)에서 키 이름을 읽는다 → string[]. 목록이 없으면 [].
 * YAML 전체를 해석하지 않는 작은 파서다: 키 줄 다음부터 빈 줄·주석 줄·`- NAME`(뒤에 `# 주석` 가능)만 읽고 그 밖의 줄이 나오면 끝낸다.
 */
export function parseExistingSecretKeys(valuesText) {
  const names = [];
  let inBlock = false;
  for (const line of valuesText.split(/\r?\n/)) {
    if (!inBlock) {
      inBlock = /^existingSecretKeys:[ \t]*(?:#.*)?$/.test(line);
      continue;
    }
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const m = /^[ \t]*-[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:#.*)?$/.exec(line);
    if (m === null) break;
    names.push(m[1]);
  }
  return names;
}

/**
 * Helm 템플릿(주석 제외)에 나오는 식별자 토큰 집합 — 「이미 설정됨」 이름 후보.
 * 토큰은 `[A-Za-z0-9_]` 의 최대 연속이라 다른 이름의 일부(`WORKPLACE_API_URL` 속 `API_URL`)는 따로 잡히지 않는다.
 */
export function helmNames(helmText) {
  return new Set(stripHelmComments(helmText).match(/[A-Za-z0-9_]+/g) ?? []);
}

/** 이미 배포 설정에 있는 변수는 뺀다(새로 챙길 것이 아니다). names: 설정된 이름 집합 — Helm 템플릿(`helmNames`) · 이미지 Dockerfile ENV(`dockerEnvNames`) · 클러스터 Secret 키(`existingSecretKeys`)의 합집합. */
export function filterAlreadySet(vars, names) {
  return vars.filter((v) => !names.has(v.name));
}

/**
 * 추가된 마이그레이션 `{ path, firstLine }[]` → `{ file, version, summary }[]`, 버전 숫자순(V9 < V10).
 * summary 는 첫 줄에서 BOM·앞의 `--` 를 떼고 trim 한 것. `V<숫자>__` 형식이 아닌 파일명은 버전을 알 수 없어 건너뛴다.
 */
export function parseMigrations(entries) {
  const out = [];
  for (const { path, firstLine } of entries) {
    const file = posix.basename(path);
    const m = /^V(\d+)__/.exec(file);
    if (m === null) continue;
    out.push({ file, version: Number(m[1]), summary: (firstLine ?? '').replace(/^﻿/, '').replace(/^\s*--/, '').trim() });
  }
  return out.sort((a, b) => a.version - b.version || cmp(a.file, b.file));
}

/**
 * 이미 있던 마이그레이션이 수정·삭제된 파일 경로 목록 → 파일명(`V<숫자>__…`만) 이름순.
 * Flyway 는 적용된 마이그레이션의 checksum 을 검증하므로 내용이 바뀌거나 사라지면 운영 api 가 기동하지 못한다. 반복 마이그레이션(`R__`) 등 버전 없는 파일은 대상이 아니다.
 */
export function changedMigrationFiles(paths) {
  return [...new Set(paths.map((p) => posix.basename(p)).filter((f) => /^V\d+__/.test(f)))].sort();
}

/**
 * 커밋 제목에서 포함 이슈를 이슈 키 단위로 모은다 → `{ key, subject }[]`.
 * 대상 제목: `feat|fix[(scope)][!]:` 이고 `(WP-n…)` 가 있는 것 — 머지(`merge:`)·chore 등은 제외.
 * 키는 `(WP-420, WP-414)` 처럼 제목 하나에 여럿일 수 있고 각각 따로 센다. 같은 키는 한 번만, 처음 나온 순서로, 그 키를 처음 단 제목과 함께.
 */
export function pickIssues(subjects) {
  const seen = new Map();
  for (const subject of subjects) {
    if (!/^(feat|fix)(\([^)]*\))?!?:/.test(subject)) continue;
    for (const group of subject.matchAll(/\((WP-\d+\b[^)]*)\)/g)) {
      for (const [key] of group[1].matchAll(/WP-\d+/g)) if (!seen.has(key)) seen.set(key, subject);
    }
  }
  return [...seen].map(([key, subject]) => ({ key, subject }));
}

/**
 * Helm 템플릿에 해당 앱의 Deployment/StatefulSet 이 있는가 — `kind: Deployment|StatefulSet` 바로 뒤 `metadata.name` 이 id 와 같은 것.
 * 컨테이너 이름(`- name: x`)이나 Service 의 이름만 같은 경우는 워크로드가 아니므로 치지 않는다.
 */
function hasWorkload(helmText, id) {
  return new RegExp(`^kind:[ \\t]*(?:Deployment|StatefulSet)[ \\t]*\\r?\\n[ \\t]*metadata:[ \\t]*\\r?\\n[ \\t]+name:[ \\t]*${escapeRe(id)}[ \\t]*$`, 'm').test(helmText);
}

/**
 * 새 앱 = 카탈로그에는 있고 기준 매니페스트 images 에는 없는 것(운영에 아직 없는 이미지). 기준 매니페스트가 없으면 판정 불가 → null.
 * helmMissing: 배포 차트에 그 앱의 워크로드가 없다 — 이미지만 만들어 봐야 운영에 뜨지 않으므로 별도로 알린다.
 */
export function newApps({ catalog, baseManifest, helmText }) {
  if (baseManifest === null) return null;
  const helmCode = stripHelmComments(helmText); // 주석 처리된 워크로드는 없는 것
  return catalog.images.filter(({ id }) => baseManifest.images?.[id] === undefined).map(({ id }) => ({ id, helmMissing: !hasWorkload(helmCode, id) }));
}

const NONE = '없음';
const ROLLBACK_WARNING = '> 롤백(helm rollback)해도 DB 스키마는 되돌아가지 않는다.';
const ACTION_LABEL = { build: '빌드', carry: '승계' };

/** 불릿 목록 문자열(줄마다 `- `). 비어 있으면 「없음」. */
const bullets = (lines) => (lines.length > 0 ? lines.map((l) => `- ${l}`).join('\n') : NONE);

/** 마크다운 표 셀 값 — `|` 는 열 구분으로 읽히지 않게 `\|` 로 이스케이프한다. */
const cell = (value) => String(value).replace(/\|/g, '\\|');

/**
 * 이미지 표를 그리기 전에 매니페스트 모양을 확인한다 — 손으로 고친/깨진 파일이 `undefined.slice` 같은 알 수 없는 오류로 죽지 않고 어느 앱의 무엇이 틀렸는지 알려 주게.
 * 확인: images 가 객체, 각 항목이 객체이고 action(문자열)·reasons(배열)·digest(문자열)·builtVersion(문자열).
 */
function assertRenderableManifest(manifest) {
  if (!isPlainObject(manifest?.images)) throw new Error('매니페스트 images 가 객체가 아니다');
  for (const [id, img] of Object.entries(manifest.images)) {
    if (!isPlainObject(img)) throw new Error(`매니페스트 images.${id} 가 객체가 아니다`);
    for (const key of ['action', 'digest', 'builtVersion']) {
      if (typeof img[key] !== 'string') throw new Error(`매니페스트 images.${id}.${key} 가 문자열이 아니다 (${JSON.stringify(img[key])})`);
    }
    if (!Array.isArray(img.reasons)) throw new Error(`매니페스트 images.${id}.reasons 가 배열이 아니다 (${JSON.stringify(img.reasons)})`);
  }
}

/**
 * 체크리스트 마크다운을 만든다. 섹션 순서·제목은 고정이고, 해당 없는 섹션은 「없음」 한 줄.
 * issues: `pickIssues` 결과(`{ key, subject }[]`) — `WP-n — 제목` 한 줄씩.
 * migrations: `{ added, changed }` — added 는 `parseMigrations` 결과, changed 는 `changedMigrationFiles` 결과(새 마이그레이션이 없어도 보여 준다).
 * envNote(선택): 환경변수 섹션 머리에 덧붙일 안내(예: Helm 비교를 건너뛴 이유). appsNote(선택): newApps 가 null 일 때 새 앱 섹션에 쓸 안내(기본은 기준 매니페스트 없음).
 * manifest 의 모양이 틀리면 throw(어느 앱의 무엇인지 담아).
 */
export function renderChecklist({ from, to, newApps: apps, envVars, migrations, helmChanges, manifest, issues, envNote = null, appsNote = null }) {
  const appLines = apps === null ? (appsNote ?? '기준 매니페스트 없음 — 판정하지 않음') : bullets(apps.map(({ id, helmMissing }) => `\`${id}\`${helmMissing ? ' — Helm 템플릿 없음' : ''}`));
  const envLines = bullets(envVars.map(({ name, hasDefault, file }) => `\`${name}\` — ${hasDefault ? '기본값 있음' : '기본값 없음'} (\`${file}\`)`));
  const envBody = envNote === null ? envLines : `${envNote}\n\n${envLines}`;
  // 기존 마이그레이션의 수정/삭제는 새 마이그레이션이 없어도 보여 준다 — 운영 api 가 기동하지 못하는 더 위험한 경우.
  const { added, changed } = migrations;
  const migrationLines = [
    ...added.map(({ file, summary }) => `\`${file}\` — ${summary}`),
    ...(changed.length > 0 ? [`⚠ 기존 마이그레이션 수정/삭제 — 운영 api 기동 실패(Flyway checksum) 위험: ${changed.map((f) => `\`${f}\``).join(', ')}`] : []),
  ];
  const migrationBody = migrationLines.length > 0 ? `${bullets(migrationLines)}${added.length > 0 ? `\n\n${ROLLBACK_WARNING}` : ''}` : NONE;
  let imageBody = '매니페스트 없음';
  if (manifest !== null && manifest !== undefined) {
    assertRenderableManifest(manifest);
    imageBody = [
      '| 앱 | 빌드/승계 | 사유 | digest | 원 빌드 버전 |',
      '| --- | --- | --- | --- | --- |',
      ...Object.entries(manifest.images).map(
        ([id, img]) => `| ${cell(id)} | ${cell(ACTION_LABEL[img.action] ?? img.action)} | ${img.reasons.length > 0 ? cell(img.reasons.join(', ')) : '-'} | ${cell(img.digest.slice(0, 19))} | ${cell(img.builtVersion)} |`,
      ),
    ].join('\n');
  }
  const sections = [
    ['## ⚠ 새 앱', appLines],
    ['## ⚠ Helm 에 없는 새 환경변수', envBody],
    ['## ⚠ DB 마이그레이션', migrationBody],
    ['## ⚠ Helm 차트 변경', bullets(helmChanges.map((f) => `\`${f}\``))],
    ['## 이미지', imageBody],
    ['## 포함 이슈', bullets(issues.map(({ key, subject }) => `${key} — ${subject}`))],
  ];
  return `# 배포 체크리스트 ${from} → ${to}\n\n${sections.map(([title, body]) => `${title}\n\n${body}\n`).join('\n')}`;
}
