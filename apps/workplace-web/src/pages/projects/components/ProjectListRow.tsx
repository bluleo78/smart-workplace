// 프로젝트 목록의 단일 행 — 컬러 배지·유형 칩·진행률 바·멤버 아바타 스택·즐겨찾기 토글.
import { Star } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useIsMobile } from '@/hooks/useIsMobile'
import { formatRelativeTime } from '@/lib/formatters'
import { nameColor, nameInitial, projectColor, projectInitial } from '@/lib/project-color'
import { cn } from '@/lib/utils'
import type { ProjectResponse } from '@/types/project'

// 완료율 라벨 — 정직 신호: 이슈 0=이슈 없음, 100%=축하, 그 외 N개 중 X% 완료.
// pct 는 호출부에서 계산해 전달(바 너비와 라벨이 동일 값을 쓰도록 단일화).
function progressLabel(p: ProjectResponse, pct: number): string {
  if (p.issueTotal === 0) return '이슈 없음'
  if (pct >= 100) return `${p.issueTotal}개 모두 완료 🎉`
  return `${p.issueTotal}개 중 ${pct}% 완료`
}

type RowProps = {
  project: ProjectResponse
  fav: boolean
  onToggleFav: (key: string) => void
}

// 데스크톱·모바일 행이 공유하는 파생값 — 배지 색·완료율(바 너비와 라벨이 같은 값)·개인 여부.
function rowBasics(p: ProjectResponse) {
  return {
    c: projectColor(p.key),
    pct: p.issueTotal === 0 ? 0 : Math.round((p.issueDone / p.issueTotal) * 100),
    isPersonal: p.type === 'PERSONAL',
  }
}

export function ProjectListRow(props: RowProps) {
  const isMobile = useIsMobile()
  if (isMobile) return <ProjectListRowMobile {...props} />

  const { project: p, fav, onToggleFav } = props
  const { c, pct, isPersonal } = rowBasics(p)
  // 표시한 아바타 수를 넘는 잔여 멤버 수 — 음수 방지(방어적).
  const extra = Math.max(0, p.memberCount - p.memberNames.length)

  return (
    <div
      role="listitem"
      data-testid={`project-row-${p.key}`}
      className="grid grid-cols-[1.6fr_88px_150px_130px_40px] items-center gap-3 border-b px-4 py-3 hover:bg-accent/40 max-lg:grid-cols-[1fr_auto]"
    >
      {/* 프로젝트명 영역 — Link 로 감싸 행 클릭 시 상세 이동 */}
      <Link to={`/projects/${p.key}`} className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          data-testid={`project-badge-${p.key}`}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-xs font-bold"
          style={{ backgroundColor: c.bg, color: c.fg }}
        >
          {projectInitial(p.key)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="block text-xs text-muted-foreground">{p.key}</span>
        </span>
      </Link>

      {/* 유형 칩 */}
      <span className="max-lg:hidden">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            isPersonal ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700',
          )}
        >
          {isPersonal ? '개인' : '팀'}
        </span>
      </span>

      {/* 진행률 바 + 라벨 */}
      <div>
        <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: p.issueTotal === 0 ? 'transparent' : c.bg }}
          />
        </div>
        <span className={cn('text-xs', p.issueTotal === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
          {progressLabel(p, pct)}
        </span>
      </div>

      {/* 멤버 아바타 스택 + 최근 활동 시각 */}
      <div className="flex items-center justify-end gap-2 max-lg:hidden">
        <span className="flex">
          {p.memberNames.slice(0, 3).map((n, i) => {
            const ac = nameColor(n)
            return (
              <span
                key={i}
                title={n}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-[9.5px] font-bold',
                  i > 0 && '-ml-2',
                )}
                style={{ backgroundColor: ac.bg, color: ac.fg }}
              >
                {nameInitial(n)}
              </span>
            )
          })}
          {extra > 0 && (
            <span className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9.5px] font-bold text-muted-foreground">
              +{extra}
            </span>
          )}
        </span>
        <span className="w-12 text-right text-xs text-muted-foreground">
          {formatRelativeTime(p.updatedAt)}
        </span>
      </div>

      {/* 즐겨찾기 토글 — 팀 프로젝트만. 개인 프로젝트는 즐겨찾기 불가(항상 기본 노출)라 빈 칸. */}
      {isPersonal ? (
        <span />
      ) : (
        <button
          type="button"
          data-testid={`fav-toggle-${p.key}`}
          aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
          aria-pressed={fav}
          onClick={() => onToggleFav(p.key)}
          className="justify-self-end p-1"
        >
          <Star className={cn('h-4 w-4', fav ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
        </button>
      )}
    </div>
  )
}

// 모바일(WP-197) — 64px 한 줄 행. 데스크톱 5열 그리드는 좁은 폭에서 진행 라벨·아바타가 잘려 정보가 사라졌다.
// 별 버튼은 <a> 안에 둘 수 없어 Link 의 형제로 두고, Link 가 나머지 폭 전체를 덮어 행 어디를 눌러도 상세로 간다.
function ProjectListRowMobile({ project: p, fav, onToggleFav }: RowProps) {
  const { c, pct, isPersonal } = rowBasics(p)
  // 보조줄 진행 정보 — OPEN 은 유형이 우선(이슈 0건이어도 「접수함」), 그 외 0건은 「이슈 없음」.
  const meta =
    p.type === 'OPEN' ? (
      <span>접수함</span>
    ) : p.issueTotal === 0 ? (
      <span>이슈 없음</span>
    ) : (
      <>
        <span aria-hidden="true" className="h-1.5 w-[60px] shrink-0 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: c.bg }} />
        </span>
        <span className="shrink-0">{pct}%</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{p.issueTotal}개</span>
      </>
    )
  return (
    <div
      role="listitem"
      data-testid={`project-row-${p.key}`}
      className="flex h-16 items-center border-b pl-4 pr-1"
    >
      {/* 탭 하이라이트는 링크에만 — 행 루트에 두면 별 탭에도 행 전체가 칠해진다. */}
      <Link
        to={`/projects/${p.key}`}
        className="flex h-full min-w-0 flex-1 items-center gap-3 active:bg-accent/40"
      >
        <span
          aria-hidden="true"
          data-testid={`project-badge-${p.key}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
          style={{ backgroundColor: c.bg, color: c.fg }}
        >
          {projectInitial(p.key)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{p.name}</span>
          <span
            data-testid={`project-row-meta-${p.key}`}
            className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className="shrink-0">{p.key}</span>
            <span aria-hidden="true">·</span>
            {meta}
          </span>
        </span>
      </Link>
      {/* 즐겨찾기 — 팀·OPEN 만(기존 규칙). 개인은 같은 폭의 빈 자리로 이름 끝 정렬을 맞춘다. 44px 터치. */}
      {isPersonal ? (
        <span aria-hidden="true" className="size-11 shrink-0" />
      ) : (
        <button
          type="button"
          data-testid={`fav-toggle-${p.key}`}
          aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
          aria-pressed={fav}
          onClick={() => onToggleFav(p.key)}
          className="flex size-11 shrink-0 items-center justify-center rounded-md active:bg-accent"
        >
          <Star className={cn('size-5', fav ? 'fill-warning text-warning' : 'text-muted-foreground/60')} />
        </button>
      )}
    </div>
  )
}
