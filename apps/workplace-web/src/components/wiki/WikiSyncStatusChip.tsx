import { Ban, CloudUpload, Eye, Loader2, LogIn, RefreshCw, RotateCw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

import { reloadPage, type SyncStatus } from '../../lib/collab/collabStatus'

/**
 * 노트 동기화 상태 칩(예전 "저장 중/저장됨" 대체, WP-287) — 저장 버튼·저장 표시 없이 자동 동기화되므로
 * 연결 상태만 알린다. 색은 상태 토큰만 쓴다(success·warning·destructive·muted), 아이콘은 lucide.
 * 경고·오류 칩은 아이콘만 상태색이고 글자는 본문 계열 토큰 — 옅은 상태색 바탕 위 상태색 글자는 라이트에서 WCAG AA 미달.
 * StatusBadge 를 쓰지 않는 이유: error 변형이 시안의 옅은 칩이 아닌 꽉 찬 빨강이고, 경고 칩은 글자를 본문색·아이콘만 상태색으로
 * 두는 시안이라 Badge warning(글자 --warning-text, WP-303 에서 AA 로 수정됨)과 모양이 다르다.
 *
 * - 정상(live): 데스크톱은 초록 점 + "실시간"(시안 ①), 모바일(compact)은 헤더 폭을 지키려 점 하나만.
 * - 문제 상태는 짧은 글자 칩으로 커진다 — 모바일은 말줄임표 없이 짧게.
 * - connecting(새로 연 노트의 첫 연결 중)은 경고가 아닌 중립(muted) — 끊긴 적이 없으니 '재연결'이 아니다.
 * - forbidden(삭제되었거나 권한 회수 — 웹은 둘을 구분할 수 없다)은 재연결하지 않는 종료 상태라 스피너 없이 표시.
 * - signed-out(로그인 상실)도 재연결하지 않는 종료 상태 — 다시 로그인해야 한다.
 * - outdated(동기화 서버가 새 스키마로 배포됨, WP-313)도 종료 상태 — 칩 자체가 새로고침 버튼이다(다른 종료 상태처럼 DANGER tone).
 */
const COMMON = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-4 whitespace-nowrap'
const MUTED = 'bg-muted text-muted-foreground'
// 경고·오류 칩 — 아이콘만 상태색, 글자는 본문 계열(옅은 상태색 바탕 위 상태색 글자는 라이트 대비 미달).
const DANGER = 'bg-destructive/10 text-foreground'
// 누를 수 있는 칩 — hover 때 살짝 옅게, 키보드 포커스 링.
const CLICKABLE = 'cursor-pointer hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const LIVE_DOT = <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />

/** 상태별 칩 모양 — label(데스크톱)·compactLabel(모바일, 없으면 label)·바탕/글자 tone·아이콘·title, 누를 수 있으면 onClick. */
interface ChipSpec {
  label: string
  compactLabel?: string
  tone: string
  icon: ReactNode
  title?: string
  /** 있으면 칩이 같은 모양의 버튼이 된다(hover 없는 모바일도 탭 한 번으로 동작). */
  onClick?: () => void
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
  outdated: {
    label: '새 버전 — 새로고침',
    compactLabel: '새로고침',
    tone: DANGER,
    icon: <RotateCw className="h-3 w-3 text-destructive" aria-hidden="true" />,
    title: '새 버전이 배포되었습니다. 새로고침하면 다시 편집할 수 있어요. 아직 저장되지 않은 입력은 저장되지 않습니다.',
    onClick: reloadPage,
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
  const label = compact ? (chip.compactLabel ?? chip.label) : chip.label
  // 누를 수 있는 칩(새 버전 → 새로고침)은 같은 모양의 버튼 — 접근 가능한 이름은 보이는 라벨, 설명은 title.
  if (chip.onClick) {
    return (
      <button
        type="button"
        data-testid="wiki-sync-status"
        data-status={status}
        className={`${COMMON} ${chip.tone} ${CLICKABLE}`}
        title={chip.title}
        onClick={chip.onClick}
      >
        {chip.icon}
        {label}
      </button>
    )
  }
  return (
    <span data-testid="wiki-sync-status" data-status={status} className={`${COMMON} ${chip.tone}`} title={chip.title}>
      {chip.icon}
      {label}
    </span>
  )
}
