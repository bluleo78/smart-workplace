// 릴리스 ↔ WP 프로젝트 버전 연동 (WP-1005) — 릴리스마다 WP 프로젝트에 버전(`v<x.y.z>`)을 만들고 포함 이슈에 수정 버전으로 붙이며,
// 운영 반영이 끝나면 출시로, 롤백하면 출시 취소로 바꾼다. Gen:iA Works REST API(`/api/v1/projects/{key}/versions` 등)를 부른다.
//
// 트래커는 릴리스의 부수 기록이다 — 설정이 없거나 API 가 실패해도 태그·반영·롤백을 막지 않는다(호출자가 경고만 남긴다).
// 모든 단계는 다시 돌려도 같은 결과가 되게 한다: 버전은 이름으로 먼저 찾고 없을 때만 만들고, 이슈는 이미 붙어 있으면 건너뛰고,
// 이미 출시된 버전은 다시 출시하지 않는다(출시일을 덮지 않게).
// fetch·env 는 주입받는다 — 테스트가 네트워크 없이 요청 모양·분기를 검증한다.

/** 릴리스 버전을 기록하는 프로젝트 — 이슈 키(WP-n)와 같은 프로젝트다. */
export const TRACKER_PROJECT = 'WP';
/** 트래커 설정 환경 변수 — API 주소(예: https://works.example.com)와 프로젝트 OWNER 의 개인 토큰(swp_…). */
export const TRACKER_ENV = { url: 'GENIA_WORKS_API_URL', token: 'GENIA_WORKS_RELEASE_TOKEN' };

/** 릴리스 버전(x.y.z) → WP 프로젝트 버전 이름. 사람이 만든 기존 버전(v0.9.23)과 같은 `v` 접두 형식. */
export const versionName = (version) => `v${version}`;

/**
 * 환경 변수로 트래커 클라이언트를 만든다. 둘 중 하나라도 없으면 null(연동 안 함) — 호출자가 한 줄 안내만 남긴다.
 * 응답이 2xx 가 아니면 서버 메시지(`message`)를 담아 throw 한다(토큰·권한 문제를 알아보게). 토큰은 오류 문구에 넣지 않는다.
 */
export function trackerFromEnv(env = process.env, { fetch = globalThis.fetch, project = TRACKER_PROJECT, timeoutMs = 10_000 } = {}) {
  const base = env[TRACKER_ENV.url]?.trim().replace(/\/+$/, '');
  const token = env[TRACKER_ENV.token]?.trim();
  if (!base || !token) return null;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api/v1/projects/${project}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // 트래커가 멈춰도 반영·롤백이 기다리지 않게 — 시간이 넘으면 throw 해 bestEffort 가 경고로 삼킨다.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.message ?? '';
      } catch {
        // 본문이 JSON 이 아니면 상태 코드만 알린다.
      }
      throw new Error(`${method} ${path} → HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    return res.status === 204 ? null : res.json();
  };
  return {
    project,
    listVersions: () => call('GET', '/versions'),
    createVersion: (body) => call('POST', '/versions', body),
    releaseVersion: (id) => call('POST', `/versions/${id}/release`, {}),
    unreleaseVersion: (id) => call('POST', `/versions/${id}/unrelease`),
    getIssue: (number) => call('GET', `/issues/${number}`),
    replaceFixVersions: (number, fixVersionIds) => call('PUT', `/issues/${number}/versions`, { fixVersionIds }),
  };
}

/**
 * 이슈 상세 응답(`{ summary: { fixVersions } }`)에서 지금 붙은 수정 버전 id 들. 모양이 다르면 throw — 빈 집합으로 보고 교체하면
 * 기존 수정 버전이 지워진다(교체는 집합 교체).
 */
function currentFixIds(detail) {
  const list = detail?.summary?.fixVersions;
  if (!Array.isArray(list)) throw new Error('이슈 응답에 summary.fixVersions 가 없다 — 기존 수정 버전을 지우지 않게 건너뛴다');
  return list.map((v) => v.id);
}

/** 이름으로 버전을 찾는다(없으면 null). */
async function findVersion(tracker, name) {
  return (await tracker.listVersions()).find((v) => v.name === name) ?? null;
}

/**
 * 버전을 만들고(없을 때만) 이슈들에 수정 버전으로 붙인다. 이 프로젝트 키(WP-n)가 아닌 키는 건너뛴다.
 * 이슈 하나가 실패해도(지워진 이슈 등) 나머지는 계속하고, 실패 목록을 돌려준다. 수정 버전 교체는 집합 교체라 기존 수정 버전을 합쳐 보낸다.
 * @returns {{ version, created, attached: string[], skipped: string[], failed: {key, error}[] }}
 */
export async function attachVersion(tracker, { version, issueKeys, log = () => {} }) {
  const name = versionName(version);
  let row = await findVersion(tracker, name);
  const created = row === null;
  if (created) row = await tracker.createVersion({ name, description: `릴리스 ${name}` });
  log(`트래커: ${tracker.project} 버전 ${name} ${created ? '만듦' : '있음'} (id ${row.id})`);
  const prefix = `${tracker.project}-`;
  const attached = [];
  const skipped = [];
  const failed = [];
  for (const key of issueKeys) {
    if (!key.startsWith(prefix)) continue;
    const number = Number(key.slice(prefix.length));
    try {
      const ids = currentFixIds(await tracker.getIssue(number));
      if (ids.includes(row.id)) {
        skipped.push(key);
        continue;
      }
      await tracker.replaceFixVersions(number, [...ids, row.id]);
      attached.push(key);
    } catch (err) {
      failed.push({ key, error: err.message });
    }
  }
  log(`트래커: 수정 버전 ${name} — 붙임 ${attached.length} · 이미 있음 ${skipped.length} · 실패 ${failed.length}`);
  for (const f of failed) log(`경고: ${f.key} 에 수정 버전을 붙이지 못했다 (${f.error})`);
  return { version: row, created, attached, skipped, failed };
}

/**
 * 버전을 출시(released=true)·출시 취소(false)로 바꾼다. 버전이 없으면 만들지 않고 알리기만 한다(태그 단계 연동이 빠진 릴리스).
 * 이미 그 상태면 건드리지 않는다 — 다시 출시하면 출시일이 오늘로 덮인다. 보관된 버전은 바꾸지 않는다.
 * @returns {'changed' | 'unchanged' | 'missing' | 'archived'}
 */
export async function setReleased(tracker, { version, released, log = () => {} }) {
  const name = versionName(version);
  const row = await findVersion(tracker, name);
  if (row === null) {
    log(`트래커: ${tracker.project} 버전 ${name} 이 없어 ${released ? '출시' : '출시 취소'}를 건너뛴다`);
    return 'missing';
  }
  if (row.status === 'ARCHIVED') {
    log(`트래커: ${name} 은 보관된 버전이라 바꾸지 않는다`);
    return 'archived';
  }
  if ((row.status === 'RELEASED') === released) {
    log(`트래커: ${name} 은 이미 ${released ? '출시됨' : '미출시'}`);
    return 'unchanged';
  }
  await (released ? tracker.releaseVersion(row.id) : tracker.unreleaseVersion(row.id));
  log(`트래커: ${name} ${released ? '출시' : '출시 취소'}`);
  return 'changed';
}

/**
 * 트래커 단계를 막지 않고 돌린다 — tracker 가 null 이면 설정 안내 한 줄, 실패하면 경고 한 줄을 남기고 null 을 돌려준다.
 * 릴리스 CLI(release.mjs·tracker.mjs)가 같은 모양으로 쓴다.
 */
export async function bestEffort({ tracker, log, what }, fn) {
  if (tracker === null) {
    log(`트래커: 설정(${TRACKER_ENV.url}·${TRACKER_ENV.token})이 없어 건너뛴다 — ${what} (docs/ops/release.md 「WP 버전 연동」)`);
    return null;
  }
  try {
    return await fn(tracker);
  } catch (err) {
    log(`경고: 트래커 ${what} 실패 — 릴리스는 계속한다 (${err.message})`);
    return null;
  }
}
