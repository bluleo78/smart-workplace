// 본문 이슈 키 링크 상태(WP-2102)의 쿼리 키 — axios·api 를 import 하지 않는 순수 키 파일이다(resourceInvalidation 이 가볍게 가져다 쓰도록).
// 프로젝트별로 묶어 두어 그 프로젝트(또는 그 키 하나)만 무효화할 수 있다.
export const issueKeyStatusKeys = {
  project: (pk: string) => ['issue-key-status', pk] as const,
  key: (pk: string, number: number) => ['issue-key-status', pk, number] as const,
}
