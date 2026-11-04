import { Funnel } from 'lucide-react';

import { QueryInputBase, type QueryInputProps } from './query-input';

/**
 * 필터 칸 — 지금 보는 목록을 좁히는 입력(목록 바로 위). 깔때기 아이콘으로 상단 검색(돋보기)과 구분한다(WP-1352).
 * 자리표시는 기준만 쓴다(예: 「이름·이메일」·「제목」) — 좁힌다는 뜻은 깔때기가 맡는다. 기준을 말하기 어려우면 기본값 「필터」.
 * 폭은 목록 위 자리에 맞춰 호출부가 className 으로 정한다. 규칙: 디자인 시스템 05 「검색과 필터」.
 */
export function FilterInput({ placeholder = '필터', ...props }: QueryInputProps) {
  return <QueryInputBase icon={Funnel} clearLabel="필터 지우기" placeholder={placeholder} {...props} />;
}
