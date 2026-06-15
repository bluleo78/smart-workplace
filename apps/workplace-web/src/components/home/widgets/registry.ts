import {
  Bell,
  CalendarDays,
  ClipboardList,
  type LucideIcon,
  Mail,
  MessageSquare,
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
  icon: LucideIcon
  // 본문은 자체 훅으로 로딩/에러를 격리 처리(한 위젯 실패가 다른 위젯에 영향 X).
  // count prop = 표시할 항목 수(3·5·10). 미지정 시 본문 기본값 5.
  Component: LazyExoticComponent<ComponentType<{ count?: number }>>
  deepLink: string
  // 피드성 위젯은 그리드에서 2행을 차지(row-span). 게이트 §1.2: 활동/알림만 tall.
  tall?: boolean
}

// 키 → 위젯 정의. 새 위젯 추가 = 항목 한 줄.
// 딥링크는 App.tsx 라우트에서 검증: /me/tasks/assigned · /calendar · /chat · /mail.
// 알림은 전용 라우트가 없어(인박스 패널) 가장 합당한 기존 대상으로 /me/tasks/assigned 사용.
const dashboardRegistry: Record<string, DashboardWidget> = {
  my_tasks: {
    type: 'my_tasks',
    title: '내 작업',
    icon: ClipboardList,
    Component: lazy(() => import('./dashboard/MyTasksBody')),
    deepLink: '/me/tasks/assigned',
  },
  calendar_today: {
    type: 'calendar_today',
    title: '오늘 일정',
    icon: CalendarDays,
    Component: lazy(() => import('./dashboard/CalendarTodayBody')),
    deepLink: '/calendar',
  },
  notifications: {
    type: 'notifications',
    title: '알림',
    icon: Bell,
    Component: lazy(() => import('./dashboard/NotificationsBody')),
    deepLink: '/me/tasks/assigned',
    // 활동/알림은 피드성 → 2행 span(게이트 §1.2). 그 외 위젯은 standard.
    tall: true,
  },
  recent_chats: {
    type: 'recent_chats',
    title: '최근 대화',
    icon: MessageSquare,
    Component: lazy(() => import('./dashboard/RecentChatsBody')),
    deepLink: '/chat',
  },
  unread_mail: {
    type: 'unread_mail',
    title: '안 읽은 메일',
    icon: Mail,
    Component: lazy(() => import('./dashboard/UnreadMailBody')),
    deepLink: '/mail',
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
