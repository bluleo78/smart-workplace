// 보드 범주 띠(WP-808, 데스크톱 B안) — 컬럼 위에 할 일·진행 중·완료·취소 띠를 두고, 각 띠는 그 범주 컬럼 폭만큼 걸친다.
// 보드 그리드(BoardScroll)의 첫 줄 셀로 렌더된다 — 컬럼과 같은 그리드라 가로 스크롤·gap 까지 정확히 맞는다.
// 세로 스크롤에도 위에 붙어 있다(sticky, 높이 BAND_HEIGHT_CLASS) — 컬럼 헤더는 그 바로 아래(top-9)에 붙는다.
// OWNER(canEdit)에게만 띠 끝 ＋ — 그 범주 맨 뒤에 이름만 입력해 상태를 만든다(범주는 위치로 정해진다).
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { CATEGORY_COLOR } from '@/components/issues/issueCategoryColor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import type { CategorySpan } from '@/lib/projectStatuses';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';
import type { ProjectStatus } from '@/types/projectStatus';

import { NewStatusPopoverBody } from './StatusNameEditor';

export function BoardCategoryBand({
  spans,
  canEdit,
  statuses,
  onAdd,
}: {
  spans: CategorySpan[];
  canEdit: boolean;
  // 이름 중복 검사용 상태 목록.
  statuses: ProjectStatus[];
  // 그 범주 맨 뒤에 상태를 만든다 — 실패하면 reject(입력기가 오류를 보인다).
  onAdd: (category: IssueStatus, name: string) => Promise<void>;
}) {
  return (
    <>
      {spans.map((s) => (
        // 바깥 칸 = sticky 배경(아래 여백 pb-2 가 컬럼과의 간격), 안쪽 = 범주 색 밑줄 띠.
        <div
          key={s.category}
          // 동적 컬럼 수라 Tailwind 클래스로 만들 수 없어 인라인 grid-column 으로 걸친다.
          style={{ gridColumn: `span ${s.count}` }}
          className="sticky top-0 z-20 h-9 min-w-0 bg-background pb-2"
        >
          <div
            className={cn('flex h-full min-w-0 items-center justify-between gap-2 border-b-2 px-1 text-xs font-semibold', CATEGORY_COLOR[s.category].band)}
            data-testid={`board-band-${s.category}`}
          >
            {/* 라벨은 왼쪽에 붙는다(sticky left) — 가로로 스크롤해 띠 앞부분이 지나가도 범주 이름이 남는다(＋ 의 sticky right 와 짝). */}
            <span className="sticky left-0 truncate bg-background pr-1">{s.label}</span>
            {canEdit && <BandAddButton span={s} statuses={statuses} onAdd={onAdd} />}
          </div>
        </div>
      ))}
    </>
  );
}

// 띠 끝 ＋ — 팝오버에 이름 입력기. 저장되면 닫는다.
function BandAddButton({
  span,
  statuses,
  onAdd,
}: {
  span: CategorySpan;
  statuses: ProjectStatus[];
  onAdd: (category: IssueStatus, name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // sticky right-0 — 띠가 화면보다 넓어도(진행 중 컬럼이 많을 때) 보이는 오른쪽 끝에 붙어 늘 누를 수 있다.
          className="sticky right-0 h-6 w-6 shrink-0 bg-background text-current hover:text-current"
          aria-label={`${span.label}에 상태 추가`}
          data-testid={`board-band-add-${span.category}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3">
        <NewStatusPopoverBody
          subtitle={span.label}
          statuses={statuses}
          onSubmit={(name) => onAdd(span.category, name)}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
