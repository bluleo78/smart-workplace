// 반영 순수 함수 테스트 (WP-443) — 합성 매니페스트·파드 JSON·응답 텍스트만 쓴다. helm·kubectl·네트워크 없음.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDigests, currentRelease, hasWarnings, imageValues, parseVersionResponse, podDigests, renderStatus, revisionModel, rollbackPlan, runningDigests } from '../lib/deploy.mjs';
import { baseManifest, fakeDigest } from './helpers.mjs';

const D1 = fakeDigest('one');
const D2 = fakeDigest('two');

/** 컨테이너 하나짜리 파드 JSON 조각. */
const pod = (containers, meta = {}) => ({ metadata: meta, status: { containerStatuses: containers } });
const ctr = (name, imageID, ready = true) => ({ name, imageID, ready });

// ---------- imageValues ----------

test('imageValues: 매니페스트의 repository·digest 만 images 로, version·commit 은 release 로', () => {
  const m = baseManifest();
  const v = imageValues(m);
  assert.deepEqual(Object.keys(v), ['images', 'release']);
  assert.deepEqual(v.release, { version: '0.8.0', commit: '1'.repeat(40) });
  assert.deepEqual(Object.keys(v.images).sort(), Object.keys(m.images).sort());
  assert.deepEqual(v.images.api, { repository: m.images.api.repository, digest: m.images.api.digest });
  assert.deepEqual(Object.keys(v.images.web).sort(), ['digest', 'repository']); // action·reasons·builtVersion 등은 새지 않는다
});

test('imageValues: JSON 직렬화가 helm -f 로 읽을 수 있는 모양이다', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(imageValues(baseManifest()))).release.version, '0.8.0');
});

// ---------- currentRelease ----------

test('currentRelease: release.version 이 있으면 { version, commit }', () => {
  assert.deepEqual(currentRelease({ release: { version: '0.9.0', commit: 'abc' }, secrets: { x: 1 } }), { version: '0.9.0', commit: 'abc' });
});

test('currentRelease: release 키·version 이 없거나 모양이 틀리면 null (전환 전 리비전)', () => {
  assert.equal(currentRelease({}), null);
  assert.equal(currentRelease({ images: {} }), null);
  assert.equal(currentRelease({ release: {} }), null);
  assert.equal(currentRelease({ release: { version: '' } }), null);
  assert.equal(currentRelease({ release: { version: 9 } }), null);
  assert.equal(currentRelease({ release: 'x' }), null);
  assert.equal(currentRelease(null), null);
  assert.equal(currentRelease(undefined), null);
  assert.equal(currentRelease([]), null);
});

test('currentRelease: commit 이 없으면 null 로 채운다', () => {
  assert.deepEqual(currentRelease({ release: { version: '0.9.0' } }), { version: '0.9.0', commit: null });
});

// ---------- revisionModel · rollbackPlan ----------

const rev = (revision, status) => ({ revision, status });
/** 계획을 리비전 번호로 펼친다(항목 객체 대신 번호로 비교). null 이면 null. */
const planOf = (history) => {
  const p = rollbackPlan(history);
  return p === null ? null : { kind: p.kind, target: p.target.revision, deployed: p.deployed?.revision ?? null, latest: p.latest.revision, attempt: p.attempt?.revision ?? null };
};

test('revisionModel: revision 을 숫자로 바꾸고 다른 필드는 남기며, deployed·latest·attempt 를 고른다', () => {
  const m = revisionModel([{ revision: '9', status: 'superseded', description: 'a' }, { revision: '10', status: 'deployed', description: 'b' }, { revision: '11', status: 'failed', description: 'c' }]);
  assert.deepEqual(m.items.map((h) => h.revision), [9, 10, 11]);
  assert.deepEqual(m.deployed, { revision: 10, status: 'deployed', description: 'b' });
  assert.equal(m.latest.revision, 11);
  assert.equal(m.attempt, m.latest, 'deployed 위의 실패한 시도');
  // 정상 상태: 시도 없음
  assert.equal(revisionModel([rev(1, 'superseded'), rev(2, 'deployed')]).attempt, null);
  // deployed 가 없으면 latest 자체가 시도
  const none = revisionModel([rev(1, 'superseded'), rev(2, 'failed')]);
  assert.equal(none.deployed, null);
  assert.equal(none.attempt.revision, 2);
  assert.deepEqual(revisionModel([]), { items: [], deployed: null, latest: null, attempt: null });
});

test('rollbackPlan: 정상 상태에서는 deployed 바로 앞의 superseded 가 대상', () => {
  const h = [rev(1, 'superseded'), rev(2, 'superseded'), rev(3, 'deployed')];
  assert.deepEqual(planOf(h), { kind: 'toggle', target: 2, deployed: 3, latest: 3, attempt: null });
  assert.deepEqual(planOf([...h].reverse()), { kind: 'toggle', target: 2, deployed: 3, latest: 3, attempt: null }); // 입력 순서와 무관
});

test('rollbackPlan: 되돌아갈 곳이 없으면 null (첫 리비전·실패한 첫 설치·빈 이력)', () => {
  assert.equal(rollbackPlan([rev(1, 'deployed')]), null);
  assert.equal(rollbackPlan([rev(1, 'failed')]), null);
  assert.equal(rollbackPlan([]), null);
});

test('rollbackPlan: 실패한 업그레이드가 위에 얹히면(1 superseded, 2 deployed, 3 failed) 마지막 정상인 deployed 로 복구', () => {
  assert.deepEqual(planOf([rev(1, 'superseded'), rev(2, 'deployed'), rev(3, 'failed')]), { kind: 'recover', target: 2, deployed: 2, latest: 3, attempt: 3 });
});

test('rollbackPlan: 진행 중(pending-upgrade) 시도가 위에 있어도 deployed 가 대상', () => {
  assert.deepEqual(planOf([rev(2, 'deployed'), rev(3, 'pending-upgrade')]), { kind: 'recover', target: 2, deployed: 2, latest: 3, attempt: 3 });
  assert.deepEqual(planOf([rev(2, 'deployed'), rev(3, 'pending-rollback')]), { kind: 'recover', target: 2, deployed: 2, latest: 3, attempt: 3 });
});

test('rollbackPlan: deployed 가 없으면(실패한 롤백 뒤) 가장 높은 superseded', () => {
  assert.deepEqual(planOf([rev(1, 'superseded'), rev(2, 'superseded'), rev(3, 'failed')]), { kind: 'fallback', target: 2, deployed: null, latest: 3, attempt: 3 });
});

test('rollbackPlan: 현재 앞의 failed·pending·uninstalled 는 건너뛰고 superseded 만 고른다', () => {
  const h = [rev(1, 'superseded'), rev(2, 'superseded'), rev(3, 'failed'), rev(4, 'deployed')];
  assert.deepEqual(planOf(h), { kind: 'toggle', target: 2, deployed: 4, latest: 4, attempt: null });
  assert.deepEqual(planOf([rev(1, 'superseded'), rev(2, 'uninstalled'), rev(3, 'pending-upgrade'), rev(4, 'deployed')]), { kind: 'toggle', target: 1, deployed: 4, latest: 4, attempt: null });
});

test('rollbackPlan: 리비전 번호가 문자열이어도 숫자로 비교한다 (9 < 10)', () => {
  assert.deepEqual(planOf([rev('9', 'superseded'), rev('10', 'deployed')]), { kind: 'toggle', target: 9, deployed: 10, latest: 10, attempt: null });
});

// ---------- podDigests ----------

test('podDigests: imageID 접두 변형에서 sha256:<64hex> 만 뽑는다', () => {
  const pods = {
    items: [
      pod([ctr('api', `docker.io/iacloudops/genia-works-api@${D1}`)]),
      pod([ctr('api', `docker-pullable://ghcr.io/x/api@${D2}`)]),
      pod([ctr('worker', D1)]), // 일부 런타임은 접두 없는 digest 만 준다
      pod([ctr('web', `docker://${D2}`)]),
    ],
  };
  const m = podDigests(pods);
  assert.deepEqual([...m.get('api')].sort(), [D1, D2].sort());
  assert.deepEqual([...m.get('worker')], [D1]);
  assert.deepEqual([...m.get('web')], [D2]);
});

test('podDigests: 준비되지 않은 컨테이너·imageID 가 비었거나 digest 가 아닌 것은 뺀다', () => {
  const m = podDigests({
    items: [
      pod([ctr('api', `r@${D1}`, false)]),
      pod([ctr('worker', '')]),
      pod([ctr('web', 'docker.io/x/web:latest')]), // digest 없음
      pod([{ name: 'admin', ready: true }]), // imageID 필드 없음
    ],
  });
  assert.equal(m.size, 0);
});

test('podDigests: initContainerStatuses 는 읽지 않는다', () => {
  const m = podDigests({ items: [{ status: { initContainerStatuses: [ctr('migrate', `r@${D1}`)], containerStatuses: [ctr('api', `r@${D2}`)] } }] });
  assert.deepEqual([...m.keys()], ['api']);
});

test('podDigests: 종료 중(deletionTimestamp)인 파드는 뺀다', () => {
  const m = podDigests({ items: [pod([ctr('api', `r@${D1}`)], { deletionTimestamp: '2026-10-17T00:00:00Z' }), pod([ctr('api', `r@${D2}`)])] });
  assert.deepEqual([...m.get('api')], [D2]);
});

test('podDigests: items 가 없거나 containerStatuses 가 없어도 죽지 않는다', () => {
  assert.equal(podDigests({}).size, 0);
  assert.equal(podDigests(null).size, 0);
  assert.equal(podDigests({ items: [{}, { status: {} }, null] }).size, 0);
});

// ---------- checkDigests ----------

/** 모든 앱이 매니페스트 digest 로 떠 있는 파드 응답. */
function healthyPods(manifest) {
  const podsByApp = new Map();
  for (const [id, img] of Object.entries(manifest.images)) {
    podsByApp.set(id, { items: [pod([ctr(id === 'db' ? 'postgres' : id, `${img.repository}@${img.digest}`)])] });
  }
  return podsByApp;
}

test('checkDigests: 전부 일치하면 모두 ok (db 의 컨테이너 이름은 postgres)', () => {
  const m = baseManifest();
  const r = checkDigests({ manifest: m, podsByApp: healthyPods(m) });
  assert.equal(r.length, Object.keys(m.images).length);
  assert.ok(r.every((x) => x.ok));
  const db = r.find((x) => x.id === 'db');
  assert.deepEqual(db, { id: 'db', ok: true, expected: m.images.db.digest, actual: [m.images.db.digest] });
});

test('checkDigests: db 파드의 컨테이너 이름이 db 이면 postgres 가 아니므로 불일치', () => {
  const m = baseManifest();
  const pods = healthyPods(m);
  pods.set('db', { items: [pod([ctr('db', `r@${m.images.db.digest}`)])] });
  const db = checkDigests({ manifest: m, podsByApp: pods }).find((x) => x.id === 'db');
  assert.equal(db.ok, false);
  assert.deepEqual(db.actual, []);
});

test('checkDigests: 다른 digest 로 떠 있으면 실패하고 실제 값을 알려 준다', () => {
  const m = baseManifest();
  const pods = healthyPods(m);
  pods.set('api', { items: [pod([ctr('api', `r@${D1}`)])] });
  const api = checkDigests({ manifest: m, podsByApp: pods }).find((x) => x.id === 'api');
  assert.deepEqual(api, { id: 'api', ok: false, expected: m.images.api.digest, actual: [D1] });
});

test('checkDigests: 옛 파드와 새 파드가 섞여 있으면(롤링 중) 실패', () => {
  const m = baseManifest();
  const pods = healthyPods(m);
  pods.set('web', { items: [pod([ctr('web', `r@${m.images.web.digest}`)]), pod([ctr('web', `r@${D1}`)])] });
  const web = checkDigests({ manifest: m, podsByApp: pods }).find((x) => x.id === 'web');
  assert.equal(web.ok, false);
  assert.deepEqual(web.actual, [m.images.web.digest, D1].sort());
});

test('checkDigests: 준비된 파드가 없거나 조회 결과 자체가 없으면 실패 (빈 집합을 일치로 보지 않는다)', () => {
  const m = baseManifest();
  const pods = healthyPods(m);
  pods.set('mcp', { items: [pod([ctr('mcp', `r@${m.images.mcp.digest}`, false)])] });
  pods.delete('collab');
  const r = checkDigests({ manifest: m, podsByApp: pods });
  for (const id of ['mcp', 'collab']) {
    const x = r.find((e) => e.id === id);
    assert.equal(x.ok, false, id);
    assert.deepEqual(x.actual, []);
  }
});

test('runningDigests: 앱의 준비된 실행 digest 를 정렬해 돌려주고(db 는 postgres 컨테이너), 없으면 빈 배열', () => {
  const m = baseManifest();
  const pods = healthyPods(m);
  pods.set('web', { items: [pod([ctr('web', `r@${m.images.web.digest}`)]), pod([ctr('web', `r@${D1}`)])] });
  assert.deepEqual(runningDigests(pods, 'web'), [m.images.web.digest, D1].sort());
  assert.deepEqual(runningDigests(pods, 'db'), [m.images.db.digest]);
  assert.deepEqual(runningDigests(pods, 'nope'), []);
  assert.deepEqual(runningDigests(new Map(), 'api'), []);
});

// ---------- parseVersionResponse ----------

test('parseVersionResponse: actuator 는 app.version, version-json 은 version', () => {
  assert.equal(parseVersionResponse('{"app":{"version":"0.9.0","commit":"x"}}', 'actuator'), '0.9.0');
  assert.equal(parseVersionResponse('{"version":"0.8.0","commit":"x"}', 'version-json'), '0.8.0');
});

test('parseVersionResponse: 옛 api 의 {} 응답은 버전 없음(null)', () => {
  assert.equal(parseVersionResponse('{}', 'actuator'), null);
  assert.equal(parseVersionResponse('{"app":{}}', 'actuator'), null);
  assert.equal(parseVersionResponse('{"app":null}', 'actuator'), null);
});

test('parseVersionResponse: 옛 web·admin 이 /version.json 에 돌려주는 index.html 은 null (예외 없이)', () => {
  const html = '<!doctype html>\n<html><head><title>x</title></head><body><div id="root"></div></body></html>';
  assert.equal(parseVersionResponse(html, 'version-json'), null);
  assert.equal(parseVersionResponse(html, 'actuator'), null);
});

test('parseVersionResponse: 비정상 입력은 모두 null', () => {
  for (const text of ['', '   ', 'null', '123', '"0.9.0"', '[]', '[{"version":"1"}]', '{"version":9}', '{"version":""}', '{"version":null}', undefined, null, 42]) {
    assert.equal(parseVersionResponse(text, 'version-json'), null, JSON.stringify(text));
  }
  assert.equal(parseVersionResponse('{"app":{"version":9}}', 'actuator'), null);
  assert.equal(parseVersionResponse('{"app":"0.9.0"}', 'actuator'), null);
  assert.equal(parseVersionResponse('{"version":"0.9.0"}', 'actuator'), null); // 종류가 다르면 그 필드를 보지 않는다
});

test('parseVersionResponse: 알 수 없는 kind 는 프로그래밍 오류라 throw', () => {
  assert.throws(() => parseVersionResponse('{}', 'nope'), /kind/);
});

// ---------- hasWarnings ----------

const clean = () => ({ newApps: [], envVars: [], migrations: { added: [], changed: [] }, helmChanges: [], issues: [] });

test('hasWarnings: 비어 있으면 false, newApps 가 null(판정 불가)이어도 false', () => {
  assert.equal(hasWarnings(clean()), false);
  assert.equal(hasWarnings({ ...clean(), newApps: null }), false);
});

test('hasWarnings: ⚠ 섹션 중 하나라도 비어 있지 않으면 true', () => {
  assert.equal(hasWarnings({ ...clean(), newApps: [{ id: 'x', helmMissing: false }] }), true);
  assert.equal(hasWarnings({ ...clean(), envVars: [{ name: 'A', hasDefault: false, file: 'f' }] }), true);
  assert.equal(hasWarnings({ ...clean(), migrations: { added: [{ file: 'V1__a.sql' }], changed: [] } }), true);
  assert.equal(hasWarnings({ ...clean(), migrations: { added: [], changed: ['V1__a.sql'] } }), true);
  assert.equal(hasWarnings({ ...clean(), helmChanges: ['deploy/helm/values.yaml'] }), true);
});

test('hasWarnings: newAppsUnknown(새 앱 확인 불가)이면 다른 섹션이 비어도 true, 생략·false 면 영향 없음', () => {
  assert.equal(hasWarnings(clean(), { newAppsUnknown: true }), true);
  assert.equal(hasWarnings({ ...clean(), newApps: null }, { newAppsUnknown: true }), true);
  assert.equal(hasWarnings(clean(), { newAppsUnknown: false }), false);
  assert.equal(hasWarnings(clean(), {}), false);
});

test('hasWarnings: 이슈·안내(note)만 있는 것은 경고가 아니다', () => {
  assert.equal(hasWarnings({ ...clean(), issues: [{ key: 'WP-1', subject: 's' }], envNote: 'n', appsNote: 'n' }), false);
});

// ---------- renderStatus ----------

test('renderStatus: 리비전·릴리스·앱별 표', () => {
  const out = renderStatus({
    revision: { revision: 12, status: 'deployed', description: 'release 0.9.0 (abcdef012345)' },
    release: { version: '0.9.0', commit: 'abcdef0123456789abcdef0123456789abcdef01' },
    rows: [
      { id: 'api', builtVersion: '0.9.0', digest: D1, match: true },
      { id: 'web', builtVersion: '0.8.0', digest: D2, match: false },
      { id: 'db', builtVersion: null, digest: null, match: null },
    ],
  });
  assert.match(out, /리비전: 12 \(deployed\)/);
  assert.match(out, /release 0\.9\.0 \(abcdef012345\)/);
  assert.match(out, /릴리스: 0\.9\.0 \(abcdef012345\)/);
  assert.match(out, /\| 앱 \| 원 빌드 버전 \| 매니페스트 digest\(앞 19자\) \| 실행 digest 일치 \|/);
  assert.match(out, new RegExp(`\\| api \\| 0\\.9\\.0 \\| ${D1.slice(0, 19)} \\| 일치 \\|`));
  assert.match(out, new RegExp(`\\| web \\| 0\\.8\\.0 \\| ${D2.slice(0, 19)} \\| 불일치 \\|`));
  assert.match(out, /\| db \| - \| - \| - \|/);
  assert.ok(!out.includes(D1)); // 앞 19자만
});

test('renderStatus: 실패·진행 중 시도(attempt)와 추가 경고는 ⚠ 줄로 알린다', () => {
  const out = renderStatus({
    revision: { revision: 2, status: 'deployed', description: 'Upgrade complete' },
    release: { version: '0.8.5', commit: null },
    attempt: { revision: 3, status: 'failed', release: { version: '0.9.0', commit: null } },
    warnings: ['매니페스트 버전이 다르다'],
    rows: [],
  });
  assert.match(out, /리비전: 2 \(deployed\)/);
  assert.match(out, /릴리스: 0\.8\.5/);
  assert.match(out, /⚠ 리비전 3 \(failed\) 반영 실패 — 새 리소스 일부가 이미 적용됐을 수 있다/);
  assert.match(out, /시도한 release 0\.9\.0/);
  assert.ok(!out.includes('클러스터는 위 리비전으로 돌고 있다'), '실패한 시도의 리소스가 일부 적용됐을 수 있으므로 단정하지 않는다');
  assert.match(out, /⚠ 매니페스트 버전이 다르다/);
  assert.ok(!renderStatus({ revision: { revision: 2, status: 'deployed' }, release: null, rows: [] }).includes('⚠'), 'attempt 가 없으면 ⚠ 도 없다');
});

test('renderStatus: release 가 없으면(전환 전 리비전) 그 사실을 적는다', () => {
  const out = renderStatus({ revision: { revision: 3, status: 'deployed', description: 'Upgrade complete' }, release: null, rows: [] });
  assert.match(out, /릴리스: 없음/);
});

test('renderStatus: 셀의 | 는 이스케이프한다', () => {
  const out = renderStatus({ revision: { revision: 1, status: 'deployed', description: 'a|b' }, release: null, rows: [{ id: 'x|y', builtVersion: '1', digest: D1, match: true }] });
  assert.match(out, /x\\\|y/);
});
