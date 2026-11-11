// 프로젝트 탭 레이아웃 → 탭 화면 컨텍스트(WP-1477).
// 프로젝트는 레이아웃이 한 번 불러와 개인·팀 모든 분기의 탭 화면에 넘긴다(탭 화면이 같은 쿼리·로딩·오류 분기를 다시 두지 않게).
// 머리줄의 「+ 새 태스크」 대화상자는 레이아웃이 하나만 두고, 이슈 탭 보드 컬럼의 「이슈 추가」도 같은 대화상자를 열게 한다.
import { createContext, useContext } from 'react'

import type { ProjectResponse } from '@/types/project'

/** 레이아웃이 탭 화면에 넘기는 값 — 불러온 프로젝트(개인·팀)와 새 태스크 대화상자 열기. */
export interface ProjectTabsValue {
  project: ProjectResponse
  /** 새 태스크 대화상자를 연다. statusId 를 주면 그 상태로 시작한다(보드 컬럼의 「이슈 추가」). 대화상자는 팀 프로젝트에만 있다. */
  openCreate: (statusId?: number) => void
}

export const ProjectTabsContext = createContext<ProjectTabsValue | null>(null)

/** 탭 화면에서 레이아웃 값을 읽는다 — 레이아웃 밖(프로젝트 탭 길이 아닌 곳)에서 부르면 배선 실수라 바로 알린다. */
export function useProjectTabs(): ProjectTabsValue {
  const value = useContext(ProjectTabsContext)
  if (!value) throw new Error('useProjectTabs 는 ProjectTabsLayout 안에서만 쓸 수 있습니다')
  return value
}
