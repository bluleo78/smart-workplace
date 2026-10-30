// 프로필 아바타(WP-1222) — 백엔드 아바타 API 와 1:1 인 타입.

/** `GET /users/avatars` 의 한 줄 — 지금 워크스페이스에서 아바타를 올린 사용자(사람·AI)만 온다. */
export interface AvatarEntry {
  userId: number
  /** `/api/v1/avatars/{userId}/{hash}` — 표시할 때 뒤에 `/64`·`/128`·`/256` 을 붙인다. */
  avatarUrl: string
}

/** 올릴 때 함께 보내는 자른 영역 — 원본 이미지 픽셀 좌표의 정사각(정수). 없으면 서버가 가운데 정사각으로 자른다. */
export interface AvatarCrop {
  cropX: number
  cropY: number
  cropSize: number
}

/** `PUT .../avatar` 응답 — 새 아바타 주소. */
export interface AvatarUploadResponse {
  avatarUrl: string
}
