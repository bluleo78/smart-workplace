import type { DriveSpace, DriveSpaceType } from '../types/drive'
import { canEditSpaceRole } from './spaceRoles'

/** 드라이브 space 유형의 화면 표기(WP-522) — 영문 enum 코드를 그대로 보이지 않게 한다. */
const SPACE_TYPE_LABEL: Record<DriveSpaceType, string> = { PERSONAL: '개인', TEAM: '팀', CHANNEL: '채널' }

export function driveSpaceTypeLabel(type: DriveSpaceType): string {
  return SPACE_TYPE_LABEL[type] ?? type
}

/**
 * 공간의 화면 이름 — 개인 공간은 서버 이름과 상관없이 「내 드라이브」로 보인다(사이드바와 같은 표기).
 * 왜 한 곳에: 사이드바·「드라이브에 저장」 성공 토스트(WP-1525) 등 여러 화면이 같은 이름을 보이도록.
 */
export function spaceDisplayName(space: Pick<DriveSpace, 'type' | 'name'>): string {
  return space.type === 'PERSONAL' ? '내 드라이브' : space.name
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
 * 사이드바 공간 행 ⋯ 에 이름 변경/삭제 항목을 보일지 — TEAM 공간의 OWNER 만(「멤버」는 hasDriveSpaceMembers).
 * 개인 공간은 이름·삭제 대상이 아니고, 채널 연동 공간은 채널 수명주기를 따른다.
 */
export function canManageDriveSpace(space: Pick<DriveSpace, 'type' | 'role'>): boolean {
  return space.type === 'TEAM' && space.role === 'OWNER'
}

/**
 * 사이드바 공간 행 ⋯ 의 「멤버」를 보일지(WP-582) — TEAM 공간이면 역할과 상관없이 보인다(명단은 모든 멤버가 보고, 바꾸는 건 OWNER).
 * 개인 공간은 나 혼자이고, 채널 연동 공간은 채널 멤버를 따른다.
 */
export function hasDriveSpaceMembers(space: Pick<DriveSpace, 'type'>): boolean {
  return space.type === 'TEAM'
}

/** 내 역할이 보기 전용이라 내용을 바꿀 수 없는지(WP-582). 보관 여부와는 따로 본다 — 공유 링크처럼 둘의 처리가 다른 동작이 있다. */
export function isDriveSpaceViewer(space: Pick<DriveSpace, 'role'> | null | undefined): boolean {
  return !!space && !canEditSpaceRole(space.role)
}

/** 공간이 읽기 전용인지 — 보관된 채널 공간이거나 내 역할이 보기 전용이면 쓰기 동작을 막는다(WP-582). */
export function isDriveSpaceReadOnly(space: Pick<DriveSpace, 'archived' | 'role'> | null | undefined): boolean {
  return !!space && (space.archived || isDriveSpaceViewer(space))
}

/** 「드라이브에 저장」 후보 공간 그룹 — 개인(내 드라이브)과 팀(채널이 아닌 나머지 공유 공간). */
export interface SaveTargetSpaces {
  personal: DriveSpace[]
  team: DriveSpace[]
  /** personal + team 을 이은 전체 후보 — 합치기를 호출부마다 되풀이하지 않게 여기서 한 번만 만든다. */
  all: DriveSpace[]
}

/**
 * 「드라이브에 저장」 대상으로 고를 수 있는 공간(WP-1526) — 채널 연동 공간과 읽기 전용(보관·보기 전용) 공간은 뺀다.
 * 공간 분류를 이 한 곳에서 한다: personal = PERSONAL, team = PERSONAL·CHANNEL 이 아닌 모든 공간. 각 그룹은 입력 순서를 유지한다.
 */
export function saveTargetSpaces(spaces: DriveSpace[]): SaveTargetSpaces {
  const usable = spaces.filter((s) => s.type !== 'CHANNEL' && !isDriveSpaceReadOnly(s))
  const personal = usable.filter((s) => s.type === 'PERSONAL')
  const team = usable.filter((s) => s.type !== 'PERSONAL')
  return { personal, team, all: [...personal, ...team] }
}
