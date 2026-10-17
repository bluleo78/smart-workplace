// 릴리스 매니페스트 저장소 (WP-440) — GitLab generic package `release-manifest/<버전>/release-manifest.json`.
// 다음 릴리스가 "기준 릴리스의 이미지 digest"를 승계(carry)하려면 매니페스트가 어딘가 남아 있어야 한다.
// 이미지 레지스트리가 아니라 GitLab 패키지에 두는 이유: 매니페스트는 이미지가 아니고, CI 토큰만으로 읽고 쓸 수 있다.
// fetch·env 는 주입받는다 — 테스트가 네트워크 없이 헤더·URL·상태코드 분기를 검증한다.

/** 패키지 URL 과 인증 헤더를 만든다. 설정이 없으면 조용히 실패하지 않고 throw 한다. */
function target(version, env) {
  const base = env.CI_API_V4_URL;
  const project = env.CI_PROJECT_ID;
  if (!base || !project) throw new Error('CI_API_V4_URL 과 CI_PROJECT_ID 환경 변수가 필요하다');
  // CI 안에서는 잡 토큰이 우선이고, 로컬 실행은 개인 토큰(GITLAB_TOKEN)을 쓴다.
  let headers;
  if (env.CI_JOB_TOKEN) headers = { 'JOB-TOKEN': env.CI_JOB_TOKEN };
  else if (env.GITLAB_TOKEN) headers = { 'PRIVATE-TOKEN': env.GITLAB_TOKEN };
  else throw new Error('CI_JOB_TOKEN 또는 GITLAB_TOKEN 환경 변수가 필요하다');
  const url = `${base}/projects/${project}/packages/generic/release-manifest/${encodeURIComponent(version)}/release-manifest.json`;
  return { url, headers, projectUrl: `${base}/projects/${project}` };
}

/**
 * 버전의 매니페스트를 내려받는다. 404 면 null(패키지 없음), 그 밖의 실패는 throw — 인증 오류를 "없음"으로 오인하면 전부 재빌드된다.
 * 개인 토큰(GITLAB_TOKEN)일 때만 404 에 프로젝트 조회(`GET /projects/<id>`)를 더해, 프로젝트 ID 오류·권한 부족(GitLab 이 404 로 숨김)을 「없음」으로 오인하지 않게 한다.
 * CI 잡 토큰은 확인하지 않는다 — 일반 API 를 허용하지 않아 확인하면 새 버전(항상 404)마다 실패한다.
 */
export async function downloadManifest(version, { fetch = globalThis.fetch, env = process.env } = {}) {
  const { url, headers, projectUrl } = target(version, env);
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    if (!headers['PRIVATE-TOKEN']) return null;
    const probe = await fetch(projectUrl, { headers });
    if (probe.status !== 200) {
      throw new Error(`매니페스트 다운로드 실패 (${version}): 패키지가 404 인데 프로젝트 조회도 HTTP ${probe.status} 이다. CI_PROJECT_ID(${env.CI_PROJECT_ID})와 토큰 권한을 확인하라`);
    }
    return null;
  }
  if (!res.ok) throw new Error(`매니페스트 다운로드 실패 (${version}): HTTP ${res.status}`);
  return res.json();
}

/** 매니페스트의 직렬화 형식 — 들여쓰기 2칸 + 끝 개행. 파일 출력과 업로드 본문이 같은 바이트를 내도록 한 곳에 둔다. */
export const serializeManifest = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

/** 버전의 매니페스트를 올린다(PUT). 실패하면 throw. */
export async function uploadManifest(version, manifest, { fetch = globalThis.fetch, env = process.env } = {}) {
  const { url, headers } = target(version, env);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: serializeManifest(manifest),
  });
  if (!res.ok) throw new Error(`매니페스트 업로드 실패 (${version}): HTTP ${res.status}`);
}
