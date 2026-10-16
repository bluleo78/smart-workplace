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
