// 드라이브 파일 행 작업의 비활성 판정 — 휴대폰 ⋮ 시트·터치 태블릿 ⋯·데스크톱 hover 묶음이 모두 같은 목록을 쓴다(WP-363).
// 판정을 DrivePage 안에서 꺼내 단위 테스트로 지킨다(WP-413 — 비활성만 보던 E2E 를 대체).

/** 파일 행 작업 key. */
export type DriveFileActionKey = 'download' | 'share' | 'rename' | 'move' | 'copy' | 'versions' | 'delete'

/**
 * 파일 행 작업별 비활성 여부.
 * - 보관된 공간: 쓰기 작업(이름 변경·이동·복사·삭제) 차단.
 * - 원본 유실(missing, #739): 바이트가 필요한 작업(다운로드·공유·복사) 차단. 이동은 메타데이터만 바꾸므로 허용.
 * - 버전 이력은 읽기라 항상 허용.
 */
export function driveFileActionDisabled({
  archived,
  missing,
}: {
  archived: boolean
  missing: boolean
}): Record<DriveFileActionKey, boolean> {
  return {
    download: missing,
    share: missing,
    rename: archived,
    move: archived,
    copy: archived || missing,
    versions: false,
    delete: archived,
  }
}

/** 읽기 권한만으로 되는 행 작업 — VIEWER 에게는 이것만 보인다(WP-602). 공유 링크·복사도 서버가 EDITOR 를 요구한다. */
const DRIVE_READ_ACTIONS: ReadonlySet<string> = new Set<DriveFileActionKey>(['download', 'versions'])

/**
 * 내 역할로 고른 행 작업 목록(WP-602). 읽기 전용(VIEWER)이면 다운로드·버전 이력만 남기고, 폴더는 빈 목록(⋯ 자체를 감춘다).
 * 쓰기 작업을 비활성으로 두지 않고 감추는 것은 보관(archived)과 달리 역할은 바뀌지 않는 한 계속 못 쓰기 때문이다.
 */
export function visibleDriveRowActions<T extends { key: string }>(actions: T[], readOnlyRole: boolean): T[] {
  return readOnlyRole ? actions.filter((a) => DRIVE_READ_ACTIONS.has(a.key)) : actions
}

/** 이 드라이브 공간에서 내 역할이 읽기 전용(VIEWER)인지(WP-602). 공간 정보를 아직 못 받았으면 거짓 — 서버가 어차피 막는다. */
export function isDriveViewer(space: { role: string } | null | undefined): boolean {
  return space?.role === 'VIEWER'
}
