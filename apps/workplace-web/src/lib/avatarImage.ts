// 프로필 아바타 이미지 주소·파일 검사(WP-1222) — 화면 없이 판정되는 규칙을 모은다.
// 서버는 아바타를 64·128·256px 정사각 세 벌로 만들어 두고(`{avatarUrl}/{size}`), 화면은 표시 크기에 맞는 한 벌만 받는다.
import { ACCEPTED_IMAGE_TYPES } from './imageUpload'

/** 서버가 만들어 두는 아바타 크기(px) — 백엔드 계약과 같다. 이 밖의 크기는 404. */
export const AVATAR_SIZES = [64, 128, 256] as const
export type AvatarSize = (typeof AVATAR_SIZES)[number]

/**
 * 화면 표시 크기(CSS px)에 받을 아바타 크기 — 표시의 2배 이상인 가장 작은 크기(≤32→64, ≤64→128, 그 위→256).
 * 왜 2배: 고해상도 화면(DPR 2)에서도 흐리지 않게. 256 보다 큰 표시는 256 을 늘려 쓴다(서버가 더 큰 벌을 두지 않는다).
 */
export function avatarSizeFor(displayPx: number): AvatarSize {
  const need = displayPx * 2
  return AVATAR_SIZES.find((s) => s >= need) ?? 256
}

/** 표시 주소 — `avatarUrl + '/' + size`. avatarUrl 이 없으면 null(이니셜로 그린다). 끝의 `/` 는 겹치지 않게 뗀다. */
export function avatarSrc(avatarUrl: string | null | undefined, displayPx: number): string | null {
  if (!avatarUrl) return null
  return `${avatarUrl.replace(/\/+$/, '')}/${avatarSizeFor(displayPx)}`
}

/**
 * 올릴 수 있는 형식(파일 고르기 창 accept) — 본문 이미지 업로드와 같은 4종(`ACCEPTED_IMAGE_TYPES`)을 쓴다.
 * 서버가 실제 바이트로 다시 판별한다(여기서는 고르기 전에 바로 알리는 용도).
 */
export const AVATAR_ACCEPT = [...ACCEPTED_IMAGE_TYPES].join(',')
/** 형식 거부 안내 — 본문 이미지 안내(`INVALID_IMAGE_MSG`)와 같은 형식 표기. 크기 상한은 아바타만 5MB 라 따로 알린다. */
export const AVATAR_TYPE_MSG = 'PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다.'
/** 파일 크기 상한 5MB — 서버 제한과 같다. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
/** 자른 영역의 최소 변 128px — 서버 제한과 같다(작은 이미지를 늘리면 흐려진다). */
export const AVATAR_MIN_PX = 128
/** 원본 가로·세로 상한 4000px — 서버가 압축 폭탄을 막으려 디코딩 전에 거절하는 값과 같다. */
export const AVATAR_MAX_PX = 4000

/**
 * 고른 파일을 자르기 전에 검사한다 — 형식·크기가 맞지 않으면 한국어 안내, 맞으면 null.
 * 이미지 가로·세로(최소 128px)는 디코딩해야 알 수 있어 자르기 창이 이미지를 읽은 뒤 `avatarDimensionError` 로 본다.
 */
export function avatarFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return AVATAR_TYPE_MSG
  if (file.size > AVATAR_MAX_BYTES) return '5MB 이하의 이미지만 올릴 수 있습니다.'
  return null
}

/** 이미지 가로·세로 검사 — 짧은 변이 128px 보다 작거나 긴 변이 4000px 을 넘으면 안내, 아니면 null. */
export function avatarDimensionError(width: number, height: number): string | null {
  if (Math.min(width, height) < AVATAR_MIN_PX) return `가로·세로 ${AVATAR_MIN_PX}px 이상인 이미지를 골라 주세요.`
  if (Math.max(width, height) > AVATAR_MAX_PX) return `가로·세로 ${AVATAR_MAX_PX}px 이하인 이미지를 골라 주세요.`
  return null
}
