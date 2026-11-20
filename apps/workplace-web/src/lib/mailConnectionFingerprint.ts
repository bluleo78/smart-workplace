// 메일 계정 추가 폼의 「연결 칸 지문」(WP-1790).
// 연결 테스트를 통과한 뒤 연결 칸이 바뀌면 그 결과는 더 이상 믿을 수 없다 — 값이 바뀌었는지 문자열 하나로 비교하려고 쓴다.

/**
 * 연결에 쓰이는 칸만 — 표시 이름·AI 토글은 결과를 무효로 만들지 않는다(WP-1790).
 * 다이얼로그가 이 목록으로 useWatch·getValues 를 불러 같은 순서의 값 배열을 얻는다 — 순서는 지문의 일부라 바꾸면 안 된다.
 */
export const MAIL_CONNECTION_FIELDS = [
  'emailAddress',
  'imapHost',
  'imapPort',
  'imapSecurity',
  'imapUsername',
  'smtpHost',
  'smtpPort',
  'smtpSecurity',
  'smtpUsername',
  'password',
] as const;

/**
 * MAIL_CONNECTION_FIELDS 순서의 값 배열을 JSON 배열 문자열로 만든다.
 * 칸마다 `String(v ?? '')` 로 맞춰 없음과 빈 문자열을 같은 값으로 본다(비운 포트칸의 NaN 은 'NaN' 으로 늘 같다).
 */
export function mailConnectionFingerprint(values: readonly unknown[]): string {
  return JSON.stringify(values.map((v) => String(v ?? '')));
}
