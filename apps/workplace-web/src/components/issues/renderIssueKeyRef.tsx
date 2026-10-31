// 본문 이슈 키 그리기 함수(WP-1237) — 렌더러(ChatMarkdownText·MarkdownMessage)에 넘긴다. IssueKeyRef.tsx 는 컴포넌트만 내보내야 해서
// (fast refresh) 따로 둔다. 모듈 범위 함수라 늘 같은 함수다 — MarkdownMessage 가 렌더러 묶음을 다시 만들지 않는다.
import type { RenderIssueRef } from '@/lib/issueKeyRefs'

import { IssueKeyRef } from './IssueKeyRef'

export const renderIssueKeyRef: RenderIssueRef = (seg, key) => (
  <IssueKeyRef key={key} text={seg.text} projectKey={seg.projectKey} number={seg.number} />
)
