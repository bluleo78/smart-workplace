// 릴리스 반영·롤백·상태 확인의 순수 함수 (WP-443) — helm·kubectl·네트워크에 접근하지 않는다.
// 호출자(CLI)가 매니페스트·`helm get values/history` 결과·파드 JSON·HTTP 응답 본문을 모아 넘기고, 여기서는 같은 입력이면 항상 같은 결과를 낸다.
import { DIGEST_RE } from './build.mjs';
import { isPlainObject } from './catalog.mjs';

/**
 * imageID 끝의 digest — `repo@sha256:…`, `docker-pullable://repo@sha256:…`, 접두 없는 `sha256:…`, `docker://sha256:…` 모두 `sha256:<64hex>` 로 끝난다.
 * digest 모양은 DIGEST_RE 한 곳에서 정한다 — 앵커(`^…$`)를 떼고 끼운다.
 */
const IMAGE_ID_DIGEST = new RegExp(`(?:^|[@/])(${DIGEST_RE.source.slice(1, -1)})$`);
/** 앱 id → 파드 컨테이너 이름. 차트에서 컨테이너 이름은 id 와 같고 db 만 `postgres`. */
const containerName = (id) => (id === 'db' ? 'postgres' : id);
const nonEmptyString = (v) => typeof v === 'string' && v !== '';

/**
 * 매니페스트 → `helm upgrade -f` 로 넘길 값(JSON 으로 써도 helm 이 읽는다).
 * images 는 repository·digest 만 — action·reasons 같은 빌드 메타는 차트가 쓰지 않는다. release 는 「지금 운영 릴리스」 표식(`helm get values` 로 되읽는다).
 */
export function imageValues(manifest) {
  const images = {};
  for (const [id, img] of Object.entries(manifest.images)) images[id] = { repository: img.repository, digest: img.digest };
  return { images, release: { version: manifest.version, commit: manifest.commit } };
}

/**
 * `helm get values -o json` 결과 → 지금 운영 릴리스 `{ version, commit }`. release.version 이 없으면(전환 전 리비전) null.
 * 비밀값이 섞인 values 전체가 아니라 `release` 키만 꺼내므로 결과를 로그에 남겨도 안전하다.
 */
export function currentRelease(valuesJson) {
  const release = isPlainObject(valuesJson) ? valuesJson.release : undefined;
  if (!isPlainObject(release) || !nonEmptyString(release.version)) return null;
  return { version: release.version, commit: nonEmptyString(release.commit) ? release.commit : null };
}

/** 번호가 가장 높은 항목(revisionModel 이 숫자로 바꾼 revision 기준). 없으면 null. */
const highest = (list) => list.reduce((a, b) => (a === null || b.revision > a.revision ? b : a), null);

/**
 * `helm history -o json` → 리비전 모델 `{ items, deployed, latest, attempt }`. 항목은 원래 필드(status·description 등)를 그대로 두고 revision 만 숫자로 바꾼다
 * (문자열 '9' < '10' 같은 비교 실수를 한 곳에서 막는다). 항목이 없으면 deployed·latest·attempt 모두 null.
 * Helm 은 `upgrade --wait` 가 실패하면 새 리비전을 `failed` 로 남기고 직전 리비전을 `deployed` 그대로 둔다(성공해야 `superseded`) —
 * 그래서 「현재 운영」은 가장 높은 번호가 아니라 가장 높은 `deployed` 다.
 *  - deployed: `deployed` 중 가장 높은 번호의 항목(지금 클러스터가 실제로 도는 리비전). latest: 전체에서 가장 높은 번호(실패·진행 중 시도 포함).
 *  - attempt: deployed 위에 얹힌 실패·진행 중 시도 = latest 가 deployed 보다 높을 때의 latest. deployed 가 아예 없으면 latest 자체가 시도다.
 */
export function revisionModel(history) {
  const items = history.map((h) => ({ ...h, revision: Number(h.revision) }));
  const deployed = highest(items.filter((h) => h.status === 'deployed'));
  const latest = highest(items);
  const attempt = latest !== null && (deployed === null || latest.revision > deployed.revision) ? latest : null;
  return { items, deployed, latest, attempt };
}

/**
 * `helm history -o json` → 롤백 계획 `{ kind, target, deployed, latest, attempt }`(target 등은 revisionModel 의 항목). 되돌릴 곳이 없으면 null.
 *  - recover: deployed 위에 실패·진행 중 시도(attempt)가 얹혀 있다 → 마지막 정상 리비전인 deployed 로 복구한다(target = deployed).
 *  - toggle: 정상 상태(latest = deployed) → deployed 보다 앞선 `superseded` 중 가장 높은 번호. `failed`·`pending-*`·`uninstalled` 는 되돌아갈 곳이 아니라 건너뛴다.
 *    롤백으로 만들어진 현재 리비전(`Rollback to N`)도 번호상 바로 앞 superseded 가 대상이다(왕복 토글).
 *  - fallback: deployed 가 아예 없다(실패한 롤백 등) → 가장 높은 `superseded`.
 */
export function rollbackPlan(history) {
  const { items, deployed, latest, attempt } = revisionModel(history);
  const supersededBelow = (limit) => highest(items.filter((h) => h.status === 'superseded' && h.revision < limit));
  const plan =
    deployed === null ? { kind: 'fallback', target: supersededBelow(Infinity) }
    : attempt !== null ? { kind: 'recover', target: deployed }
    : { kind: 'toggle', target: supersededBelow(deployed.revision) };
  return plan.target === null ? null : { ...plan, deployed, latest, attempt };
}

/**
 * `kubectl get pods -o json` → 컨테이너 이름별 실행 중 digest 집합. 준비된(ready) 컨테이너만 센다.
 * `containerStatuses` 만 읽는다(init 컨테이너는 이미지가 달라 비교 대상이 아니다). 종료 중(deletionTimestamp) 파드는 곧 사라질 옛 파드라 뺀다.
 * digest 를 못 뽑는 imageID(빈 값·태그만 있는 값)는 건너뛴다.
 */
export function podDigests(podsJson) {
  const result = new Map();
  const items = Array.isArray(podsJson?.items) ? podsJson.items : [];
  for (const pod of items) {
    if (pod?.metadata?.deletionTimestamp) continue;
    for (const c of pod?.status?.containerStatuses ?? []) {
      if (c?.ready !== true) continue;
      const digest = typeof c.imageID === 'string' ? IMAGE_ID_DIGEST.exec(c.imageID)?.[1] : undefined;
      if (digest === undefined) continue;
      if (!result.has(c.name)) result.set(c.name, new Set());
      result.get(c.name).add(digest);
    }
  }
  return result;
}

/**
 * 앱마다 실행 중 digest 가 매니페스트 digest 와 같은지 판정한다. ok 는 「실행 중인 digest 가 하나 이상이고 전부 기대와 같다」 —
 * 준비된 파드가 없으면(빈 집합) 일치로 보지 않고, 옛·새 파드가 섞여 있으면(롤링 중) 불일치다. actual 은 정렬한 digest 목록.
 */
export function checkDigests({ manifest, podsByApp }) {
  return Object.entries(manifest.images).map(([id, img]) => {
    const actual = runningDigests(podsByApp, id);
    return { id, ok: actual.length > 0 && actual.every((d) => d === img.digest), expected: img.digest, actual };
  });
}

/**
 * 앱 하나의 실행 중 digest 목록(정렬) — podsByApp(앱 id → 파드 JSON)에서 그 앱 컨테이너(db 는 postgres)의 준비된 digest 만. 없으면 빈 배열.
 * checkDigests(매니페스트와 비교)와 status(매니페스트가 없을 때 실행 digest 표시)가 같은 추출 규칙을 쓰게 한 곳에 둔다.
 */
export function runningDigests(podsByApp, id) {
  const found = podDigests(podsByApp.get(id)).get(containerName(id));
  return found === undefined ? [] : [...found].sort();
}

/** kind 별로 버전이 들어 있는 곳 — api 의 actuator info 는 `.app.version`, web·admin 의 version.json 은 `.version`. */
const VERSION_READERS = {
  actuator: (json) => json.app?.version,
  'version-json': (json) => json.version,
};

/**
 * 버전 응답 본문 → 버전 문자열. 버전을 알 수 없으면 null — 옛 이미지는 `/version.json` 에 index.html(SPA 대체 응답)을, api `/actuator/info` 에 `{}` 를 돌려준다.
 * JSON 이 아니거나 필드가 비었거나 문자열이 아니면 모두 null(예외로 죽지 않는다). 알 수 없는 kind 만 프로그래밍 오류라 throw.
 */
export function parseVersionResponse(text, kind) {
  const read = VERSION_READERS[kind];
  if (read === undefined) throw new Error(`알 수 없는 kind: ${JSON.stringify(kind)} (actuator | version-json)`);
  if (typeof text !== 'string') return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(json)) return null;
  const version = read(json);
  return nonEmptyString(version) ? version : null;
}

/**
 * 체크리스트 sections 에 ⚠ 항목이 있는가 — 새 앱·환경변수·마이그레이션(추가·수정)·Helm 변경 중 하나라도 비어 있지 않으면 true.
 * newApps 가 null(기준 매니페스트 없음 → 판정 불가)이면 그 항목은 없는 것으로 본다. 이슈·안내문은 경고가 아니다.
 * newAppsUnknown: 호출자가 새 앱 확인이 불가능하다고 판정했으면(기준 매니페스트를 못 받음 등) 그것도 ⚠ 로 친다 —
 * 시크릿·설정이 필요한 새 앱이 확인 없이 나가지 않게 한다.
 */
export function hasWarnings(sections, { newAppsUnknown = false } = {}) {
  const filled = (list) => Array.isArray(list) && list.length > 0;
  return newAppsUnknown || filled(sections.newApps) || filled(sections.envVars) || filled(sections.migrations?.added) || filled(sections.migrations?.changed) || filled(sections.helmChanges);
}

const MATCH_LABEL = new Map([[true, '일치'], [false, '불일치']]);
/** 마크다운 표 셀 — `|` 는 열 구분으로 읽히지 않게 이스케이프하고, 값이 없으면 `-`. */
const cell = (value) => (value === null || value === undefined || value === '' ? '-' : String(value).replace(/\|/g, '\\|'));

/**
 * 상태 출력. revision: `{ revision, status, description }`(helm history 항목 — 지금 운영 중인 `deployed` 리비전), release: `{ version, commit }` | null(전환 전 리비전).
 * attempt: 그 위에 얹힌 실패·진행 중 시도 `{ revision, status, release }` | null — 있으면 ⚠ 줄로 알린다. `--atomic` 없이 실패한 upgrade 는 새 리소스를 일부 적용해 두므로
 * Helm 기록상 운영 리비전이 revision 이어도 실제 클러스터가 그 리비전과 똑같다고 말하지 않는다.
 * warnings: 그 밖의 ⚠ 문구 배열(매니페스트가 운영 릴리스와 다름 등).
 * rows: `{ id, builtVersion, digest, match }[]` — digest 는 매니페스트(또는 매니페스트가 없으면 실행) 값, match 는 true | false | null(판정 못 함).
 */
export function renderStatus({ revision, release, attempt = null, warnings = [], rows }) {
  const description = revision.description ? ` — ${revision.description}` : '';
  const releaseLine = release === null ? '릴리스: 없음 (release.version 이 기록되지 않은 리비전)' : `릴리스: ${release.version}${release.commit ? ` (${release.commit.slice(0, 12)})` : ''}`;
  const attemptLine = attempt === null ? [] : [`⚠ 리비전 ${attempt.revision} (${attempt.status}) 반영 실패 — 새 리소스 일부가 이미 적용됐을 수 있다${attempt.release ? ` (시도한 release ${attempt.release.version})` : ''}. 되돌리려면 rollback`];
  return [
    `리비전: ${revision.revision} (${revision.status})${description}`,
    releaseLine,
    ...attemptLine,
    ...warnings.map((w) => `⚠ ${w}`),
    '',
    '| 앱 | 원 빌드 버전 | 매니페스트 digest(앞 19자) | 실행 digest 일치 |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.id)} | ${cell(r.builtVersion)} | ${cell(r.digest?.slice(0, 19))} | ${MATCH_LABEL.get(r.match) ?? '-'} |`),
    '',
  ].join('\n');
}
