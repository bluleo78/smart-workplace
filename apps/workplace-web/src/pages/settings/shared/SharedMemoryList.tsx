// WP-386 고른 공간의 공용 메모리 — 제목(데스크톱) · n / 50 · (기록 보기, Task 17 headerAction) · 안내 문구, 검색칸(서버 q, 300ms) · 「＋ 직접 추가」(canAdd),
// 목록은 인피니트 스크롤(30개씩 — 설정 본문 스크롤을 root 로 끝 sentinel 이 보이면 다음 묶음). 「N개 더 보기」 버튼은 쓰지 않는다(디자인 시스템 §A-3).
import { type ReactNode, useMemo, useState } from 'react';

import { useSettingsScrollRoot } from '@/components/layout/settingsScrollRoot';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateSharedAiMemory, useSharedAiMemories } from '@/hooks/queries/useSharedAiMemories';
import { useDebounceValue } from '@/hooks/useDebounceValue';
import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { refOf, spaceHint, spaceLabel } from '@/lib/sharedAiMemory';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import { SharedMemoryRow } from '@/pages/settings/shared/SharedMemoryRow';
import type { SharedMemorySpace } from '@/types/sharedAiMemory';

export function SharedMemoryList({ space, headerAction }: { space: SharedMemorySpace; headerAction?: ReactNode }) {
  const ref = useMemo(() => refOf(space), [space]);
  const scrollRoot = useSettingsScrollRoot();
  const [query, setQuery] = useState('');
  const q = useDebounceValue(query.trim(), 300);
  const list = useSharedAiMemories(ref, q);
  const create = useCreateSharedAiMemory(ref);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const sentinel = useLoadMoreSentinel(list, scrollRoot);
  const items = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);
  const count = list.data?.pages[0]?.count ?? space.count;
  const limit = list.data?.pages[0]?.limit ?? space.limit;
  // 가득 차면 추가 버튼만 막히면 이유를 알 수 없다 — 이유 한 줄을 보이고 버튼에 연결한다(개인 메모리의 「가득 찼어요」 경고와 같은 warning-text).
  const full = count >= limit;
  const add = () =>
    create.mutate(draft.trim(), {
      onSuccess: () => {
        setDraft('');
        setAdding(false);
      },
    });

  return (
    <div className="min-w-0 space-y-3" data-testid="shared-space-body">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          {/* 좁은 탭(@container 640px 미만)은 위 선택 상자가 이름을 보여 주므로 개수·기록만 */}
          <h3 data-testid="shared-space-title" className="hidden min-w-0 truncate text-sm font-semibold @min-[640px]:block">
            {spaceLabel(space)}
          </h3>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span data-testid="shared-space-count" className="text-xs tabular-nums text-muted-foreground">
              {count} / {limit}
            </span>
            {headerAction}
          </div>
        </div>
        <p data-testid="shared-space-hint" className="break-keep text-xs text-muted-foreground">
          {spaceHint(space)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="공용 메모리 검색"
          className="min-w-40 max-w-none flex-1 pointer-coarse:[&_input]:h-11"
          inputTestId="shared-memory-search"
        />
        {space.canAdd && (
          <Button
            variant="outline"
            size="sm"
            data-testid="shared-memory-add"
            className="pointer-coarse:min-h-11"
            disabled={adding || full}
            aria-describedby={full ? 'shared-memory-full-hint' : undefined}
            onClick={() => setAdding(true)}
          >
            ＋ 직접 추가
          </Button>
        )}
      </div>

      {space.canAdd && full && (
        <p id="shared-memory-full-hint" data-testid="shared-memory-full-hint" className="break-keep text-xs text-warning-text">
          가득 찼어요 — 지우거나 합친 뒤 추가할 수 있어요. (AI도 새로 저장하지 못해요)
        </p>
      )}

      {adding && (
        <div data-testid="shared-memory-add-form" className="space-y-2 rounded-md border p-3">
          <AiMemoryContentEditor
            value={draft}
            onChange={setDraft}
            onCancel={() => {
              setDraft('');
              setAdding(false);
            }}
            onSubmit={add}
            submitLabel="추가"
            pending={create.isPending}
            rows={2}
            placeholder="예: 이슈 본문은 배경·할 일·완료 조건 순서로 쓴다"
            ariaLabel="추가할 공용 메모리"
            testIdPrefix="shared-memory-add"
          />
        </div>
      )}

      {q && list.isSuccess && (
        <p data-testid="shared-memory-matched" className="text-xs text-muted-foreground">
          {items.length > 0 ? `${items.length}개 일치` : `'${q}'와 일치하는 공용 메모리가 없어요.`}
        </p>
      )}

      {list.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">공용 메모리를 불러오지 못했어요.</p>
      ) : items.length === 0 ? (
        !q &&
        !adding && (
          <p data-testid="shared-memory-empty" className="break-keep text-sm text-muted-foreground">
            아직 이 공간에 공용 메모리가 없어요. AI 비서에게 「이건 팀 규칙으로 기억해」라고 말하거나 직접 추가해 보세요.
          </p>
        )
      ) : (
        <ul data-testid="shared-memory-list" className="divide-y rounded-md border">
          {items.map((m) => (
            <SharedMemoryRow key={m.id} item={m} space={ref} />
          ))}
        </ul>
      )}
      {/* 인피니트 스크롤 sentinel — 목록 끝이 보이면 다음 30개. 더 없거나 실패하면 observer 가 꺼진다. */}
      <div ref={sentinel} data-testid="shared-memory-sentinel" aria-hidden className="h-px" />
      {list.isFetchingNextPage && <p className="py-2 text-center text-xs text-muted-foreground">불러오는 중…</p>}
      {list.isFetchNextPageError && (
        <div className="py-2 text-center">
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => void list.fetchNextPage()}>
            다시 시도
          </Button>
        </div>
      )}
    </div>
  );
}
