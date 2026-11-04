import { type LucideIcon, X } from 'lucide-react';

import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits';
import { cn } from '@/lib/utils';

import { Input } from './input';

/** 검색 칸(SearchInput)·필터 칸(FilterInput)이 함께 받는 controlled 입력 Props. */
export interface QueryInputProps {
  placeholder?: string;
  /** 스크린리더용 접근 가능 이름. 미지정 시 placeholder를 대신 사용 */
  'aria-label'?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** 입력칸 data-testid(E2E 가 fill 할 대상). */
  inputTestId?: string;
}

interface QueryInputBaseProps extends QueryInputProps {
  /** 왼쪽 장식 아이콘 — 검색은 돋보기, 필터는 깔때기로 하는 일을 모양으로 구분한다(WP-1352). */
  icon: LucideIcon;
  /** 지우기 버튼의 접근 가능 이름 — 「검색어 지우기」/「필터 지우기」. */
  clearLabel: string;
}

/**
 * 아이콘 + 입력 + 지우기 버튼으로 된 한 줄 질의 칸의 공용 구현.
 * SearchInput·FilterInput 은 아이콘·지우기 라벨·기본 자리표시만 다르고 동작은 같아서 여기 하나로 모은다.
 * 화면 코드는 이 컴포넌트를 직접 쓰지 않고 SearchInput(상단 검색) 또는 FilterInput(목록 필터)을 쓴다.
 */
export function QueryInputBase({ icon: Icon, clearLabel, placeholder, 'aria-label': ariaLabel, value, onChange, className, inputTestId }: QueryInputBaseProps) {
  // 값이 있을 때만 노출되는 X(clear) 버튼 — 한 번에 입력을 비울 수 있게 한다.
  // 결과 0건 화면(EmptyState)에서도 동일한 onChange('')로 초기화된다.
  const hasValue = value.length > 0;

  return (
    <div className={cn('relative flex-1 max-w-sm', className)}>
      <Icon aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        // aria-label: 스크린리더에서 입력 목적을 인식할 수 있도록 aria-label 전달.
        // placeholder는 VoiceOver/NVDA에서 accessible name으로 처리되지 않으므로 명시 필요.
        aria-label={ariaLabel ?? placeholder}
        data-testid={inputTestId}
        value={value}
        // 입력 길이 상한 — 검색어·필터 값 모두 서버로 가므로 요청 줄 한도를 넘겨 목록이 실패하지 않게(WP-732)
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pl-9', hasValue && 'pr-9')}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
