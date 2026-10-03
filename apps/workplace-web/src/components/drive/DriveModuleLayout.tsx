import { useMemo } from 'react'

import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileDriveListClass } from '@/components/mobile/sidebarListClass'
import { useDriveSpaces } from '@/hooks/queries/useDriveSpaces'
import { buildDriveSpacesContext } from '@/lib/aiScreenContext/builders/mobileLists'

import { DriveSidebar } from './DriveSidebar'

/**
 * 드라이브 모듈 레이아웃 — 좌측 공간 목록 + Outlet(폴더 브라우저).
 * 모바일 목록 모드는 채팅 목록 규격에 머리말 여백·글자를 맞춘다(U3-R5, 데스크톱엔 쓰이지 않음).
 */
export function DriveModuleLayout() {
  // WP-191: 모바일 공간 목록의 화면 컨텍스트(쿼리는 사이드바와 캐시 공유).
  const { data: spaces } = useDriveSpaces()
  const listCtx = useMemo(() => buildDriveSpacesContext({ spaces: (spaces ?? []).map((s) => s.name) }), [spaces])
  return (
    <ResponsiveModuleLayout
      sidebar={<DriveSidebar />}
      rootPath="/drive"
      title="드라이브"
      listClassName={mobileDriveListClass}
      listScreenContext={listCtx}
    />
  )
}
