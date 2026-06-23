import type { DriveSpace } from '../types/drive'

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
