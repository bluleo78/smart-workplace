// 보드 카드 「⋯」 메뉴(WP-273) 연결 — 보드는 컬럼 컴포넌트가 여러 겹(데스크톱·모바일·그룹·읽기 전용)이라
// openMenu 를 prop 으로 내리지 않고 보드(IssueBoardView)가 컨텍스트로 준다. 없으면 카드는 ⋯·우클릭 메뉴 없이 그려진다(드래그 고스트 등).
import { createContext } from 'react';

import type { OpenRowMenu } from '../hooks/useIssueRowActions';

export const IssueCardMenuContext = createContext<{ openMenu?: OpenRowMenu; menuIssueNumber: number | null }>({
  menuIssueNumber: null,
});
