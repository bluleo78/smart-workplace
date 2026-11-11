// 도움말 패널 기억(WP-1505) — 열림(사용자·워크스페이스별)·폭·위아래 비율(브라우저 전역).
// 열림은 다음 사용자에게 물려주면 안 되는 개인 설정이라 userScopedKey 로, 폭·비율은 AI 패널 폭(ai-side-width)처럼 화면 배치라 전역으로 둔다.
// 저장소가 막혔으면 이 탭에서만 기억한다(storageWithFallback).
import { clampWidth } from '@/lib/clampWidth'
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { type StorageOwner, userScopedKey } from '@/lib/userScopedKey'

/** 도움말 패널 폭 범위·기본값 — AI 사이드 패널(320~600)과 같은 범위, 기본은 읽기 폭을 생각해 360. */
export const HELP_MIN_WIDTH = 320
export const HELP_MAX_WIDTH = 600
export const HELP_DEFAULT_WIDTH = 360

/** 도움말·AI 가 위아래로 쌓일 때 도움말이 차지하는 높이 비율 — 기본 반반, 어느 쪽도 너무 작아지지 않게 0.2~0.8. */
export const HELP_SPLIT_DEFAULT = 0.5
export const HELP_SPLIT_MIN = 0.2
export const HELP_SPLIT_MAX = 0.8

const OPEN_BASE = 'help-panel-open'
const WIDTH_KEY = 'help-panel-width'
const SPLIT_KEY = 'help-dock-split'

/** 열림 저장 키. 로그인 전(owner 없음)은 null — 누구의 기억도 읽거나 쓰지 않는다. */
export function helpOpenKey(owner: StorageOwner | null): string | null {
  return owner ? userScopedKey(OPEN_BASE, owner) : null
}

/** 기억한 열림 — 기억이 없거나 키가 없으면 닫힘. */
export function readHelpOpen(key: string | null): boolean {
  return key !== null && readStored(key) === '1'
}

/** 열림을 기억한다(닫힘은 지워 기본값으로). */
export function writeHelpOpen(key: string | null, open: boolean): void {
  if (key) writeStored(key, open ? '1' : null)
}

/** 폭을 범위 안 정수 px 로. */
export function clampHelpWidth(width: number): number {
  return clampWidth(width, HELP_MIN_WIDTH, HELP_MAX_WIDTH)
}

/** 비율을 범위 안으로. */
export function clampHelpSplit(ratio: number): number {
  return Math.min(HELP_SPLIT_MAX, Math.max(HELP_SPLIT_MIN, ratio))
}

/** 기억한 숫자 — 없거나 깨진 값이면 기본값, 범위 밖이면 clamp 로 범위 안으로. */
function readClamped(key: string, clamp: (n: number) => number, fallback: number): number {
  const raw = readStored(key)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? clamp(n) : fallback
}

/** 기억한 폭 — 없거나 깨진 값이면 기본 폭, 범위 밖이면 범위 안으로. */
export function readHelpWidth(): number {
  return readClamped(WIDTH_KEY, clampHelpWidth, HELP_DEFAULT_WIDTH)
}

/** 폭을 기억한다 — 범위 맞춤은 부르는 쪽(HelpPanelContext.resize)이 이미 했다. */
export function writeHelpWidth(width: number): void {
  writeStored(WIDTH_KEY, String(width))
}

/** 기억한 위아래 비율 — 없거나 깨진 값이면 기본 비율, 범위 밖이면 범위 안으로. */
export function readHelpSplit(): number {
  return readClamped(SPLIT_KEY, clampHelpSplit, HELP_SPLIT_DEFAULT)
}

/** 비율을 기억한다 — 범위 맞춤은 부르는 쪽(HelpPanelContext.setSplit)이 이미 했다. */
export function writeHelpSplit(ratio: number): void {
  writeStored(SPLIT_KEY, String(ratio))
}
