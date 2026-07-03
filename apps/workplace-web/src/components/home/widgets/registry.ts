import {
  AlertTriangle,
  Bell,
  CalendarDays,
  ClipboardList,
  type LucideIcon,
  Mail,
  MessageSquare,
  Sparkles,
  Zap,
} from 'lucide-react'
import { type ComponentType, lazy, type LazyExoticComponent } from 'react'

// ---------------------------------------------------------------------------
// 대시보드 레지스트리 — 고정 홈 대시보드가 사용자 저장 레이아웃 순서로 렌더한다.
// 앱 횡단(app-agnostic): 각 위젯은 자체 훅으로 데이터를 가져오는 본문 컴포넌트 + 메타.
// 키는 백엔드 화이트리스트와 일치해야 한다.
// ---------------------------------------------------------------------------

/** 대시보드 위젯 정의 — 안정 키 + 제목 + 아이콘 + 본문 컴포넌트 + 딥링크. */
export interface DashboardWidget {
  type: string
  title: string
  /** 위젯 추가 모달 프리뷰 패널에 노출되는 1줄 용도 설명. */
  description: string
  icon: LucideIcon
  // 본문은 자체 훅으로 로딩/에러를 격리 처리(한 위젯 실패가 다른 위젯에 영향 X).
  // count prop = 표시할 항목 수(3·5·10). 미지정 시 본문 기본값 5.
  // previewData 는 위젯 추가 모달 프리뷰 패널 전용(#브레인스토밍 2026-07-03) — 각 위젯이 실제로
  // 받는 타입은 제각각이라 any 로만 통과시킨다(unknown 은 구체 타입과 반공변성 충돌로 대입 불가).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: LazyExoticComponent<ComponentType<{ count?: number; previewData?: any }>>
  // 모듈 딥링크. 알림처럼 전용 라우트가 없는 위젯은 미지정 → 헤더 클릭 시 인박스 패널을 연다.
  deepLink?: string
  // 피드성 위젯은 그리드에서 2행을 차지(row-span). 게이트 §1.2: 활동/알림만 tall.
  tall?: boolean
  // #브레인스토밍 2026-07-02: 카운트 스트립·2x2 분면·가로 버튼처럼 1/3 폭에 찌그러지는 위젯용 —
  // true 면 lg:col-span-3(그리드 전체 폭). tall 과 독립적으로 조합 가능.
  wide?: boolean
}

// 키 → 위젯 정의. 새 위젯 추가 = 항목 한 줄.
// 딥링크는 App.tsx 라우트에서 검증: /me/tasks/assigned · /calendar · /chat · /mail.
// 알림은 전용 라우트가 없어 deepLink 미지정 → 헤더 클릭 시 인박스 패널(Popover)을 연다(#274).
const dashboardRegistry: Record<string, DashboardWidget> = {
  my_tasks: {
    type: 'my_tasks',
    title: '내 작업',
    description: '마감·차단·진행 중인 내 작업을 우선순위별로 보여줍니다.',
    icon: ClipboardList,
    Component: lazy(() => import('./dashboard/MyTasksBody')),
    deepLink: '/me/tasks/assigned',
  },
  calendar_today: {
    type: 'calendar_today',
    title: '오늘 일정',
    description: '오늘 예정된 일정을 시간순으로 보여줍니다.',
    icon: CalendarDays,
    Component: lazy(() => import('./dashboard/CalendarTodayBody')),
    deepLink: '/calendar',
  },
  notifications: {
    type: 'notifications',
    title: '알림',
    description: '내 차례인 항목과 최근 업데이트 알림을 보여줍니다.',
    icon: Bell,
    Component: lazy(() => import('./dashboard/NotificationsBody')),
    // 활동/알림은 피드성 → 2행 span(게이트 §1.2). 그 외 위젯은 standard.
    tall: true,
  },
  recent_chats: {
    type: 'recent_chats',
    title: '대화',
    description: '최근 대화 목록과 회신 필요 여부를 보여줍니다.',
    icon: MessageSquare,
    Component: lazy(() => import('./dashboard/ConversationsBody')),
    deepLink: '/chat',
  },
  unread_mail: {
    type: 'unread_mail',
    title: '메일',
    description: '읽지 않은 메일과 회신 필요 메일을 보여줍니다.',
    icon: Mail,
    Component: lazy(() => import('./dashboard/UnreadMailBody')),
    deepLink: '/mail',
  },
  synthesis: {
    type: 'synthesis',
    title: '요약',
    description: '지금 신경 써야 할 일들을 한눈에 요약해 보여줍니다.',
    icon: AlertTriangle,
    Component: lazy(() => import('./dashboard/SynthesisBody')),
    wide: true,
  },
  quick_actions: {
    type: 'quick_actions',
    title: '빠른 액션',
    description: '새 이슈·메일·대화를 바로 시작하는 버튼 모음입니다.',
    // Plus 아이콘은 "액션 추가" 버튼처럼 보여 혼동을 준다는 피드백 → Zap(번개, 빠른 액션 의미)으로 교체.
    icon: Zap,
    Component: lazy(() => import('./dashboard/QuickActionsBody')),
    wide: true,
  },
  priority_quadrant: {
    type: 'priority_quadrant',
    title: 'AI 우선순위',
    description: '중요도·긴급도 기준 4분면으로 할 일을 정리해 보여줍니다.',
    icon: Sparkles,
    Component: lazy(() => import('./dashboard/PriorityQuadrantBody')),
    wide: true,
  },
}

/** 키로 대시보드 위젯 정의 조회. 알 수 없는/제거된 키는 null(대시보드가 무시). */
export function getDashboardWidget(type: string): DashboardWidget | null {
  return dashboardRegistry[type] ?? null
}

/** 등록된 전체 위젯 정의(레지스트리 선언 순서). 편집 모드의 '추가 가능한 위젯' 갤러리가 사용. */
export function allDashboardWidgets(): DashboardWidget[] {
  return Object.values(dashboardRegistry)
}
