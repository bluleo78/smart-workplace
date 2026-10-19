import type { DriveSpace, DriveSpaceType } from '../types/drive'

/** 드라이브 space 유형의 화면 표기(WP-522) — 영문 enum 코드를 그대로 보이지 않게 한다. */
const SPACE_TYPE_LABEL: Record<DriveSpaceType, string> = { PERSONAL: '개인', TEAM: '팀', CHANNEL: '채널' }

export function driveSpaceTypeLabel(type: DriveSpaceType): string {
  return SPACE_TYPE_LABEL[type] ?? type
}

/**
 * 드라이브 space 목록을 사이드바 표시용 두 그룹으로 분리한다.
 * 채널 연동 space(type==='CHANNEL')는 내 드라이브·팀과 동급 피어가 아니므로
 * '채널' 섹션으로 따로 묶는다. 입력 순서는 보존한다.
 */
export function partitionSpaces(spaces: DriveSpace[]): {
  primary: DriveSpace[]
  channel: DriveSpace[]
} {
  const primary: DriveSpace[] = []
  const channel: DriveSpace[] = []
  for (const s of spaces) {
    if (s.type === 'CHANNEL') channel.push(s)
    else primary.push(s)
  }
  return { primary, channel }
}

/**
 * 사이드바 공간 행에 이름 변경/삭제 ⋯ 메뉴를 보일지 — TEAM 공간의 OWNER 만.
 * 개인 공간은 이름·삭제 대상이 아니고, 채널 연동 공간은 채널 수명주기를 따른다.
 */
export function canManageDriveSpace(space: Pick<DriveSpace, 'type' | 'role'>): boolean {
  return space.type === 'TEAM' && space.role === 'OWNER'
}
