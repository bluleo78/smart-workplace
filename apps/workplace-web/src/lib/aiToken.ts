// 행위자 이름에 "AI" 토큰이 이미 포함돼 있는지 검사하는 공용 유틸.
// AGENT 행위자 뱃지를 붙이는 여러 컴포넌트(InboxPanel, NotificationGroupRow 등)에서
// 이름 자체가 "AI"를 포함하면(예: "My AI") 별도 뱃지를 생략해 "My AI AI" 중복을 방지한다 (#636, #637).

// 액터 이름에 이미 "AI" 토큰이 포함돼 있으면(단어 경계 기준, 대소문자 무시) AGENT 뱃지를 생략한다.
// 예: "My AI" 는 뱃지 없이 "My AI님이…"로 표시 — "My AI AI님이…" 중복 방지 (#636)
export function hasAiToken(name: string | null | undefined): boolean {
  if (!name) return false
  return /\bAI\b/i.test(name)
}
