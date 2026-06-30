// AI 분류 제안 버튼 + reason 서브텍스트 — IssueCreateDialog/IssuePropertyRail 공유.
// 무엇을: 제목이 있을 때만 활성화, 로딩 중 스피너, 제안 후 reason 인라인 표시.
// 왜: 두 진입점(생성/편집)에서 동일한 UX 를 보장하고 Tailwind 클래스 중복 제거.
import { Info, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface AiClassifyButtonProps {
  /** 제목 없으면 버튼 비활성화 */
  hasTitle: boolean;
  isPending: boolean;
  /** 제안 후 표시할 이유 한 문장. null/undefined 면 표시 안 함 */
  reason?: string | null;
  onClick: () => void;
  /** true 면 버튼을 컨테이너 전체 폭으로(레일 카드 등). 기본 false(self-start). */
  fullWidth?: boolean;
}

/**
 * AI 분류 제안 버튼 + reason 서브텍스트 컴포넌트.
 * button type="button" — form submit 트리거 방지.
 */
export function AiClassifyButton({
  hasTitle,
  isPending,
  reason,
  onClick,
  fullWidth = false,
}: AiClassifyButtonProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasTitle || isPending}
        onClick={onClick}
        className={`gap-1.5 text-violet-600 border-violet-200 hover:bg-violet-50 hover:border-violet-300 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-950 transition-colors ${
          fullWidth ? 'w-full justify-center' : 'self-start'
        }`}
        data-testid="ai-classify-btn"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span>{isPending ? 'AI 분석 중…' : 'AI 제안 받기'}</span>
      </Button>

      {/* 제안 이유 서브텍스트 — 제안 후에만 표시 */}
      {reason && (
        <p
          className="text-xs text-muted-foreground flex items-start gap-1 animate-in fade-in slide-in-from-top-1 duration-200"
          data-testid="ai-classify-reason"
        >
          <Info className="h-3 w-3 mt-0.5 shrink-0 text-violet-400" />
          <span>{reason}</span>
        </p>
      )}
    </div>
  );
}
