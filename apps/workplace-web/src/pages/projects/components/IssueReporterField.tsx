// 이슈 보고자(만든 사람) 필드 — 「보고자」 레이블 + 아바타·이름 · 「N월 N일 생성」 (WP-272).
// 데스크톱 속성 레일(상태·담당 그룹 담당자 아래, 세로 배치)과 모바일 ＋ 속성 시트(유형 아래, 가로 배치)가 공유한다.
// 바꿀 수 있는 사람(프로젝트 OWNER·ADMIN·지금 보고자, WP-944)에게는 담당자 필드처럼 값이 편집 트리거가 되고, 고르면 바로 바꾼다.
// 그 밖에는 읽기 전용 텍스트다.
import { useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { labelWithValue } from '@/lib/labelWithValue';

import { UserAvatar } from '../../../components/users/UserAvatar';
import { useChangeIssueReporter } from '../../../hooks/queries/useChangeIssueReporter';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { formatDateMonthDay, formatDateTimeMinute } from '../../../lib/formatters';
import { reporterCandidates } from '../../../lib/reporterCandidates';
import type { MemberResponse } from '../../../types/project';
import type { UserSummary } from '../../../types/user';

const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

/** 보고자를 바꿀 수 있을 때 넘기는 값 — 없으면 읽기 전용. */
export interface ReporterEdit {
  projectKey: string;
  issueNumber: number;
  /** 로그인한 사람 — 지금 보고자가 스스로 넘길 때만 확인창을 띄운다. */
  currentUserId: number | undefined;
}

export function IssueReporterField({
  reporter,
  createdAt,
  layout,
  edit,
}: {
  /**
   * 상세 응답 reporter — null 이면 사용자 행을 찾지 못한 것(「알 수 없음」).
   * undefined 는 필드가 없는 구버전 서버 응답(롤링 배포 중)이라 「알 수 없음」으로 오해하지 않게 필드째 숨긴다.
   */
  reporter: UserSummary | null | undefined;
  /** summary.createdAt — 이슈 생성 시각(UTC ISO). */
  createdAt: string;
  /** rail = 레이블 위·값 아래(담당자 필드와 같은 px-3 들여쓰기), sheet = 레이블 왼쪽·값 오른쪽 한 줄. */
  layout: 'rail' | 'sheet';
  /** 보고자를 바꿀 수 있으면(viewerCanChangeReporter) 넘긴다(WP-944). */
  edit?: ReporterEdit;
}) {
  if (reporter === undefined) return null;
  const createdDay = formatDateMonthDay(createdAt);
  const value = (
    // max-w-full — 레일(블록 부모)에서 긴 이름이 폭을 넘지 않고 말줄임되게 한다(WP-805). min-w-0 은 시트의 flex 행용.
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 text-sm" data-testid="issue-reporter">
      {reporter ? (
        <>
          {/* AGENT 는 담당자 칩과 같은 아바타 표식(ring + Bot 마커)으로 사람과 구분한다. */}
          <UserAvatar user={reporter} size="xs" agent={reporter.kind === 'AGENT'} />
          <span className="truncate">{reporter.name}</span>
        </>
      ) : (
        <span className="text-muted-foreground">알 수 없음</span>
      )}
      {createdDay && (
        // 월·일만 보여주고, 정확한 생성 시각은 hover 툴팁으로 제공한다.
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={formatDateTimeMinute(createdAt)}
          data-testid="issue-reporter-created"
        >
          · {createdDay} 생성
        </span>
      )}
    </span>
  );
  const field = edit ? <ReporterPicker reporter={reporter} edit={edit} layout={layout}>{value}</ReporterPicker> : value;
  if (layout === 'sheet') {
    return (
      <div className="flex items-center justify-between gap-2" data-testid="issue-more-props-reporter">
        <span className={LABEL_CLASS}>보고자</span>
        {field}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <span className={LABEL_CLASS}>보고자</span>
      {edit ? field : <div className="px-3 py-2">{value}</div>}
    </div>
  );
}

/**
 * 보고자 고르기 팝오버 — 담당자 픽커(AssigneePickerPopover)와 같은 트리거 모양(평소 테두리 없음, 호버 시 테두리)·검색·목록이되 한 명만 고른다.
 * 고르면 닫고 바로 바꾼다. 지금 보고자가 스스로 넘기면 권한이 함께 넘어가므로 확인창을 먼저 띄운다.
 */
function ReporterPicker({
  reporter,
  edit,
  layout,
  children,
}: {
  reporter: UserSummary | null;
  edit: ReporterEdit;
  layout: 'rail' | 'sheet';
  children: React.ReactNode;
}) {
  const members = useProjectMembers(edit.projectKey);
  const change = useChangeIssueReporter(edit.projectKey, edit.issueNumber);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [handOver, setHandOver] = useState<MemberResponse | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return reporterCandidates(members.data, reporter?.id).filter((m) =>
      `${m.name} ${m.username}`.toLowerCase().includes(q),
    );
  }, [members.data, search, reporter?.id]);

  function pick(m: MemberResponse) {
    setOpen(false);
    // 본인이 넘기면 확인 — 넘긴 뒤에는 보고자 권한(내용 수정·삭제·보고자 바꾸기)이 새 보고자에게 간다.
    if (reporter && reporter.id === edit.currentUserId) {
      setHandOver(m);
      return;
    }
    change.mutate(m.userId);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setSearch('');
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={labelWithValue('보고자 편집', reporter?.name ?? '알 수 없음')}
            data-testid="reporter-picker-trigger"
            disabled={change.isPending}
            className={
              // 레일은 담당자 필드와 같은 풀폭 px-3 필드, 시트는 오른쪽 값 자리만 차지한다.
              (layout === 'rail' ? 'flex w-full px-3 py-2 ' : 'inline-flex min-w-0 max-w-[70%] px-2 py-1 ') +
              'items-center rounded-md border border-transparent text-left text-sm transition-colors hover:border-input hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
            }
          >
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" data-testid="reporter-picker">
          <Input
            placeholder="멤버 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2"
            aria-label="멤버 검색"
          />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filtered.map((m) => (
              <button
                key={m.userId}
                type="button"
                // 이름·아이디 한 줄 말줄임 — 담당자 픽커와 같은 규칙(WP-461).
                className="flex w-full min-w-0 items-center gap-2 rounded p-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                data-testid={`reporter-option-${m.userId}`}
                title={`${m.name} @${m.username}`}
                onClick={() => pick(m)}
              >
                <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" />
                <span className="min-w-0 truncate text-sm">{m.name}</span>
                <span className="min-w-0 flex-1 basis-0 truncate text-xs text-muted-foreground">@{m.username}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">결과 없음</p>}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={handOver !== null} onOpenChange={(o) => !o && setHandOver(null)}>
        <AlertDialogContent data-testid="reporter-handover-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>보고자를 {handOver?.name}님에게 넘길까요?</AlertDialogTitle>
            <AlertDialogDescription>
              넘기면 보고자로서 가진 권한(이 이슈의 내용 수정·삭제·보고자 바꾸기)도 {handOver?.name}님에게 갑니다. 프로젝트
              소유자·관리자가 아니면 다시 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="reporter-handover-confirm-ok"
              onClick={() => {
                if (handOver) change.mutate(handOver.userId);
                setHandOver(null);
              }}
            >
              넘기기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
