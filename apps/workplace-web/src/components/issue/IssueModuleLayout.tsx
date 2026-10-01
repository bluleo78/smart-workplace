// 이슈 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'

import { IssueSidebar } from './IssueSidebar'

export function IssueModuleLayout() {
  // title 은 모바일 전용(목록 큰 제목·뒤로가기 바) — 탭 라벨 "작업" 과 맞춘다(U1-8). 데스크톱 사이드바 제목("작업 관리")은 IssueSidebar 소관.
  return <ResponsiveModuleLayout sidebar={<IssueSidebar />} rootPath="/tasks" title="작업" />
}
