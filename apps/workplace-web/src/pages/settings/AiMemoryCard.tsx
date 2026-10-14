// 설정 > AI 비서 "메모리" 카드(WP-55, 시안 A + 2차 시안 상태) — 추천 질문 카드 바로 아래, 개인 비서 유무와 관계없이 보인다.
// 스위치(메모리 사용)는 채팅과 같은 ai-preferences 캐시를 바꾼다. 꺼져 있어도 목록 편집·삭제·추가는 그대로 되며 목록만 흐리게 보인다.
// WP-379(시안 B): 목록을 범위 묶음(공통 → 이슈 → … → 캘린더, 빈 범위 숨김)으로 보이고 한도·카운트·가득 참 경고는 묶음마다(AiMemoryScopeGroup).
// 직접 추가는 모든 범위가 가득일 때만 막는다.
import { useMemo, useState } from 'react';

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAiMemories, useClearAiMemories } from '@/hooks/queries/useAiMemories';
import { useAiPreferences, useUpdateAiPreferences } from '@/hooks/queries/useAiPreferences';
import { fullScopeKeys, groupMemories, MEMORY_LIMIT, SCOPE_ORDER } from '@/lib/aiMemory';
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

  // 응답 전·구 API(필드 없음)는 켜짐으로 그린다 — 서버 기본(NULL = 켜짐)과 같다.
  const enabled = prefs.data?.memoryEnabled ?? true;
  const items = memories.data?.items ?? NO_ITEMS;
  const limit = memories.data?.limit ?? MEMORY_LIMIT;
  // 목록이 바뀔 때만 다시 묶는다 — 스위치·추가 폼 등 다른 상태로 다시 그릴 때 매번 나누지 않게.
  const groups = useMemo(() => groupMemories(items), [items]);
  const fullScopes = useMemo(() => fullScopeKeys(groups, limit), [groups, limit]);
  // 모든 범위가 가득일 때만 추가를 막는다 — 하나라도 남으면 폼이 그 범위를 기본으로 고른다.
  const allFull = fullScopes.size === SCOPE_ORDER.length;

  return (
    <Card data-testid="ai-memory-card">
      <CardHeader>
        <CardTitle>메모리</CardTitle>
        <CardDescription>대화에서 알려 준 선호·교정과 업무 맥락을 기억해 다음 대화에 반영해요. 나만 볼 수 있어요.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">메모리 사용</p>
            <p data-testid="ai-memory-toggle-hint" className="text-xs text-muted-foreground">
              {enabled ? '끄면 저장도 반영도 하지 않아요 (목록은 남아요)' : '꺼져 있어요 — 새로 저장하지 않고 대화에도 반영하지 않아요'}
            </p>
          </div>
          <Switch
            data-testid="ai-memory-toggle"
            checked={enabled}
            // 응답 전 연타로 요청 순서가 엇갈리지 않게 저장 중엔 잠근다(추천 질문 스위치와 같은 이유).
            disabled={!prefs.isSuccess || updatePrefs.isPending}
            onCheckedChange={(v) => updatePrefs.mutate({ memoryEnabled: v })}
            aria-label="메모리 사용"
          />
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
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <AiMemoryScopeGroup key={g.key} group={g} limit={limit} fullScopes={fullScopes} />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              className="ml-auto text-destructive hover:text-destructive pointer-coarse:min-h-11"
              onClick={() => setConfirmOpen(true)}
            >
              모두 지우기
            </Button>
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
      </CardContent>
    </Card>
  );
}
