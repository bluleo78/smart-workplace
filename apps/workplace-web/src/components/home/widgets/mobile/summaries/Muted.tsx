// 요약 한 줄의 빈 상태 문구 — 결핍 경고가 아니라 상태 안내라 muted 로 보인다(WP-142).
export function Muted({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>
}
