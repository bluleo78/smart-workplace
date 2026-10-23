// 이슈 목록 「▦ 열」 메뉴(WP-270) — 필터 막대의 그룹 선택 옆에서 표시할 선택 열을 켜고 끈다.
// 체크박스·상태·ID·제목·⋯ 는 항상 보이는 고정 열이라 메뉴에 없다. 열 순서는 고정이라(스펙 4.4) 켜고 끄기만 한다.
// 완료일 기간 필터가 걸려 완료일 열이 자동으로 보이는 동안엔 그 항목을 체크·비활성으로 두고 「필터로 켜짐」을 붙인다(스펙 4.5).
import { Columns3 } from 'lucide-react';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { Button } from '@/components/ui/button';

import { useCustomFields } from '../../../hooks/queries/useCustomFields';
import type { BuiltinColumnKey, IssueListColumnKey } from '../../../lib/issueListColumns';
import type { IssueFieldDef } from '../../../types/customField';
import { useIssueListColumns } from '../hooks/useIssueListColumns';

// 내장 선택 열 묶음 — 스펙 4.4 의 기본 켜짐 / 날짜 / 사람·분류. 문구는 목록 헤더와 같다.
const BUILTIN_GROUPS: { label: string | null; items: { key: BuiltinColumnKey; label: string }[] }[] = [
  {
    label: null,
    items: [
      { key: 'priority', label: '우선순위' },
      { key: 'assignee', label: '담당자' },
      { key: 'due', label: '마감' },
    ],
  },
  {
    label: '날짜',
    items: [
      { key: 'closed', label: '완료일' },
      { key: 'start', label: '시작일' },
      { key: 'created', label: '생성일' },
      { key: 'updated', label: '수정일' },
    ],
  },
  {
    label: '사람·분류',
    items: [
      { key: 'reporter', label: '보고자' },
      { key: 'milestone', label: '마일스톤' },
      { key: 'cycle', label: '사이클' },
    ],
  },
];

const GROUP_LABEL_CLASS = 'text-xs font-normal text-muted-foreground';

export interface IssueColumnPickerProps {
  /** 사용자가 고른 열(자동 완료일 열 제외) — 체크 상태와 토글 계산의 기준. 화면에 그린 열을 넘기면 자동 열이 저장돼 버린다. */
  columns: IssueListColumnKey[];
  /** 완료일 열이 완료일 필터로 자동 표시 중인가. */
  autoClosed: boolean;
  /** 이 프로젝트의 커스텀 필드 정의(position 순으로 보인다). 로딩 중엔 빈 배열. */
  fieldDefs: IssueFieldDef[];
  onChange: (keys: IssueListColumnKey[]) => void;
  onReset: () => void;
  /** 메뉴가 열리고 닫힐 때 — 감싸는 쪽이 이때 커스텀 필드 정의를 불러온다. */
  onOpenChange?: (open: boolean) => void;
}

/** 열 메뉴(표시 전용) — 체크 상태·토글 결과만 계산하고 저장 위치(URL/개인값)는 onChange 를 받는 쪽이 정한다. */
export function IssueColumnPicker({ columns, autoClosed, fieldDefs, onChange, onReset, onOpenChange }: IssueColumnPickerProps) {
  const toggle = (key: IssueListColumnKey) =>
    onChange(columns.includes(key) ? columns.filter((k) => k !== key) : [...columns, key]);
  const customs = [...fieldDefs].sort((a, b) => a.position - b.position);

  // 한 항목 — 고른 뒤에도 메뉴를 닫지 않는다(preventDefault): 여러 열을 연달아 켜고 끄며 뒤의 표를 볼 수 있게.
  const item = (key: IssueListColumnKey, label: string) => {
    const auto = key === 'closed' && autoClosed;
    return (
      <DropdownMenuCheckboxItem
        key={key}
        checked={auto || columns.includes(key)}
        disabled={auto}
        data-testid={`issue-column-option-${key}`}
        onSelect={(e) => {
          e.preventDefault();
          toggle(key);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {/* sr-only 구분어 — 스크린리더가 「완료일필터로 켜짐」 으로 붙여 읽지 않게(모양은 그대로). */}
        {auto && (
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="sr-only">, </span>필터로 켜짐
          </span>
        )}
      </DropdownMenuCheckboxItem>
    );
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="issue-column-picker">
          <Columns3 aria-hidden="true" /> 열
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-56 overflow-y-auto" data-testid="issue-column-menu">
        <DropdownMenuLabel>표시할 열</DropdownMenuLabel>
        {BUILTIN_GROUPS.map((g) => (
          <div key={g.label ?? 'default'} role="group" aria-label={g.label ?? '기본'}>
            {g.label && <DropdownMenuLabel className={GROUP_LABEL_CLASS}>{g.label}</DropdownMenuLabel>}
            {g.items.map((it) => item(it.key, it.label))}
          </div>
        ))}
        {customs.length > 0 && (
          <div role="group" aria-label="커스텀 필드">
            <DropdownMenuLabel className={GROUP_LABEL_CLASS}>커스텀 필드</DropdownMenuLabel>
            {customs.map((d) => item(`cf${d.id}`, d.name))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="issue-column-reset" onSelect={onReset}>
          기본 열로 되돌리기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 필터 막대에 놓는 열 메뉴 — 열 구성 훅과 커스텀 필드 정의를 이어 붙인다.
 * 커스텀 필드 정의는 메뉴를 처음 열 때 불러온다 — 열 메뉴를 쓰지 않는 대부분의 화면 진입에 요청을 더하지 않으려고.
 * (목록은 커스텀 열이 켜졌을 때만 같은 쿼리를 요청하므로, 한 번 불러오면 캐시를 함께 쓴다.)
 */
export function IssueColumnPickerButton({ projectKey, closedFilterActive }: { projectKey: string; closedFilterActive: boolean }) {
  const { chosen, autoClosed, setChosen, reset } = useIssueListColumns(projectKey, closedFilterActive);
  const [opened, setOpened] = useState(false);
  const fields = useCustomFields(projectKey, { enabled: opened });
  return (
    <IssueColumnPicker
      columns={chosen}
      autoClosed={autoClosed}
      fieldDefs={fields.data ?? []}
      onChange={setChosen}
      onReset={reset}
      onOpenChange={(o) => {
        if (o) setOpened(true);
      }}
    />
  );
}
