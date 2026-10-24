// 내 작업 이슈 목록 표(WP-916) — 할당/내가 만든/구독 탭이 공유(AI 위임 작업은 전용 표 — pages/me/aiTasks).
// 데스크톱은 프로젝트 이슈 목록 행(IssueListRow)과 같은 한 줄 행: 상태·우선순위 아이콘 · ID · 제목(+레이블 2 + N) · [담당자] · 마감.
// 서버가 프로젝트 단위로 이어 준 행을 프로젝트 구간(splitByProject)으로 묶어 머리 줄(배지·이름·키 · 건수) 아래에 그린다.
// 모바일(<1024px)은 표 대신 프로젝트 이슈 목록 모바일 행(IssueRowMobileCell)과 같은 2줄 행을 같은 프로젝트 구간으로 그린다(WP-630, WP-916) —
// 고정 폭 칸(ID·상태·우선순위)이 390px 폭을 다 먹어 제목이 한두 글자씩 접히던 문제.
import { Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { EMPTY_GLYPH, formatListDueDate } from '@/lib/formatters'
import { isOverdue } from '@/lib/issueOverdue'
import { LIST_HEAD_CELL_CLASS, LIST_ID_HEAD_INDENT_CLASS } from '@/lib/listStyles'
import { splitByProject } from '@/lib/projectRuns'
import { cn } from '@/lib/utils'

import { useIsMobile } from '../../hooks/useIsMobile'
import { IssueMobileMeta } from '../../pages/projects/components/IssueMobileMeta'
import type { IssueResponse } from '../../types/issue'
import { IssuePriorityBars } from '../issues/IssuePriorityBars'
import { IssueStatusIcon } from '../issues/IssueStatusIcon'
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge'
import { UserAvatar } from '../users/UserAvatar'
import { IssueLabelMeta } from './IssueLabelMeta'
import { ProjectRunHead } from './ProjectRunHead'

export function IssueListTable({
  items,
  rowTestIdPrefix,
  showAssignee,
}: {
  items: IssueResponse[]
  /** 행 testid 접두어 — 예: "watched-row" → "watched-row-12". */
  rowTestIdPrefix: string
  /** 담당자 열 — 할당 탭은 내가 맡은 일이라 숨긴다(WP-916). */
  showAssignee: boolean
}) {
  const isMobile = useIsMobile()
  if (isMobile) return <IssueMobileList items={items} rowTestIdPrefix={rowTestIdPrefix} showAssignee={showAssignee} />
  // 머리 줄 colSpan — 상태·우선순위·ID·제목·마감 + 담당자.
  const columnCount = showAssignee ? 6 : 5
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {/* min-w-* — 제목 칸이 w-full 로 남은 폭을 가져가면 자동 레이아웃 표는 다른 칸의 w-* 를 무시하고
              최소 내용폭까지 줄인다. min-width 로 칸 폭 하한을 고정한다(IssueListView 와 같은 이유, WP-194). */}
          <tr className="border-b">
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-9 min-w-9')}><span className="sr-only">상태</span></th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-9 min-w-9')}><span className="sr-only">우선순위</span></th>
            <th className={cn(LIST_HEAD_CELL_CLASS, LIST_ID_HEAD_INDENT_CLASS, 'w-28 min-w-28')}>ID</th>
            <th className={LIST_HEAD_CELL_CLASS}>제목</th>
            {showAssignee && <th className={cn(LIST_HEAD_CELL_CLASS, 'w-20 min-w-20')}>담당자</th>}
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-32 min-w-32')}>마감</th>
          </tr>
        </thead>
        {/* 구간 key 는 키 + 첫 행 id — 같은 프로젝트가 떨어져 두 번 나와도(이론상) 중복되지 않게(AiTasksTable 과 같은 규칙). */}
        {splitByProject(items).map((run, i) => {
          const headTid = `${rowTestIdPrefix}-project-${run.key}-head`
          return (
            <tbody key={`${run.key}-${run.items[0].id}`} data-testid={`${rowTestIdPrefix}-project-${run.key}`}>
              <tr className="border-b" data-testid={headTid}>
                <td colSpan={columnCount} className={cn('pb-2', i === 0 ? 'pt-3' : 'pt-6')}>
                  <ProjectRunHead run={run} tid={headTid} />
                </td>
              </tr>
              {run.items.map((it) => (
                <IssueTableRow key={it.id} it={it} tid={`${rowTestIdPrefix}-${it.id}`} showAssignee={showAssignee} />
              ))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

/** 데스크톱 한 줄 행 — 행 전체 클릭으로 상세 이동(마우스 편의), 키보드 접근점은 제목 링크.
 *  개인 프로젝트 이슈도 같은 경로로 보내고 리다이렉트는 라우터가 맡는다. */
function IssueTableRow({ it, tid, showAssignee }: { it: IssueResponse; tid: string; showAssignee: boolean }) {
  const navigate = useNavigate()
  const to = `/projects/${it.projectKey}/issues/${it.number}`
  const overdue = isOverdue(it)
  return (
    <tr className="cursor-pointer border-b hover:bg-accent" data-testid={tid} onClick={() => navigate(to)}>
      <td className="py-2"><IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      {/* pr-3 — 긴 프로젝트 키(EXTSYS-1203 등)가 제목 글자에 붙지 않게 간격을 둔다. */}
      <td className="pr-3 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
          <span className="whitespace-nowrap">{it.projectKey}-{it.number}</span>
        </span>
      </td>
      {/* w-full max-w-0 — nowrap 제목이 자동 레이아웃 표를 가로로 넘기지 않게 남은 폭에 맞춰 줄인다(WP-194).
          @container — 레이블 노출을 제목 칸 폭(40rem)으로 정한다(WP-505). */}
      <td className="w-full max-w-0 pr-2">
        <div className="@container">
          <div className="flex min-w-0 items-center gap-1.5 font-medium">
            {/* stopPropagation — 링크 클릭이 행 onClick 까지 버블해 history 가 이중 push 되지 않게. */}
            <Link
              to={to}
              onClick={(e) => e.stopPropagation()}
              title={it.title}
              className="min-w-[8rem] truncate rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {it.title}
            </Link>
            <IssueLabelMeta labels={it.labels} testId={`${tid}-labels`} className="shrink-0 @min-[40rem]:ml-auto" />
          </div>
        </div>
      </td>
      {showAssignee && (
        <td className="whitespace-nowrap pr-3">
          <span className="flex items-center -space-x-1">
            {it.assignees.length === 0 ? (
              <span className="text-muted-foreground">{EMPTY_GLYPH}</span>
            ) : (
              <>
                {it.assignees.slice(0, 3).map((u) => (
                  // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분(IssueListRow 와 같은 묶음).
                  <UserAvatar key={u.id} user={u} size="xs" ring agent={u.kind === 'AGENT'} />
                ))}
                {it.assignees.length > 3 && (
                  <span className="ml-1 text-xs text-muted-foreground">+{it.assignees.length - 3}</span>
                )}
              </>
            )}
          </span>
        </td>
      )}
      {/* 마감 지난 미완료 이슈는 빨간 굵은 글씨 + 스크린리더 안내(WP-649). 완료·취소는 isOverdue 가 이미 제외한다. */}
      <td
        className={cn('whitespace-nowrap pr-2', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}
        data-testid={`${tid}-due`}
      >
        {formatListDueDate(it.dueDate)}
        {overdue && <span className="sr-only"> 마감 지남</span>}
      </td>
    </tr>
  )
}

/** 모바일 목록 — 1줄 상태 아이콘 + 제목(최대 2줄) / 2줄 메타(키 · ◆에픽 · 높음·마감·하위·라벨 … 담당자).
 *  데스크톱과 같은 프로젝트 구간(splitByProject)마다 머리 줄 <li>(ProjectRunHead)를 행 위에 둔다(WP-916).
 *  여러 프로젝트가 섞인 목록이라 키·링크는 행마다 이슈의 projectKey 로 만든다. */
function IssueMobileList({
  items,
  rowTestIdPrefix,
  showAssignee,
}: {
  items: IssueResponse[]
  rowTestIdPrefix: string
  showAssignee: boolean
}) {
  return (
    <ul>
      {splitByProject(items).map((run) => {
        const headTid = `${rowTestIdPrefix}-project-${run.key}-head`
        return (
          <Fragment key={`${run.key}-${run.items[0].id}`}>
            <li className="px-1 pt-4 pb-1.5" data-testid={headTid}>
              <ProjectRunHead run={run} tid={headTid} />
            </li>
            {run.items.map((it) => (
              <IssueMobileRow key={it.id} it={it} tid={`${rowTestIdPrefix}-${it.id}`} showAssignee={showAssignee} />
            ))}
          </Fragment>
        )
      })}
    </ul>
  )
}

/** 모바일 행 — 행 전체 탭으로 상세 이동(손가락 편의), 키보드·스크린리더 접근점은 제목 링크.
 *  할당 탭(showAssignee=false)은 담당자가 모두 나라 메타 줄의 아바타를 숨긴다. */
function IssueMobileRow({ it, tid, showAssignee }: { it: IssueResponse; tid: string; showAssignee: boolean }) {
  const navigate = useNavigate()
  const to = `/projects/${it.projectKey}/issues/${it.number}`
  return (
    <li className="cursor-pointer border-b px-1 py-2.5" data-testid={tid} onClick={() => navigate(to)}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} />
        </span>
        <div className="min-w-0 flex-1">
          {/* stopPropagation — 링크 탭이 행 onClick 까지 버블해 history 가 이중 push 되지 않게. */}
          <Link
            to={to}
            onClick={(e) => e.stopPropagation()}
            data-testid={`${tid}-title`}
            className="line-clamp-2 break-words text-sm font-medium leading-snug"
          >
            {it.title}
          </Link>
          <IssueMobileMeta issue={it} projectKey={it.projectKey} testIdPrefix={tid} hideAssignees={!showAssignee} />
        </div>
      </div>
    </li>
  )
}
