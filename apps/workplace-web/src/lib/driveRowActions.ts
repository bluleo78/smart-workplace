// 드라이브 파일 행 작업의 비활성 판정 — 휴대폰 ⋮ 시트·터치 태블릿 ⋯·데스크톱 hover 묶음이 모두 같은 목록을 쓴다(WP-363).
// 판정을 DrivePage 안에서 꺼내 단위 테스트로 지킨다(WP-413 — 비활성만 보던 E2E 를 대체).
import type { DriveSpace } from '../types/drive'
import { isDriveSpaceReadOnly, isDriveSpaceViewer } from './driveSpaces'

/** 원본 유실 파일(#739)을 열려 할 때의 안내 — 공간 화면과 「별표」 화면이 같은 문구를 쓴다. */
export const DRIVE_MISSING_ORIGINAL_MESSAGE = '이 파일의 원본이 유실되어 열거나 내려받을 수 없습니다.'

/** 원본 유실 파일인가(#739) — 서버가 available=false 로 알린 것만. 값이 없으면(옛 응답·폴더) 유실 아님으로 본다. */
export function isDriveOriginalMissing(f: { available?: boolean | null }): boolean {
  return f.available === false
}

/** 파일 행 작업 key. */
export type DriveFileActionKey = 'download' | 'share' | 'rename' | 'move' | 'copy' | 'versions' | 'delete'

/** 링크 작업 key(WP-1236) — 구성원용 앱 링크 복사·앱 안으로 보내기. 볼 수 있으면 누구나(VIEWER 포함) 쓴다. */
export type DriveLinkActionKey = 'copy-link' | 'send-to-chat'

/** 별표 작업 key(WP-1698) — 「별표」/「별표 빼기」. 내 목록에만 쓰고 공간 내용을 바꾸지 않아 볼 수 있으면 누구나(VIEWER·보관 공간 포함) 쓴다. */
export type DriveStarActionKey = 'star'

/**
 * 파일 행 작업별 비활성 여부.
 * - 보관된 채널 공간이거나 내 역할이 보기 전용(WP-582): 쓰기 작업(이름 변경·이동·복사·삭제) 차단.
 * - 보기 전용 역할: 공유 링크도 차단 — 서버가 편집자 이상만 링크를 만들고 보게 한다. 보관 공간(편집자)은 이미 나간 링크를 끊으려 열어 둔다.
 * - 원본 유실(missing, #739): 바이트가 필요한 작업(다운로드·공유·복사) 차단. 이동은 메타데이터만 바꾸므로 허용.
 * - 버전 이력은 읽기라 항상 허용.
 */
export function driveFileActionDisabled({
  space,
  missing,
}: {
  space: Pick<DriveSpace, 'archived' | 'role'> | null | undefined
  missing: boolean
}): Record<DriveFileActionKey, boolean> {
  const readOnly = isDriveSpaceReadOnly(space)
  return {
    download: missing,
    share: missing || isDriveSpaceViewer(space),
    rename: readOnly,
    move: readOnly,
    copy: readOnly || missing,
    versions: false,
    delete: readOnly,
  }
}

/**
 * 폴더 행 작업별 비활성 여부(WP-1538).
 * - 공유 링크는 파일과 같은 규칙: 보기 전용 역할만 막고(실제로는 visibleDriveRowActions 가 감춤), 보관 공간은 열어 둔다 — 모달이 새 링크 불가를 안내하고 기존 링크 폐기는 된다.
 * - 이름 변경·이동·복사·삭제는 읽기 전용(보관·보기 전용)이면 막는다.
 */
export function driveFolderActionDisabled({
  space,
}: {
  space: Pick<DriveSpace, 'archived' | 'role'> | null | undefined
}): Record<'share' | 'rename' | 'move' | 'copy' | 'delete', boolean> {
  const readOnly = isDriveSpaceReadOnly(space)
  return { share: isDriveSpaceViewer(space), rename: readOnly, move: readOnly, copy: readOnly, delete: readOnly }
}

/**
 * 읽기 권한만으로 되는 행 작업 — VIEWER 에게는 이것만 보인다(WP-602). 공유 링크·복사도 서버가 EDITOR 를 요구한다.
 * 링크 복사·채팅·이슈로 보내기(WP-1236)는 구성원용 앱 링크라 볼 수 있으면 된다(외부 공유 링크와 다르다). 별표(WP-1698)도 내 목록만 바꿔 같다.
 */
const DRIVE_READ_ACTIONS: ReadonlySet<string> = new Set<DriveFileActionKey | DriveLinkActionKey | DriveStarActionKey>([
  'download',
  'copy-link',
  'send-to-chat',
  'versions',
  'star',
])

/**
 * 내 역할로 고른 행 작업 목록(WP-602). 읽기 전용(VIEWER)이면 다운로드·링크·버전 이력만 남기고, 폴더는 링크 작업만 남는다.
 * 쓰기 작업을 비활성으로 두지 않고 감추는 것은 보관(archived)과 달리 역할은 바뀌지 않는 한 계속 못 쓰기 때문이다.
 */
export function visibleDriveRowActions<T extends { key: string }>(actions: T[], readOnlyRole: boolean): T[] {
  return readOnlyRole ? actions.filter((a) => DRIVE_READ_ACTIONS.has(a.key)) : actions
}

/** 이 드라이브 공간에서 내 역할이 읽기 전용(VIEWER)인지(WP-602). 공간 정보를 아직 못 받았으면 거짓 — 서버가 어차피 막는다. */
export function isDriveViewer(space: { role: string } | null | undefined): boolean {
  return space?.role === 'VIEWER'
}
