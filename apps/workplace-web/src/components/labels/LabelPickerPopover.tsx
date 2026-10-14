// 이슈 상세에서 라벨을 부착/해제하는 픽커.
// 팝오버가 열릴 때 current 를 selected 로 reset, 닫힐 때 변경된 집합만 PUT 호출.
// WP-394: 검색어와 이름이 정확히 같은 라벨이 없으면 「만들기」 행으로 그 자리에서 만들어 바로 선택한다.

import { Plus, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useCreateLabel, useLabels } from '../../hooks/queries/useLabels';
import { useUpdateIssueLabels } from '../../hooks/queries/useUpdateIssueLabels';
import { useSingleLineEnter } from '../../hooks/useSingleLineEnter';
import { DEFAULT_LABEL_COLOR, type LabelSummary } from '../../types/label';
import { LabelChip } from './LabelChip';

export function LabelPickerPopover({
  projectKey,
  issueNumber,
  current,
}: {
  projectKey: string;
  issueNumber: number;
  current: LabelSummary[];
}) {
  const labels = useLabels(projectKey);
  const update = useUpdateIssueLabels(projectKey, issueNumber);
  const create = useCreateLabel(projectKey);
  // Enter 로 만들기 — 한글 조합 Enter·macOS Chrome 꼬리 Enter 는 거른다(공용 훅).
  const { handleEnter, onCompositionEnd } = useSingleLineEnter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(() => current.map((l) => l.id));

  const filtered = useMemo(
    () =>
      (labels.data ?? []).filter((l) =>
        l.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [labels.data, search],
  );

  // 만들 이름 — 서버 유일 제약(project_id, name)이 대소문자를 구분하므로 정확 일치일 때만 「이미 있음」으로 본다.
  const newName = search.trim();
  const canCreate =
    newName.length > 0 && labels.isSuccess && !labels.data.some((l) => l.name === newName);

  // 새 라벨을 만들고 선택 집합에 넣는다 — 이슈 부착은 기존 흐름대로 팝오버가 닫힐 때 한 번에 PUT.
  function createAndSelect() {
    if (!canCreate || create.isPending) return;
    create.mutate(
      { name: newName, colorToken: DEFAULT_LABEL_COLOR },
      {
        onSuccess: (label) => {
          setSelected((prev) => [...prev, label.id]);
          setSearch('');
        },
      },
    );
  }

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // 열릴 때: 현재 부착 집합을 selected 로 초기화 (외부 갱신 반영).
  // 닫힐 때: 정렬 후 비교해 변경된 경우만 mutate — 동일하면 네트워크 호출 X.
  function onOpenChange(next: boolean) {
    // 만드는 중에 닫으면 새 라벨이 선택 집합에 들기 전에 PUT 되어 이슈에 안 붙는다 — 생성이 끝날 때까지 열어 둔다.
    if (!next && create.isPending) return;
    if (next) {
      setSelected(current.map((l) => l.id));
      setSearch('');
    } else {
      const before = current
        .map((l) => l.id)
        .sort((a, b) => a - b)
        .join(',');
      const after = [...selected].sort((a, b) => a - b).join(',');
      if (before !== after) update.mutate(selected);
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="라벨 편집" data-testid="label-picker-trigger">
          <Tag className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" data-testid="label-picker">
        <Input
          placeholder="라벨 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          // Enter 로 바로 만들기 — 겹치는 라벨이 하나도 없을 때만(「front」로 걸러 frontend 를 찾던 중이면 새로 만들지 않는다).
          onKeyDown={(e) =>
            handleEnter(e, () => {
              if (filtered.length === 0) createAndSelect();
            })
          }
          onCompositionEnd={onCompositionEnd}
          className="mb-2"
          aria-label="라벨 검색"
        />
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
              data-testid={`label-option-${l.id}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(l.id)}
                onChange={() => toggle(l.id)}
                aria-label={l.name}
              />
              <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} />
            </label>
          ))}
          {filtered.length === 0 && !canCreate && (
            <p className="text-xs text-muted-foreground py-2 text-center">결과 없음</p>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={createAndSelect}
            disabled={create.isPending}
            className="mt-1 flex w-full items-center gap-2 rounded border-t p-1 pt-2 text-left text-sm hover:bg-accent disabled:opacity-60"
            data-testid="label-create-option"
          >
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">
              <span className="font-medium">「{newName}」</span> 라벨 만들기
            </span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
