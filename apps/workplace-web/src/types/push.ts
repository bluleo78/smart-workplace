// src/types/push.ts
// Web Push API 타입 — 백엔드 PushController 계약과 1:1(옛 종류별 설정 /push/preferences 는 웹이 더 쓰지 않는다, WP-913).
export interface PushConfig {
  enabled: boolean
  vapidPublicKey: string | null
}
