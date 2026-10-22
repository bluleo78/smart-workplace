import { SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { TableCell,TableRow } from './table';

interface TableEmptyRowProps {
  colSpan: number;
  /** 데이터가 절대값 0건일 때 노출할 메시지 (기본: "데이터가 없습니다.") */
  message?: string;
  /** 검색어가 있을 때 우선적으로 노출할 검색어 — 있으면 검색 결과 빈 상태 UI 사용 */
  searchKeyword?: string;
  /** 검색어 초기화 콜백 — 제공 시 "검색 초기화" 버튼 노출 */
  onResetSearch?: () => void;
  /** 진짜 데이터 0건 상태에서 노출할 추가 CTA (예: "새 데이터셋 만들기") */
  emptyAction?: ReactNode;
}

/** 빈 결과 문구에 넣는 검색어의 최대 글자 수 — 긴 검색어(최대 200자, WP-732)가 표를 가로로 늘리지 않게 줄여 보인다. */
const KEYWORD_DISPLAY_MAX = 40;

/** 검색어를 글자(코드 포인트) 단위로 잘라 말줄임표를 붙인다 — 이모지 쌍을 반으로 가르지 않게. */
function shortenKeyword(keyword: string): string {
  const chars = Array.from(keyword);
  return chars.length > KEYWORD_DISPLAY_MAX ? chars.slice(0, KEYWORD_DISPLAY_MAX).join('') + '…' : keyword;
}

/**
 * 테이블 빈 상태 행.
 *
 * - searchKeyword가 있으면 검색 결과 0건 UI ("'<keyword>'에 대한 결과가 없습니다." + "검색 초기화" 버튼)
 * - 그 외에는 기본 메시지 (+ emptyAction CTA)
 */
export function TableEmptyRow({
  colSpan,
  message = '데이터가 없습니다.',
  searchKeyword,
  onResetSearch,
  emptyAction,
}: TableEmptyRowProps) {
  const isSearchEmpty = !!searchKeyword;

  return (
    <TableRow>
      {/* TableCell 기본 nowrap 을 풀어, 문구가 표 너비를 넘지 않고 줄바꿈되게 한다(WP-732). */}
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-12 whitespace-normal">
        {isSearchEmpty ? (
          <div className="flex flex-col items-center gap-3">
            <SearchX className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm">
                <span className="font-medium text-foreground break-all">'{shortenKeyword(searchKeyword)}'</span>
                <span>에 대한 결과가 없습니다.</span>
              </p>
              <p className="text-xs">다른 키워드로 검색해 보세요.</p>
            </div>
            {onResetSearch && (
              <Button variant="outline" size="sm" onClick={onResetSearch}>
                검색 초기화
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm">{message}</p>
            {emptyAction}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
