// 모바일 상세 화면 상단 뒤로가기 바 — ‹ + 모듈 제목 + 우측 ✦(AI).
// 히스토리가 없으면(딥링크) 모듈 루트로 replace. 상세에선 탭바가 숨으므로 ✦ 가 AI 진입점이다(스펙 3.9) —
// 페이지가 등록한 화면 컨텍스트(AiScreenContext)를 그대로 가진 채 풀스크린을 연다.
// 페이지가 자체 헤더(PageHeader 등)를 가지면 그 헤더가 ‹·✦ 를 품어(병합 헤더) 이 바는 그리지 않는다(ResponsiveModuleLayout).
// 모양은 병합 상세 헤더와 같다(56px·17px semibold 제목, U3-R2) — 헤더가 없는 화면(/settings 목록 등)만 흐린 작은 제목이던 차이를 없앤다.
import { MobileDetailBar } from './MobileDetailBar'

export function MobileBackBar({ title }: { title: string }) {
  return <MobileDetailBar title={title} />
}
