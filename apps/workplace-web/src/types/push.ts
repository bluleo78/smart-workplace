// src/types/push.ts
// Web Push API 타입 — 백엔드 PushController 계약과 1:1.
export interface PushConfig {
  enabled: boolean
  vapidPublicKey: string | null
}
