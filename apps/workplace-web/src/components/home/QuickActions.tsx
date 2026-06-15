// ② 빠른 액션 행 — 게이트 §1. 각 버튼은 실제 기존 라우트/액션으로 연결(데드 버튼 금지).
//   - 새 이슈   → /projects (이슈 생성은 프로젝트 스코프 다이얼로그라 전역 생성 라우트 없음 → 모듈 진입)
//   - 메일 작성 → /mail (작성 도크는 메일 모듈의 계정 컨텍스트가 필요 → 메일함 진입)
//   - 새 대화   → /chat/new (전용 라우트 존재)
//   - 검색 ⌘K  → 별도 커맨드 팔레트가 없어 버튼 생략(⌘K 는 이미 AI 어시스턴트 전역 토글).
import { Mail, MessageSquarePlus, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

// 빠른 액션 정의 — 라벨/아이콘/대상 라우트.
const ACTIONS = [
  { label: '새 이슈', icon: Plus, to: '/projects' },
  { label: '메일 작성', icon: Mail, to: '/mail' },
  { label: '새 대화', icon: MessageSquarePlus, to: '/chat/new' },
] as const

/** ② 빠른 액션 행 — 모듈 생성 흐름으로 진입하는 버튼들(전부 실제 타깃). */
export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2" data-testid="dashboard-quickactions">
      {ACTIONS.map((a) => (
        <Button key={a.label} asChild variant="outline" size="sm">
          <Link to={a.to} aria-label={a.label}>
            <a.icon className="h-4 w-4" />
            {a.label}
          </Link>
        </Button>
      ))}
    </div>
  )
}
