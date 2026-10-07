import { Ban, CloudUpload, Eye, Loader2, LogIn, RefreshCw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

import type { SyncStatus } from '../../lib/collab/collabStatus'

/**
 * 노트 동기화 상태 칩(예전 "저장 중/저장됨" 대체, WP-287) — 저장 버튼·저장 표시 없이 자동 동기화되므로
 * 연결 상태만 알린다. 색은 상태 토큰만 쓴다(success·warning·destructive·muted), 아이콘은 lucide.
 * 경고·오류 칩은 아이콘만 상태색이고 글자는 본문 계열 토큰 — 옅은 상태색 바탕 위 상태색 글자는 라이트에서 WCAG AA 미달.
 * StatusBadge 를 쓰지 않는 이유: warning 변형이 같은 대비 결함(text-warning)을 갖고, error 는 시안의 옅은 칩이 아닌 꽉 찬 빨강이다.
 *
 * - 정상(live): 데스크톱은 초록 점 + "실시간"(시안 ①), 모바일(compact)은 헤더 폭을 지키려 점 하나만.
 * - 문제 상태는 짧은 글자 칩으로 커진다 — 모바일은 말줄임표 없이 짧게.
 * - connecting(새로 연 노트의 첫 연결 중)은 경고가 아닌 중립(muted) — 끊긴 적이 없으니 '재연결'이 아니다.
 * - forbidden(삭제되었거나 권한 회수 — 웹은 둘을 구분할 수 없다)은 재연결하지 않는 종료 상태라 스피너 없이 표시.
 * - signed-out(로그인 상실)도 재연결하지 않는 종료 상태 — 다시 로그인해야 한다.
 */
const COMMON = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-4 whitespace-nowrap'
const MUTED = 'bg-muted text-muted-foreground'
// 경고·오류 칩 — 아이콘만 상태색, 글자는 본문 계열(옅은 상태색 바탕 위 상태색 글자는 라이트 대비 미달).
const DANGER = 'bg-destructive/10 text-foreground'
const LIVE_DOT = <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />

/** 상태별 칩 모양 — label(데스크톱)·compactLabel(모바일, 없으면 label)·바탕/글자 tone·아이콘·title. */
interface ChipSpec {
  label: string
  compactLabel?: string
  tone: string
  icon: ReactNode
  title?: string
}

const CHIPS: Record<SyncStatus, ChipSpec> = {
  connecting: {
    label: '연결 중',
    tone: MUTED,
    icon: <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />,
  },
  live: { label: '실시간', tone: MUTED, icon: LIVE_DOT, title: '실시간 동기화 중 — 입력은 자동으로 저장됩니다' },
  // 글자는 text-warning-foreground — 옅은 주황 바탕 위 주황 글자(text-warning)는 라이트 대비 1.51:1 이라 아이콘만 주황.
  // 모바일도 "재연결 중" — 첫 연결의 "연결 중"(muted)과 색으로만 구분되지 않게 글자를 달리한다(시안의 "연결 중"에서 변경).
  reconnecting: {
    label: '재연결 중…',
    compactLabel: '재연결 중',
    tone: 'bg-warning/10 text-warning-foreground',
    icon: <RefreshCw className="h-3 w-3 animate-spin text-warning motion-reduce:animate-none" aria-hidden="true" />,
  },
  offline: { label: '오프라인', tone: MUTED, icon: <WifiOff className="h-3 w-3" aria-hidden="true" /> },
  unsent: {
    label: '미전송',
    tone: DANGER,
    icon: <CloudUpload className="h-3 w-3 text-destructive" aria-hidden="true" />,
    title: '아직 서버로 보내지 못한 입력이 있습니다',
  },
  readonly: { label: '읽기 전용', tone: MUTED, icon: <Eye className="h-3 w-3" aria-hidden="true" /> },
  forbidden: {
    label: '접근 불가',
    tone: DANGER,
    icon: <Ban className="h-3 w-3 text-destructive" aria-hidden="true" />,
    title: '삭제되었거나 접근 권한이 없습니다',
  },
  'signed-out': {
    label: '로그인 필요',
    tone: DANGER,
    icon: <LogIn className="h-3 w-3 text-destructive" aria-hidden="true" />,
    title: '로그인이 필요합니다',
  },
}

export function WikiSyncStatusChip({ status, compact }: { status: SyncStatus; compact: boolean }) {
  // 모바일 정상 상태는 헤더 폭을 지키려 글자 없이 점 하나만.
  if (status === 'live' && compact) {
    return (
      <span
        data-testid="wiki-sync-status"
        data-status={status}
        className="inline-flex shrink-0 items-center px-1"
        title="실시간 동기화 중"
      >
        {LIVE_DOT}
        <span className="sr-only">실시간 동기화 중</span>
      </span>
    )
  }
  const chip = CHIPS[status]
  return (
    <span data-testid="wiki-sync-status" data-status={status} className={`${COMMON} ${chip.tone}`} title={chip.title}>
      {chip.icon}
      {compact ? (chip.compactLabel ?? chip.label) : chip.label}
    </span>
  )
}
