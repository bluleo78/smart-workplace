import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, HardDrive, MoreHorizontal, Paperclip, Plus, User, Users } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { LoadErrorState } from '@/components/LoadErrorState'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { extractApiError } from '@/lib/api-error'
import { canManageDriveSpace, hasDriveSpaceMembers, partitionSpaces } from '@/lib/driveSpaces'
import { formatFileSize } from '@/lib/formatters'
import { HIT_AREA_COARSE } from '@/lib/hitArea'
import { failedWithoutData } from '@/lib/queryFailure'
import { SELECTED_NAV_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { driveApi } from '../../api/drive'
import { driveKeys } from '../../hooks/queries/driveKeys'
import { useDriveQuota } from '../../hooks/queries/useDriveQuota'
import { useDriveSpaces } from '../../hooks/queries/useDriveSpaces'
import type { DriveQuota, DriveQuotaBreakdown, DriveSpace } from '../../types/drive'
import { DriveSpaceMemberDialog } from './DriveSpaceMemberDialog'

/** 사용량 바 경고 단계 — 임계치 기반 색상 분기(#822). */
type DriveUsageLevel = 'normal' | 'warning' | 'critical'

/**
 * 사용률(0~∞)을 경고 단계로 변환한다(#822).
 * - `< 80%` normal · `80% ~ <100%` warning · `>= 100%` critical(한도 도달/초과).
 * 색상만으로 정보를 전달하지 않도록 텍스트 표기는 호출측에서 그대로 유지한다(WCAG 1.4.1).
 */
function driveUsageLevel(ratio: number): DriveUsageLevel {
  if (ratio >= 1) return 'critical'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}

// 단계별 막대 색상 — shadcn 시맨틱 토큰만 사용(hex 금지).
const USAGE_BAR_CLASS: Record<DriveUsageLevel, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  critical: 'bg-destructive',
}

/** 종류별 내역 한 줄 — 이름·값과, 이름만으로 헷갈릴 때 붙이는 작은 설명. */
interface UsageRow {
  key: keyof DriveQuotaBreakdown
  label: string
  note?: string
}

/**
 * 종류별 내역 줄 순서(WP-1391 시안) — 보통 큰 것부터: 드라이브 → 이슈 → 이슈챗 → 노트 → 그 밖의 첨부 → 휴지통.
 * 「올리는 중·임시」(unlinked)는 0 이 대부분이라 값이 있을 때만 맨 끝에 덧붙인다(아래 렌더에서 처리).
 */
const USAGE_ROWS: UsageRow[] = [
  { key: 'drive', label: '드라이브', note: '옛 버전 포함' },
  { key: 'issue', label: '이슈 첨부·본문 이미지' },
  { key: 'issueChat', label: '이슈챗 첨부' },
  { key: 'wiki', label: '노트 첨부' },
  { key: 'otherAttachments', label: '채팅·홈·메일 초안', note: '보낸 메일 사본 포함' },
  { key: 'trash', label: '휴지통' },
]

/**
 * 사이드바 맨 아래 「저장 공간」 블록(#81 → WP-1391).
 * - 합계(사용/한도)와 막대를 늘 보이고, 내역(breakdown)이 오면 머리 줄 전체가 펼침 버튼이 된다 — 누르면 종류별 내역이
 *   사이드바 안에서 아래로 펼쳐지고 다시 누르면 접힌다. 기본은 접힘이고 상태는 기억하지 않는다(가끔 확인하는 정보라서).
 * - 롤링 배포 중 옛 API 는 breakdown 을 주지 않으므로, 그때는 버튼 없이 합계만 보인다.
 * - 메일 첨부 임시 보관은 한도에 들어가지 않아 구분선 아래 흐린 색으로 따로 보인다(필드가 있을 때만).
 */
function DriveUsageBlock({ quota }: { quota: DriveQuota }) {
  const [expanded, setExpanded] = useState(false)
  // 펼친 목록 id — 사이드바가 두 번 그려지는 화면(모바일·데스크톱 동시)이 있어도 겹치지 않게 useId 로 만든다.
  const breakdownId = useId()
  // 사용률·경고 단계(#822) — quotaBytes 0 은 나눗셈 방지로 1 처리.
  const usageRatio = quota.usedBytes / Math.max(1, quota.quotaBytes)
  const usageLevel = driveUsageLevel(usageRatio)
  const { breakdown } = quota
  const total = (
    <span data-testid="drive-usage-text">
      {formatFileSize(quota.usedBytes)} / {formatFileSize(quota.quotaBytes)}
    </span>
  )
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="mt-3 border-t pt-3" data-testid="drive-usage-bar">
      {breakdown ? (
        // 머리 줄 전체가 버튼 — 좁은 사이드바에서 작은 셰브론만 누르게 하지 않으려고 줄 전체를 눌림 영역으로 둔다.
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? breakdownId : undefined}
          data-testid="drive-usage-toggle"
          onClick={() => setExpanded((v) => !v)}
          className="-mx-1 mb-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <span className="flex items-center gap-1">
            저장 공간
            <Chevron className="h-3 w-3" aria-hidden />
          </span>
          {total}
        </button>
      ) : (
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>저장 공간</span>
          {total}
        </div>
      )}
      {/* 임계치 경고색(#822) — 80%↑ warning, 100%↑ destructive. 텍스트는 항상 유지. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          data-testid="drive-usage-fill"
          data-usage-level={usageLevel}
          className={cn('h-full', USAGE_BAR_CLASS[usageLevel])}
          style={{ width: `${Math.min(100, usageRatio * 100)}%` }}
        />
      </div>
      {breakdown && expanded && (
        <ul id={breakdownId} data-testid="drive-usage-breakdown" className="mt-2 space-y-1 text-xs">
          {USAGE_ROWS.map((row) => (
            <UsageLine key={row.key} label={row.label} note={row.note} bytes={breakdown[row.key]} testId={`drive-usage-row-${row.key}`} />
          ))}
          {breakdown.unlinked > 0 && (
            <UsageLine label="올리는 중·임시" bytes={breakdown.unlinked} testId="drive-usage-row-unlinked" />
          )}
          {quota.mailCacheBytes != null && (
            <UsageLine
              label="메일 첨부 임시 보관"
              note="한도 미포함 · 7일 뒤 자동 삭제"
              bytes={quota.mailCacheBytes}
              testId="drive-usage-row-mailCache"
              muted
              className="mt-1.5 border-t border-dashed pt-1.5"
            />
          )}
        </ul>
      )}
    </div>
  )
}

/** 내역 한 줄 — 이름과 크기를 양 끝에, 설명은 이름 아래 작은 글씨로. muted 면 한도 밖 항목처럼 흐리게. */
function UsageLine({
  label,
  note,
  bytes,
  testId,
  muted = false,
  className,
}: {
  label: string
  note?: string
  bytes: number
  testId: string
  muted?: boolean
  className?: string
}) {
  return (
    <li data-testid={testId} className={className}>
      <div className={cn('flex items-center justify-between gap-2', muted ? 'text-muted-foreground' : 'text-foreground/80')}>
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 tabular-nums">{formatFileSize(bytes)}</span>
      </div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </li>
  )
}

// WP-63: 공간 목록 미로드 시 빈 배열 — 매 렌더 새 배열을 만들지 않도록 모듈 상수로 둔다.
const EMPTY_SPACES: DriveSpace[] = []

/** 공간 행 아이콘 — 개인은 User, 팀은 Users(WP-143). */
function SpaceTypeIcon({ personal }: { personal: boolean }) {
  const Icon = personal ? User : Users
  return <Icon className="h-4 w-4 shrink-0" data-testid="drive-space-icon" aria-hidden />
}

/** 좌측 2차 사이드바 — 내 드라이브 + 팀 공간 목록, 팀 공간 생성. */
export function DriveSidebar() {
  // WP-63: 공간 목록 — useDriveSpaces(['drive','spaces']) 로 조회해 resource.changed 무효화 대상이 되게 한다.
  const spacesQuery = useDriveSpaces()
  const spaces = spacesQuery.data ?? EMPTY_SPACES
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // 팀 공간 생성 다이얼로그 — window.prompt 대체 (#148).
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  // 생성 중 동기적 in-flight 가드 — ref 는 즉시(리렌더 없이) 반영되므로 같은 이벤트
  // 루프 틱 내에 "만들기" 버튼이 두 번 클릭돼도 두 번째 호출을 차단한다(#582).
  // creating state 는 버튼의 시각적 disabled 표시용 보조 값.
  const isCreatingRef = useRef(false)
  const [creating, setCreating] = useState(false)
  // 이름 중복(409) 인라인 에러 — 컨테이너류 이름 하드 차단 정책(#688/#696/#803).
  const [spaceNameError, setSpaceNameError] = useState<string | null>(null)
  // 드라이브 쿼터 — 사이드바 하단 저장 공간 블록 (#81, WP-1391). TanStack Query 전환(#820) —
  // 업로드/삭제/롤백 mutation 성공 시 invalidateQueries(driveQuotaKeys.all) 로
  // 재조회되므로 이 컴포넌트가 리마운트되지 않아도 최신 값이 반영된다.
  const { data: quota } = useDriveQuota()
  // TEAM 공간 이름 변경/삭제 대상 — kebab 메뉴에서 설정(제어형 다이얼로그).
  const [renameTarget, setRenameTarget] = useState<DriveSpace | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveSpace | null>(null)
  // 멤버 다이얼로그 대상(WP-582) — 공간 행 ⋯ 의 「멤버」에서 설정. id 만 들고 공간은 목록에서 찾는다 —
  // 내 역할이 바뀌거나(소유자 → 편집자) 내가 빠지면 재조회된 목록을 따라 관리 버튼이 사라지거나 창이 닫히게.
  const [membersTargetId, setMembersTargetId] = useState<number | null>(null)
  const membersTarget = spaces.find((s) => s.id === membersTargetId)

  // 생성·이름 변경·삭제 후 공간 목록 갱신 — 재조회 완료까지 대기해 이후 navigate 시점에 목록이 최신이게 한다.
  async function reload() {
    await queryClient.invalidateQueries({ queryKey: driveKeys.spaces() })
  }

  /**
   * 팀 공간 생성 — 다이얼로그 확인 시 호출. 이름 중복(409)이면 다이얼로그를 유지한 채
   * 인라인 에러로 표시한다(#696) — 성공했을 때만 닫는다.
   */
  async function submitCreate() {
    // 동기적 중복 제출 가드 — ref 는 즉시 반영되므로 같은 틱 내 두 번째 클릭을 차단.
    if (isCreatingRef.current) return
    const trimmed = spaceName.trim()
    if (!trimmed) return
    isCreatingRef.current = true
    setCreating(true)
    setSpaceNameError(null)
    try {
      const { data } = await driveApi.createSpace(trimmed)
      setSpaceDialogOpen(false)
      setSpaceName('')
      await reload()
      navigate(`/drive/spaces/${data.id}`)
    } catch (err) {
      setSpaceNameError(extractApiError(err, '공간 생성에 실패했습니다.'))
    } finally {
      isCreatingRef.current = false
      setCreating(false)
    }
  }

  /**
   * 이름 변경 확정 — RenameDialog onConfirm. 실패(이름 중복 409 등)는 그대로 throw해
   * RenameDialog 가 다이얼로그를 유지한 채 인라인 에러로 표시하도록 한다(#696).
   * 성공 시에만 RenameDialog 가 onClose(→ setRenameTarget(null))를 호출한다.
   */
  async function submitRename(name: string) {
    if (!renameTarget) return
    await driveApi.renameSpace(renameTarget.id, name)
    await reload()
  }

  /** 삭제 확정 — 내용물 통째 영구삭제. 보고 있던 공간이면 드라이브 홈으로 이동. */
  async function submitDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    await driveApi.deleteSpace(id)
    await reload()
    navigate('/drive')
  }

  // 채널 연동 space(type==='CHANNEL')는 드라이브 사이드바에 노출하지 않는다.
  // 파일의 집은 대화 컨텍스트(채널) — 채널 "파일" 드로워가 진입점이고, 풀페이지는
  // 드로워의 "전체에서 열기" 딥링크로 도달한다. 전역 드라이브에 채널 수만큼 평면
  // 나열하면 "두 개의 집" 문제가 재발하므로 primary(개인·팀)만 렌더한다.
  const { primary } = partitionSpaces(spaces)

  return (
    <aside
      data-testid="drive-sidebar"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "드라이브" 앱임을 명시 */}
      <div className={sidebarTitleClass}>
        <HardDrive className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        드라이브
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 공간 섹션 헤더 — 팀 공간 생성 액션을 섹션 헤더에 배치(표준 사이드바 패턴) */}
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            공간
          </span>
          <button
            type="button"
            aria-label="팀 공간 만들기"
            onClick={() => setSpaceDialogOpen(true)}
            // 16px 아이콘만 있는 버튼 — 터치에서는 눌림 영역만 넓힌다(WP-734).
            className={`text-muted-foreground hover:text-foreground ${HIT_AREA_COARSE}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {/* 첫 조회 실패는 공간 없는 새 사용자 화면과 구분해 안내 + 다시 시도(WP-865) */}
        {failedWithoutData(spacesQuery) && (
          <LoadErrorState
            variant="inline"
            title="공간 목록을 불러오지 못했습니다"
            queries={[spacesQuery]}
            testId="drive-spaces-error"
          />
        )}
        <nav className="mt-2 space-y-1" data-testid="drive-space-list">
          {primary.map((s) => {
            // TEAM 공간이면 ⋯ — 「멤버」는 모든 멤버, 이름 변경/삭제는 OWNER 만(개인·채널 공간은 ⋯ 없음, WP-582).
            const canManage = canManageDriveSpace(s)
            const hasMenu = hasDriveSpaceMembers(s)
            return (
              <div key={s.id} className="group/space relative flex items-center">
                {/* 메뉴가 있는 행은 ⋯ 자리를 비운다 — 터치 기기(pointer: coarse)는 ⋯ 가 상시 44px 라 더 넓게(WP-237). */}
                <NavLink
                  to={`/drive/spaces/${s.id}`}
                  className={({ isActive }) =>
                    cn(sidebarLinkClass({ isActive }), 'flex-1 pr-7', hasMenu && 'pointer-coarse:pr-12')
                  }
                >
                  {/* 공간 종류 아이콘(WP-143) — 개인은 User, 팀은 Users. 첨부 모아보기(Paperclip)와 함께 모든 행이 아이콘을 갖도록 통일 */}
                  <SpaceTypeIcon personal={s.type === 'PERSONAL'} />
                  <span className="min-w-0 break-words">{s.type === 'PERSONAL' ? '내 드라이브' : s.name}</span>
                </NavLink>
                {hasMenu && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${s.name} 메뉴`}
                        data-testid={`drive-space-menu-${s.id}`}
                        // 터치 기기(pointer: coarse)는 hover 가 없으므로 상시 노출 + 44px 터치 영역(WP-237).
                        className="absolute right-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/space:opacity-100 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:p-0 pointer-coarse:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        data-testid={`drive-space-members-${s.id}`}
                        onSelect={() => setMembersTargetId(s.id)}
                      >
                        멤버
                      </DropdownMenuItem>
                      {canManage && (
                        <>
                          <DropdownMenuItem
                            data-testid={`drive-space-rename-${s.id}`}
                            onSelect={() => setRenameTarget(s)}
                          >
                            이름 변경
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            data-testid={`drive-space-delete-${s.id}`}
                            onSelect={() => setDeleteTarget(s)}
                          >
                            삭제
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )
          })}
        </nav>
      </div>

      {/* 하단 그룹 — 첨부 모아보기 + 저장 공간을 한 영역에(사이 구분선 없음). 상단만 스크롤 영역과 구분선.
          첨부는 평소 잘 안 보는 보조 뷰라 공간 목록 아래·사용량 바로 위에 배치(#80 IA). */}
      <div className="border-t p-3">
        {/* 첨부 링크 — 사용량 텍스트와 동일한 text-xs 로 통일 */}
        <NavLink
          to="/drive/attachments"
          data-testid="drive-nav-attachments"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
              isActive ? SELECTED_NAV_CLASS : 'text-muted-foreground hover:bg-accent/50',
            )
          }
        >
          <Paperclip className="h-4 w-4 shrink-0" />
          첨부 모아보기
        </NavLink>
        {/* 저장 공간 (#81, WP-1391) — 첨부와 같은 영역, 사이 구분선으로 분리. 종류별 내역은 머리 줄을 눌러 펼친다. */}
        {quota && <DriveUsageBlock quota={quota} />}
      </div>

      {/* 팀 공간 이름 입력 다이얼로그 — window.prompt 대체 (#148) */}
      <Dialog
        open={spaceDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSpaceDialogOpen(false)
            setSpaceName('')
            setSpaceNameError(null)
          }
        }}
      >
        <DialogContent data-testid="space-name-dialog">
          <DialogHeader>
            <DialogTitle>새 팀 공간</DialogTitle>
            <DialogDescription className="sr-only">새 팀 공간</DialogDescription>
          </DialogHeader>
          <Input
            value={spaceName}
            onChange={(e) => { setSpaceName(e.target.value); setSpaceNameError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitCreate()
            }}
            placeholder="공간 이름"
            autoFocus
            aria-invalid={!!spaceNameError}
            data-testid="space-name-input"
          />
          {spaceNameError && (
            <p className="text-sm text-destructive" data-testid="space-name-error">
              {spaceNameError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setSpaceDialogOpen(false); setSpaceName(''); setSpaceNameError(null) }}
            >
              취소
            </Button>
            <Button
              onClick={() => void submitCreate()}
              disabled={!spaceName.trim() || creating}
              data-testid="space-name-confirm"
            >
              만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 팀 공간 멤버(WP-582) — 닫으면 대상을 비워 다음에 다른 공간을 열 수 있게 한다. */}
      {membersTarget && (
        <DriveSpaceMemberDialog
          space={membersTarget}
          open
          onOpenChange={(o) => {
            if (!o) setMembersTargetId(null)
          }}
        />
      )}
      {/* TEAM 공간 이름 변경 — 제어형 RenameDialog. 이름 중복(409)은 인라인 에러로 노출(#696). */}
      <RenameDialog
        open={renameTarget != null}
        title="공간 이름 변경"
        initialValue={renameTarget?.name ?? ''}
        onConfirm={submitRename}
        onClose={() => setRenameTarget(null)}
        extractError={(err) => extractApiError(err, '이름 변경에 실패했습니다.')}
      />

      {/* TEAM 공간 삭제 — 내용물 통째 영구삭제 경고 */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent data-testid="drive-space-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>공간 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; 공간과 모든 파일·폴더가 영구 삭제됩니다. 이 작업은
              되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="drive-space-delete-confirm"
              onClick={() => void submitDelete()}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
