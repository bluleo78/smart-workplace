// 감사 로그 결과 필터 — 비모달 드롭다운 메뉴(라디오) (WP-2081).
// 왜 Select 가 아닌가: Radix Select 는 항상 모달이라 열 때 <body> 를 잠가(스크롤 잠금·pointer-events:none·<style> 주입)
// 문서 전체 스타일 재계산이 두 번 일어난다(비용의 ~70%). DropdownMenu modal={false} 는 body 를 건드리지 않는다.
import { ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { AUDIT_RESULTS } from '@/lib/auditLogLabels';

/** 결과 필터 항목 — 값 '' 가 「전체 결과」(라디오 메뉴는 빈 값을 그대로 받아 'all' 같은 변환이 필요 없다) */
const OPTIONS = [{ value: '', label: '전체 결과' }, ...AUDIT_RESULTS];

/** 결과 필터 단추와 메뉴 — 고른 값을 단추 글자·접근 이름에 보이고, 고르면 onChange 로 값을 넘긴다 */
export function AuditResultFilter({
  value,
  onChange,
}: {
  /** '' = 전체 결과, 'SUCCESS' | 'FAILURE' */
  value: string;
  /** 전체 결과를 고르면 ''(상태 계약 유지 — 요청 파라미터 result 가 빠진다) */
  onChange: (value: string) => void;
}) {
  // 단추 글자 — 모르는 값은 「전체 결과」로 보인다
  const label = OPTIONS.find((o) => o.value === value)?.label ?? '전체 결과';
  return (
    // modal={false} 가 성능 수정의 핵심 — 절대 제거하지 않는다.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* 기존 SelectTrigger 와 같은 모양(폭·테두리·높이·ChevronDown) */}
        <button
          type="button"
          aria-label={`결과 필터: ${label}`}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-[120px] shrink-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="line-clamp-1">{label}</span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      {/* 메뉴 폭을 단추 폭 이상으로 맞춘다(기존 Select 와 같은 느낌) */}
      <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
