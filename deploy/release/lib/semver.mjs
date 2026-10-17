// 릴리스 버전(semver) 파싱·비교와 기준 태그 선택 (WP-440).
// 릴리스 태그는 `v` + `MAJOR.MINOR.PATCH` 형식만 쓴다(프리릴리스·빌드 메타 없음). git 은 건드리지 않고 문자열만 다룬다.

/** 태그 형식: `v0.9.0` — 정확히 세 자리 숫자. */
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** `0.9.0` → {major,minor,patch}. 형식이 다르면(`v` 접두·자리 수·프리릴리스) null. */
export function parseVersion(s) {
  const m = typeof s === 'string' ? VERSION_RE.exec(s) : null;
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/**
 * 두 버전 비교 — 음수/0/양수. 문자열이 아니라 숫자로 비교한다(0.10.0 > 0.9.0).
 * 문자열 `0.9.0` 과 parseVersion 결과 모두 받는다. 형식이 틀리면 throw (조용히 잘못 비교하는 쪽이 더 위험).
 */
export function compareVersions(a, b) {
  const pa = typeof a === 'string' ? parseVersion(a) : a;
  const pb = typeof b === 'string' ? parseVersion(b) : b;
  if (!pa || !pb) throw new Error(`잘못된 버전: ${JSON.stringify(pa ? b : a)}`);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** 릴리스 버전 태그인가 — `v0.9.0` 만 true (`v0.9`·`v0.9.0-rc1`·`0.9.0` 은 아님). */
export function isVersionTag(tag) {
  return typeof tag === 'string' && TAG_RE.test(tag);
}

/**
 * 변경 비교의 기준 태그 — 조상 태그 중 자기 자신을 뺀 가장 높은 semver, 없으면 null.
 * 어떤 태그가 조상인지는 호출 쪽(git)이 정해 넘긴다. 그래서 자기보다 높은 태그도 조상에 있으면 기준이 되고
 * (핫픽스 v1.5.1 은 조상에 v1.6.0 이 없으므로 v1.5.0), 이 함수는 조상 관계를 따로 판단하지 않는다.
 */
export function findBaseTag(ancestorTags, selfTag) {
  let best = null;
  for (const tag of ancestorTags) {
    if (tag === selfTag || !isVersionTag(tag)) continue;
    if (best === null || compareVersions(tag.slice(1), best.slice(1)) > 0) best = tag;
  }
  return best;
}
