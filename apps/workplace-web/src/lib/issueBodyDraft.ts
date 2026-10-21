// 이슈 본문 편집 로컬 초안(#824) — 저장 안 한 본문을 localStorage 에 두었다가 다시 편집할 때 복구 배너로 안내한다.
// 초안은 쓴 사람의 것이라 키에 사용자·워크스페이스를 넣고, 로그아웃 때 모두 지운다 — 예전엔 키가 프로젝트·이슈뿐이라
// 같은 브라우저로 로그인한 다른 사용자가 앞 사용자의 저장 안 한 글을 [불러오기]로 볼 수 있었다(WP-699).

const PREFIX = 'issue-body-draft:';

/** 초안 주인 — 로그인 사용자 id 와 지금 워크스페이스 id(없으면 null). */
export interface IssueBodyDraftOwner {
  userId: number;
  tenantId: number | null;
}

/** 초안 localStorage 키 — 주인(사용자·워크스페이스) + 프로젝트 + 이슈 번호. */
export function issueBodyDraftKey(owner: IssueBodyDraftOwner, projectKey: string, issueNumber: number): string {
  return `${PREFIX}${owner.userId}:${owner.tenantId ?? '-'}:${projectKey}:${issueNumber}`;
}

// localStorage 접근은 프라이빗 모드·사이트 데이터 차단 환경에서 throw 할 수 있으므로
// 전부 try/catch — 실패해도 편집 자체는 정상 동작해야 한다(#824).
export function readIssueBodyDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeIssueBodyDraft(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 무시 — 초안 저장은 보완책일 뿐 필수 기능이 아니다.
  }
}
export function clearIssueBodyDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 무시.
  }
}

/** 로그아웃 정리 — 이 기기의 본문 초안을 모두 지운다(주인 없는 예전 형식 키 포함). 다른 저장값은 건드리지 않는다. */
export function clearIssueBodyDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // 무시.
  }
}
