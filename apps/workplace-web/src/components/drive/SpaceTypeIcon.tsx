import { User, Users } from 'lucide-react'

import type { DriveSpaceType } from '../../types/drive'

/**
 * 공간 종류 아이콘(WP-143·WP-1526) — 개인(또는 아직 모름 = type 없음)은 User, 그 밖의 공유 공간은 Users.
 * 사이드바 행·저장 창이 함께 쓴다. 크기·색은 className, 테스트 식별은 data-testid 로 호출부가 정한다.
 */
export function SpaceTypeIcon({
  type,
  className,
  'data-testid': testId,
}: {
  type: DriveSpaceType | undefined
  className?: string
  'data-testid'?: string
}) {
  const Icon = type && type !== 'PERSONAL' ? Users : User
  return <Icon className={className} data-testid={testId} aria-hidden />
}
