// 화면 컨텍스트 store 를 앱 셸에 1개 제공(WP-54) — 페이지(Outlet)와 AI 패널을 모두 감싸는 위치에 둔다.
import { type ReactNode,useState } from 'react';

import { createScreenContextStore } from '@/lib/aiScreenContext/store';

import { AiScreenContextStoreContext } from './useAiScreenContext';

export function AiScreenContextProvider({ children }: { children: ReactNode }) {
  // store 는 앱 수명 동안 1개 — 참조가 고정이라 소비자가 리렌더되지 않는다.
  const [store] = useState(createScreenContextStore);
  return <AiScreenContextStoreContext.Provider value={store}>{children}</AiScreenContextStoreContext.Provider>;
}
