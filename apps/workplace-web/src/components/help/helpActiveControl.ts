// 포커스·클릭한 화면 단추 이름(WP-1506) — 도움말 본문의 굵은 글자가 이 이름과 같으면 강조한다(HighlightStrong).
// HelpPanel 이 문맥 신호 훅(useHelpContextSignals)의 activeControlName 을 넣는다. HelpMarkdown 은 memo·components 표(useMemo)로
// 본문을 다시 해석하지 않게 두었으므로, 값을 prop 으로 내려 표를 다시 만들지 않고 컨텍스트로 굵은 글자 컴포넌트만 다시 그리게 한다.
import { createContext } from 'react'

/** 지금 포커스·클릭한 화면 단추 이름(정규화한 글자, 비었으면 aria-label). 없으면 null. */
export const HelpActiveControlContext = createContext<string | null>(null)
