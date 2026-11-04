import { Search } from 'lucide-react';

import { QueryInputBase, type QueryInputProps } from './query-input';

/**
 * 검색 칸 — 어디 있는지 모르는 것을 찾는 입력(상단 전체 검색 쪽)에만 쓴다. 돋보기 아이콘.
 * 지금 보는 목록을 좁히는 칸은 FilterInput(깔때기)을 쓴다 — 디자인 시스템 05 「검색과 필터」(WP-1352).
 */
export function SearchInput({ placeholder = '검색...', ...props }: QueryInputProps) {
  return <QueryInputBase icon={Search} clearLabel="검색어 지우기" placeholder={placeholder} {...props} />;
}
