// 이슈 상세 주소(/projects/:key/issues/:number) 판정(WP-2074) — 첫 진입 시 상세 데이터를 미리 요청할 때 쓴다.
// 같은 정규식을 routePreloads.ts 의 이슈 상세 청크 미리 받기 표도 쓴다 — 청크와 데이터가 같은 주소를 대상으로 하게 한 곳에 둔다.

// 번호는 1 부터 — 이슈 번호에 0·앞자리 0 은 없으니(0, 012) 미리 받기 대상이 아니다.
export const ISSUE_DETAIL_PATH = /^\/projects\/([^/]+)\/issues\/([1-9]\d*)\/?$/;

/** 이슈 상세 주소면 프로젝트 키·번호를, 아니면(또는 키 디코딩에 실패하면) null 을 돌려준다. */
export function matchIssueDetailPath(pathname: string): { projectKey: string; number: number } | null {
  const m = ISSUE_DETAIL_PATH.exec(pathname);
  if (!m) return null;
  try {
    return { projectKey: decodeURIComponent(m[1]), number: Number(m[2]) };
  } catch {
    // 깨진 퍼센트 인코딩 — 미리 요청 대상이 아니다(라우터가 알아서 처리).
    return null;
  }
}
