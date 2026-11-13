// 「공유받은 항목」(WP-1539) 화면의 순수 판정 — 화면과 떼어 vitest 로 지킨다.
import type { SharedWithMeItem } from '@/types/drive'

import { formatFileSize, kstDayRelative, kstParts, parseUtcDate } from './formatters'

/**
 * 「마지막으로 연 날」 칸 — 오늘·어제는 그 말로, 그 밖은 「11월 12일」(올해가 아니면 「2025년 11월 12일」).
 * 오늘·어제 판정과 날짜를 모두 KST(Asia/Seoul) 하나로 본다 — 섞으면 자정 무렵 「어제」 다음 칸이 하루 어긋난다.
 * 시각까지는 보이지 않는다 — 다시 찾는 데는 날이면 충분하고 좁은 칸에 들어가야 해서. 무효 입력이면 빈 문자열.
 */
export function sharedOpenedLabel(at: string, now: Date = new Date()): string {
  const date = parseUtcDate(at)
  if (Number.isNaN(date.getTime())) return ''
  const t = kstParts(date)
  const rel = kstDayRelative(t, now)
  if (rel) return rel === 'today' ? '오늘' : '어제'
  const md = `${t.m}월 ${t.d}일`
  return t.y === kstParts(now).y ? md : `${t.y}년 ${md}`
}

/** 서버가 링크 폐기·만료·휴지통으로 열 수 없다고 한 행의 안내 — 목록 행 둘째 줄·열기 실패 토스트·폴더 화면 막힌 상태가 같은 문구를 쓴다. */
export const SHARED_CLOSED_MESSAGE = '링크가 폐기됐거나 만료됐습니다'

/** 열 수 있는 행 — 서버가 열 수 있다고 했고 열 토큰이 있다. */
export type OpenableSharedItem = SharedWithMeItem & { openable: true; token: string }

/**
 * 지금 열 수 있는 행인가 — 서버가 링크(폐기·만료)와 파일(휴지통)로 판정한 openable 을 따르고, 열 토큰이 있어야 한다.
 * 토큰이 없으면(되살릴 수 없는 옛 링크) 열기·복사를 막는다. 열 수 있어도 실제 접근은 열 때 링크로 다시 판정한다.
 */
export function canOpenShared(item: SharedWithMeItem): item is OpenableSharedItem {
  return item.openable && item.token != null
}

/**
 * 행을 열면 무엇을 하나 — 목록의 「열기」와 드라이브 안 폴더 화면의 진입 판정이 같은 규칙을 쓰도록 한곳에 둔다.
 * - closed: 열 수 없음(이유 문구와 함께) — 정보를 묻지 않는다.
 * - password: 비밀번호 링크 — 열람 토큰은 공유 화면 메모리에만 두는 규칙이라 공유 화면(/s/:token)으로 넘긴다.
 * - folder: 폴더 링크 — 드라이브 안 읽기 전용 폴더 화면(path)으로 간다.
 * - file: 파일 링크 — 공유 정보를 물어 이 자리에서 미리보기로 연다.
 */
export type SharedTarget =
  | { kind: 'closed'; reason: string }
  | { kind: 'password'; token: string }
  | { kind: 'folder'; token: string; path: string }
  | { kind: 'file'; token: string }

/** 행 → 여는 방법({@link SharedTarget}). */
export function resolveSharedTarget(item: SharedWithMeItem): SharedTarget {
  if (!canOpenShared(item)) {
    // 서버가 열 수 없다고 했을 때만 폐기·만료라고 말하고, 링크는 살아 있는데 토큰을 되살리지 못한 경우(키 교체 등)는 중립 문구로 둔다.
    return { kind: 'closed', reason: item.openable ? '링크를 열 수 없습니다' : SHARED_CLOSED_MESSAGE }
  }
  if (item.hasPassword) return { kind: 'password', token: item.token }
  if (item.kind === 'FOLDER') return { kind: 'folder', token: item.token, path: sharedFolderPath(item.shareLinkId, null) }
  return { kind: 'file', token: item.token }
}

/** 열 수 없는 행의 이유 문구 — 열 수 있으면 null. */
export function sharedClosedReason(item: SharedWithMeItem): string | null {
  const target = resolveSharedTarget(item)
  return target.kind === 'closed' ? target.reason : null
}

/**
 * 목록 행 둘째 줄 — 열 수 없으면 이유 문구 그대로, 폴더면 「공간 · 폴더 n개 · 파일 n개」(수가 없으면 0),
 * 파일이면 「공간 · 크기」. 폴더 수는 열 수 있는 행에만 오므로 null 은 0 으로 본다.
 */
export function sharedMetaLine(item: SharedWithMeItem): string {
  const closed = sharedClosedReason(item)
  if (closed) return closed
  if (item.kind === 'FOLDER') {
    return `${item.spaceName} · 폴더 ${item.folderCount ?? 0}개 · 파일 ${item.fileCount ?? 0}개`
  }
  return `${item.spaceName} · ${formatFileSize(item.sizeBytes ?? 0)}`
}

/**
 * 드라이브 안 공유 폴더 화면 주소 — 공유 폴더 자체는 `/drive/shared/11`, 하위 폴더는 `?folder=42` 를 붙인다.
 */
export function sharedFolderPath(shareLinkId: number, folderId: number | null): string {
  const base = `/drive/shared/${shareLinkId}`
  return folderId == null ? base : `${base}?folder=${folderId}`
}
