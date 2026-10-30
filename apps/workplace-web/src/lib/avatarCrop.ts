// 아바타 자르기 기하(WP-1222) — 자르기 창(AvatarCropDialog)의 끌기·확대를 원본 이미지 픽셀의 정사각 영역으로 바꾼다.
// 화면은 원(지름 D, CSS px) 뒤로 이미지를 옮기고 키울 뿐이고, 서버에는 원본 파일 + 원이 덮은 정사각(cropX·cropY·cropSize)을 보낸다.
// 좌표 약속: offset 은 「원의 왼쪽 위」에서 본 「이미지 왼쪽 위」 위치(CSS px). 원이 늘 이미지 안에 있으려면 offset ≤ 0 이고
// offset + 이미지 표시 크기 ≥ D 다. scale 은 원본 1px 이 화면 몇 px 인지(= coverScale × zoom).

import type { AvatarCrop } from '@/types/avatar'

import { AVATAR_MIN_PX } from './avatarImage'

export interface Point {
  x: number
  y: number
}

/** 이미지 원본 크기(px). */
export interface ImageSize {
  width: number
  height: number
}

/** 확대 상한 — 아무리 큰 이미지라도 4배까지(그 이상은 끌기 손맛이 너무 예민하다). */
const ZOOM_CAP = 4

/** 확대 1배의 배율 — 이미지의 짧은 변이 원 지름을 꼭 채운다(원 안에 빈 곳이 생기지 않는 가장 작은 배율). */
export function coverScale(img: ImageSize, diameter: number): number {
  return diameter / Math.min(img.width, img.height)
}

/**
 * 확대 상한 — 자른 영역의 변이 128px(서버 최소) 밑으로 내려가지 않는 데까지, 최대 4배.
 * 짧은 변이 128px 인 이미지는 1배에서 더 키울 수 없다(1 을 돌려준다).
 */
export function maxZoom(img: ImageSize): number {
  return Math.max(1, Math.min(ZOOM_CAP, Math.min(img.width, img.height) / AVATAR_MIN_PX))
}

/** 확대를 [1, maxZoom] 안으로 묶는다. */
export function clampZoom(zoom: number, img: ImageSize): number {
  return Math.min(maxZoom(img), Math.max(1, zoom))
}

/** 이미지가 원을 늘 덮도록 offset 을 묶는다 — 원 밖으로 이미지 가장자리가 들어오지 않게. */
export function clampOffset(offset: Point, img: ImageSize, scale: number, diameter: number): Point {
  const minX = diameter - img.width * scale
  const minY = diameter - img.height * scale
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  }
}

/** 이미지를 원 가운데에 둔 offset — 처음 열 때 쓴다. */
export function centeredOffset(img: ImageSize, scale: number, diameter: number): Point {
  return { x: (diameter - img.width * scale) / 2, y: (diameter - img.height * scale) / 2 }
}

/**
 * 배율을 바꿀 때 원 가운데가 가리키던 이미지 지점을 그대로 두는 offset — 슬라이더·휠로 확대해도 보던 곳이 달아나지 않게.
 * 결과는 이미지가 원을 덮도록 다시 묶는다(축소하면 가장자리가 들어올 수 있다).
 */
export function zoomAroundCenter(offset: Point, oldScale: number, newScale: number, img: ImageSize, diameter: number): Point {
  const c = diameter / 2
  const px = (c - offset.x) / oldScale
  const py = (c - offset.y) / oldScale
  return clampOffset({ x: c - px * newScale, y: c - py * newScale }, img, newScale, diameter)
}

/**
 * 화면 상태 → 서버에 보낼 자른 영역(원본 픽셀, 정수). 원이 덮은 정사각을 원본 좌표로 되돌린다.
 * 반올림으로 이미지 밖으로 1px 나가면 서버가 400 을 주므로 변은 내림, 위치는 반올림 뒤 이미지 안으로 다시 묶는다.
 */
export function cropFromView(offset: Point, scale: number, img: ImageSize, diameter: number): AvatarCrop {
  const shortSide = Math.min(img.width, img.height)
  // 1e-6: 최대 확대에서 128 이 부동소수 오차로 127.999… 이 되어 내림에 127 로 떨어지지 않게. 아래 한도는 서버 최소(128)를 지킨다.
  const cropSize = Math.max(Math.min(AVATAR_MIN_PX, shortSide), Math.min(shortSide, Math.floor(diameter / scale + 1e-6)))
  const clampPos = (v: number, limit: number) => Math.min(limit - cropSize, Math.max(0, Math.round(v)))
  return {
    cropX: clampPos(-offset.x / scale, img.width),
    cropY: clampPos(-offset.y / scale, img.height),
    cropSize,
  }
}
