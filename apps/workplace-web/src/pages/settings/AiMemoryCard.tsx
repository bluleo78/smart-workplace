// 설정 > AI 비서 "메모리" 섹션(WP-55, 시안 A + 2차 시안 상태) — 추천 질문 섹션 바로 아래, 개인 비서 유무와 관계없이 보인다.
// 스위치(메모리 사용)는 채팅과 같은 ai-preferences 캐시를 바꾼다. 꺼져 있어도 목록 편집·삭제·추가는 그대로 되며 목록만 흐리게 보인다.
// WP-379(시안 B): 목록을 범위 묶음(공통 → 이슈 → … → 캘린더, 빈 범위 숨김)으로 보이고 한도·카운트·가득 참 경고는 묶음마다(AiMemoryScopeGroup).
// 직접 추가는 모든 범위가 가득일 때만 막는다.
// WP-383: 범위마다 300개 — 전체 20개 초과면 검색칸(내용 부분 일치, 클라이언트 필터), 행은 인피니트 스크롤(처음 30행, 목록 끝 sentinel 이 보일 때마다 +30).
// 묶음 카운트 n / 300 은 거르기 전 그대로(검색 중엔 앞에 "N개 일치"). 고정 상한(pinLimit)을 묶음에 넘기고, 툴팁(고정 막힘)용 Provider 를 목록에 둔다.
// 직접 추가·모두 지우기는 목록 위 도구 줄(검색칸 오른쪽)에 둔다 — 인피니트 스크롤로 행이 늘 때마다 섹션 맨 아래 버튼이 밀려나지 않게.
import { useCallback, useMemo, useState } from 'react';

import { useSettingsScrollRoot } from '@/components/layout/settingsScrollRoot';
import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection';
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
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAiMemories, useClearAiMemories } from '@/hooks/queries/useAiMemories';
import { useAiPreferences, useUpdateAiPreferences } from '@/hooks/queries/useAiPreferences';
import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { fullScopeKeys, groupMemories, MEMORY_LIMIT, PIN_LIMIT, ROWS_PAGE, SCOPE_ORDER, SEARCH_OVER, visibleGroups } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import { AiMemoryAddForm } from '@/pages/settings/AiMemoryAddForm';
import { AiMemoryScopeGroup } from '@/pages/settings/AiMemoryScopeGroup';
import type { AiMemoryItem } from '@/types/aiMemory';

/** 응답 전 빈 목록 — 렌더마다 새 배열을 만들지 않아 묶음 계산 memo 가 유지된다. */
const NO_ITEMS: AiMemoryItem[] = [];

export function AiMemoryCard() {
  const prefs = useAiPreferences();
  const updatePrefs = useUpdateAiPreferences();
  const memories = useAiMemories();
  const clear = useClearAiMemories();
  const [adding, setAdding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 인피니트 스크롤 — 지금까지 그리기로 한 행 수(처음 30, sentinel 이 보일 때마다 +30).
  const [shown, setShown] = useState(ROWS_PAGE);
  const scrollRoot = useSettingsScrollRoot();

  // 응답 전·구 API(필드 없음)는 켜짐으로 그린다 — 서버 기본(NULL = 켜짐)과 같다.
  const enabled = prefs.data?.memoryEnabled ?? true;
  const items = memories.data?.items ?? NO_ITEMS;
  const limit = memories.data?.limit ?? MEMORY_LIMIT;
  // 목록이 바뀔 때만 다시 묶는다 — 스위치·추가 폼 등 다른 상태로 다시 그릴 때 매번 나누지 않게.
  const groups = useMemo(() => groupMemories(items), [items]);
  const fullScopes = useMemo(() => fullScopeKeys(groups, limit), [groups, limit]);
  // 모든 범위가 가득일 때만 추가를 막는다 — 하나라도 남으면 폼이 그 범위를 기본으로 고른다.
  const allFull = fullScopes.size === SCOPE_ORDER.length;
  const pinLimit = memories.data?.pinLimit ?? PIN_LIMIT;
  // 전체가 20개를 넘을 때만 검색칸 — 지워서 20개 이하가 되면 칸과 함께 질의도 버린다(다시 20개를 넘었을 때 보이지 않던 질의가 되살아나
  // 목록을 가리지 않게). 렌더 중 갱신은 이전 렌더 값에 맞춰 상태를 고치는 React 권장 방식이다(이펙트로 한 번 더 그리지 않는다).
  const searchable = items.length > SEARCH_OVER;
  if (!searchable && query !== '') setQuery('');
  const activeQuery = searchable ? query : '';
  const searching = activeQuery.trim() !== '';
  const { views, total, hasMore } = useMemo(() => visibleGroups(groups, activeQuery, shown), [groups, activeQuery, shown]);
  // 무한 쿼리가 아니라 그릴 행 수를 늘리는 것. useLoadMoreSentinel 은 fetchNextPage 가 바뀔 때 observer 를 다시 붙이고 그때 첫 교차 콜백이
  // 다시 온다 — shown 마다 새 함수라, 늘린 뒤에도 sentinel 이 보이면(키 큰 화면·축소 보기) 스크롤 없이 이어서 늘린다.
  const showMore = useCallback(() => setShown(shown + ROWS_PAGE), [shown]);
  const sentinelRef = useLoadMoreSentinel({ hasNextPage: hasMore, isFetching: false, isFetchNextPageError: false, fetchNextPage: showMore }, scrollRoot);
  const onQueryChange = (v: string) => {
    setQuery(v);
    setShown(ROWS_PAGE); // 질의가 바뀌면 처음 30행부터
  };

  return (
    <SettingsSection
      data-testid="ai-memory-card"
      title="메모리"
      description="대화에서 알려 준 선호·교정과 업무 맥락을 기억해 다음 대화에 반영해요. 나만 볼 수 있어요."
    >
      <SettingsToggleRow
        label="메모리 사용"
        description={
          <span data-testid="ai-memory-toggle-hint">
            {enabled ? '끄면 저장도 반영도 하지 않아요 (목록은 남아요)' : '꺼져 있어요 — 새로 저장하지 않고 대화에도 반영하지 않아요'}
          </span>
        }
        control={
          <Switch
            data-testid="ai-memory-toggle"
            checked={enabled}
            // 응답 전 연타로 요청 순서가 엇갈리지 않게 저장 중엔 잠근다(추천 질문 스위치와 같은 이유).
            disabled={!prefs.isSuccess || updatePrefs.isPending}
            onCheckedChange={(v) => updatePrefs.mutate({ memoryEnabled: v })}
            aria-label="메모리 사용"
          />
        }
      />

      {/* 도구 줄 — 검색칸(20개 초과) · 직접 추가 · 모두 지우기. 목록 위에 있어 행이 늘어도 자리가 그대로다. 좁으면 버튼이 다음 줄로 내려간다. */}
      <div data-testid="ai-memory-toolbar" className="flex flex-wrap items-center gap-2">
        {searchable && (
          <SearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="메모리 검색"
            className="min-w-48 max-w-none flex-1 pointer-coarse:[&_input]:h-11"
            inputTestId="ai-memory-search"
          />
        )}
        <Button
          variant="outline"
          size="sm"
          data-testid="ai-memory-add"
          className="pointer-coarse:min-h-11"
          disabled={allFull || adding || !memories.isSuccess}
          onClick={() => setAdding(true)}
        >
          ＋ 직접 추가
        </Button>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="ai-memory-clear"
            className={cn('text-destructive hover:text-destructive pointer-coarse:min-h-11', !searchable && 'ml-auto')}
            onClick={() => setConfirmOpen(true)}
          >
            모두 지우기
          </Button>
        )}
      </div>

      {/* 꺼짐: 목록만 흐리게 — 편집·삭제·추가는 그대로(사용자가 직접 하는 정리). */}
      <div data-testid="ai-memory-list-area" className={cn('space-y-2 transition-opacity', !enabled && 'opacity-60')}>
        {adding && <AiMemoryAddForm fullScopes={fullScopes} onClose={() => setAdding(false)} />}
        {memories.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : memories.isError ? (
          <p className="text-sm text-destructive">메모리를 불러오지 못했어요.</p>
        ) : items.length === 0 ? (
          !adding && (
            <p data-testid="ai-memory-empty" className="text-sm text-muted-foreground">
              아직 기억한 내용이 없어요. 대화에서 '앞으로는 ~해줘'라고 말하거나 직접 추가해 보세요.
            </p>
          )
        ) : searching && total === 0 ? (
          <p data-testid="ai-memory-search-empty" className="text-sm text-muted-foreground">
            '{activeQuery.trim()}'와 일치하는 메모리가 없어요.
          </p>
        ) : (
          <TooltipProvider>
            <div className="space-y-4 pt-2">
              {views.map((v) => (
                <AiMemoryScopeGroup
                  key={v.group.key}
                  group={v.group}
                  rows={v.rows}
                  matched={searching ? v.matched : null}
                  limit={limit}
                  pinLimit={pinLimit}
                  fullScopes={fullScopes}
                />
              ))}
              {/* 인피니트 스크롤 sentinel — 목록 끝이 보이면 30행 더. 더 없으면 observer 가 꺼진다. */}
              <div ref={sentinelRef} data-testid="ai-memory-sentinel" aria-hidden className="h-px" />
            </div>
          </TooltipProvider>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="ai-memory-clear-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>메모리를 모두 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>
              모든 범위의 메모리 {items.length}개가 삭제되고 되돌릴 수 없어요. 다음 대화부터 반영되지 않아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="ai-memory-clear-confirm" disabled={clear.isPending} onClick={() => clear.mutate()}>
              모두 지우기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
