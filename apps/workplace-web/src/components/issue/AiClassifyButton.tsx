// AI 분류 제안 버튼 + reason 서브텍스트 — IssueCreateDialog/IssuePropertyRail 공유.
// 무엇을: 제목이 있을 때만 활성화, 로딩 중 스피너, 제안 후 reason 인라인 표시.
// 왜: 두 진입점(생성/편집)에서 동일한 UX 를 보장하고 Tailwind 클래스 중복 제거.
import { Info, Loader2 } from 'lucide-react';

import { AiLabel } from '@/components/ai/AiLabel';
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
        className={fullWidth ? 'w-full justify-center' : 'self-start'}
        data-testid="ai-classify-btn"
      >
        {/* AI 트리거 버튼은 AiLabel 프리미티브로 구성한다(07-iconography §7.2 "AI 액션 트리거 버튼").
            직접 Sparkles + violet-* 를 조합하던 이전 구현은 하드코딩 색 금지·재사용 의무를 모두
            위반했다(#746). 로딩 시 Loader2 는 크기 클래스를 주지 않는다 — `h-3.5 w-3.5` 처럼
            size- 접두가 아닌 클래스는 Button cva 의 `[&_svg:not([class*='size-'])]:size-4` 와
            동시 매칭돼 결과가 스타일시트 순서에 좌우된다. */}
        {isPending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span>AI 분석 중…</span>
          </>
        ) : (
          <AiLabel>AI 제안 받기</AiLabel>
        )}
      </Button>

      {/* 제안 이유 서브텍스트 — 제안 후에만 표시 */}
      {reason && (
        <p
          className="text-xs text-muted-foreground flex items-start gap-1 animate-in fade-in slide-in-from-top-1 duration-200"
          data-testid="ai-classify-reason"
        >
          {/* 색 미지정 — 부모 p 의 text-muted-foreground 를 상속한다. 위 버튼이 이미 이 블록을
              AI 로 마킹했으므로 서브텍스트까지 AI 색으로 다시 칠하지 않는다(§7.2 마커 중첩 금지). */}
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{reason}</span>
        </p>
      )}
    </div>
  );
}
