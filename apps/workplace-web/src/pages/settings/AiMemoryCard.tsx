// 설정 > AI 비서 "메모리" 카드(WP-55, 시안 A + 2차 시안 상태) — 추천 질문 카드 바로 아래, 개인 비서 유무와 관계없이 보인다.
// 스위치(메모리 사용)는 채팅과 같은 ai-preferences 캐시를 바꾸고, 목록은 최신순 전부(최대 50줄, 접지 않음). 꺼져 있어도 목록 편집·삭제·추가는
// 그대로 되며 목록만 흐리게 보인다. 45개부터 카운트 주황, 50개면 추가 비활성 + 경고.
import { useState } from 'react';

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
import { listCountTone, MEMORY_LIMIT } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import { AiMemoryAddForm } from '@/pages/settings/AiMemoryAddForm';
import { AiMemoryRow } from '@/pages/settings/AiMemoryRow';

export function AiMemoryCard() {
  const prefs = useAiPreferences();
  const updatePrefs = useUpdateAiPreferences();
  const memories = useAiMemories();
  const clear = useClearAiMemories();
  const [adding, setAdding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 응답 전·구 API(필드 없음)는 켜짐으로 그린다 — 서버 기본(NULL = 켜짐)과 같다.
  const enabled = prefs.data?.memoryEnabled ?? true;
  const items = memories.data?.items ?? [];
  const limit = memories.data?.limit ?? MEMORY_LIMIT;
  const full = items.length >= limit;

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
          {adding && <AiMemoryAddForm onClose={() => setAdding(false)} />}
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
            <ul data-testid="ai-memory-list" className="divide-y rounded-md border">
              {items.map((m) => (
                <AiMemoryRow key={m.id} item={m} />
              ))}
            </ul>
          )}
        </div>

        {full && (
          <p data-testid="ai-memory-full" className="text-xs text-warning-text">
            메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="ai-memory-add"
            className="pointer-coarse:min-h-11"
            disabled={full || adding || !memories.isSuccess}
            onClick={() => setAdding(true)}
          >
            ＋ 직접 추가
          </Button>
          <span data-testid="ai-memory-count" className={cn('text-xs tabular-nums', listCountTone(items.length))}>
            {items.length} / {limit}
          </span>
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
                기억한 내용 {items.length}개가 모두 삭제되고 되돌릴 수 없어요. 다음 대화부터 반영되지 않아요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction variant="destructive" data-testid="ai-memory-clear-confirm" onClick={() => clear.mutate()}>
                모두 지우기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
