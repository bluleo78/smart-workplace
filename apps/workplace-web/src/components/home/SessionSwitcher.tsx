import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { HomeSessionSummary } from '@/types/home';

interface Props {
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

// 상대 시각(분/시간/일) 간단 표기.
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 캔버스 헤더 세션 스위처 — 현재 세션 제목 ▾, ＋새 세션 + 최근 세션 목록·삭제. */
export function SessionSwitcher({ sessions, currentSessionId, onNew, onSelect, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const current = sessions.find((s) => s.id === currentSessionId);
  const label = current?.title ?? '새 세션';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
        data-testid="session-switcher"
      >
        {label}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem
          data-testid="session-new"
          onSelect={() => {
            setOpen(false);
            onNew();
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> 새 세션
        </DropdownMenuItem>
        {sessions.length > 0 && <DropdownMenuSeparator />}
        {sessions.map((s) => (
          // 행 자체는 비-DropdownMenuItem div(삭제 버튼과 onSelect 충돌 방지). open 은 수동 제어.
          <div
            key={s.id}
            data-testid="session-item"
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
              s.id === currentSessionId && 'bg-ai-accent-subtle',
            )}
          >
            <button
              type="button"
              data-testid="session-select"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                setOpen(false);
                onSelect(s.id);
              }}
            >
              <div className="truncate">{s.title}</div>
              <div className="text-xs text-muted-foreground">
                {relTime(s.lastMessageAt)} · 위젯 {s.widgetCount}
              </div>
            </button>
            <button
              type="button"
              aria-label="세션 삭제"
              data-testid="session-delete"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(s.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
