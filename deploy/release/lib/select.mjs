// 변경 감지: 이미지별 "다시 빌드(build)할지, 기준 릴리스에서 승계(carry)할지" 판정 (WP-440).
// 순수 함수다 — git·파일시스템·네트워크에 접근하지 않고, 호출자가 넘긴 변경 파일 목록과 기준 매니페스트만으로 결정한다.
// 그래서 같은 입력이면 항상 같은 결과이고, 테스트가 합성 데이터만으로 모든 분기를 덮는다.
import { posix } from 'node:path';
import { cmp, isPlainObject, matchesPath } from './catalog.mjs';

/** buildArgs 를 키 정렬 JSON 으로 — 키 순서가 달라도 같은 인자 집합이면 같은 문자열. */
const canonicalArgs = (args) => JSON.stringify(Object.entries(args).sort(([a], [b]) => cmp(a, b)));

/**
 * 카탈로그 순서 그대로 `{ id, action: 'build'|'carry', reasons: string[] }` 목록을 돌려준다.
 *
 * - changedFiles === null: 기준 릴리스(태그)가 없다 → 비교 대상이 없으므로 전부 build(`no-base`).
 * - baseManifest === null: 기준 매니페스트가 없다 → 승계할 digest 가 없으므로 전부 build(`no-base`).
 * - 기준 매니페스트에 없는 앱: 새 앱이라 승계할 이미지가 없다 → build(`new-app`). 다른 사유는 덧붙이지 않는다.
 * - 기준 항목의 repository 가 카탈로그와 다르면 build(`repository-changed`) — 승계할 digest 가 다른 저장소의 것이라 새 저장소에는 없다.
 * - 기준 항목이 buildArgs 를 기록했고 카탈로그와 다르면(키 정렬 JSON 비교) build(`build-args`). 기록이 없으면(구 매니페스트) 알 수 없으므로 강제하지 않는다.
 *   repository 도 마찬가지로 기록이 없으면 비교하지 않는다.
 * - 그 밖에는 카탈로그 paths(`path:<패턴>`)와 앱이 의존하는 워크스페이스 패키지(`workspace:<디렉터리>`)에
 *   변경 파일이 하나라도 걸리면 build, 아니면 carry(reasons 비어 있음).
 *   사유는 걸린 것을 모두 모으되 중복 없이, 설정 사유(repository-changed → build-args) · 경로 사유(카탈로그 순) · 워크스페이스 사유(deps 순)로 낸다.
 *
 * deps 는 workspaceDeps() 의 결과로, 키는 dirname(dockerfile)(예: `apps/workplace-web`). 키가 없는 앱(db)은 의존 없음으로 본다.
 */
export function selectImages({ catalog, deps, changedFiles, baseManifest }) {
  return catalog.images.map((image) => {
    const { id } = image;
    if (changedFiles === null || baseManifest === null) return { id, action: 'build', reasons: ['no-base'] };
    if (baseManifest.images?.[id] === undefined) return { id, action: 'build', reasons: ['new-app'] };

    const reasons = [];
    const base = baseManifest.images[id];
    if (base.repository !== undefined && base.repository !== image.repository) reasons.push('repository-changed');
    if (isPlainObject(base.buildArgs) && canonicalArgs(base.buildArgs) !== canonicalArgs(image.buildArgs ?? {})) reasons.push('build-args');
    for (const pattern of image.paths) {
      if (changedFiles.some((file) => matchesPath(file, pattern))) reasons.push(`path:${pattern}`);
    }
    for (const dir of deps.get(posix.dirname(image.dockerfile)) ?? []) {
      if (changedFiles.some((file) => matchesPath(file, dir))) reasons.push(`workspace:${dir}`);
    }
    const unique = [...new Set(reasons)];
    return { id, action: unique.length > 0 ? 'build' : 'carry', reasons: unique };
  });
}
