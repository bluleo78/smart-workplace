// 이슈 상세의 「일 맡기기」 자리(WP-1767) — 사람 카드(코멘트·담당자·보고자·이슈 챗)의 「일 맡기기」가 이 이슈의 프로젝트로 새 이슈 창을 연다.
// 창은 화면에 하나만 두고 처리기를 컨텍스트로 내려 준다 — 카드마다 창을 두면 카드가 닫힐 때 창도 함께 사라진다.
import { type ReactNode, useCallback, useState } from 'react';

import { PersonCardAssignContext } from '@/components/users/personCard/PersonCardAssignContext';

import { IssueCreateDialog } from './IssueCreateDialog';

export function PersonCardAssignHost({
  projectKey,
  children,
}: {
  /** 팀 프로젝트 키 — 개인 프로젝트 이슈는 상세 화면이 프로젝트 화면으로 돌려보내 여기 오지 않는다. */
  projectKey: string;
  children: ReactNode;
}) {
  // 열림과 맡길 AI 를 한 상태로 — 창의 훅은 열리는 순간의 initialAgentId 를 읽으므로 둘을 같은 갱신에서 바꾼다.
  const [state, setState] = useState<{ open: boolean; agentId?: number }>({ open: false });
  const assign = useCallback((agentId: number) => setState({ open: true, agentId }), []);

  return (
    <PersonCardAssignContext.Provider value={assign}>
      {children}
      {/* 한 번도 맡기지 않았으면 창을 그리지 않는다 — 닫힌 창의 훅이 유형·멤버를 미리 받지 않게. */}
      {state.agentId !== undefined && (
        <IssueCreateDialog
          projectKey={projectKey}
          open={state.open}
          // 닫을 때 agentId 는 남겨 둔다 — 닫힘 애니메이션 동안 창 내용이 바뀌지 않게. 다음에 열 때 새 값으로 덮는다.
          onOpenChange={(open) => setState((s) => ({ ...s, open }))}
          initialAgentId={state.agentId}
        />
      )}
    </PersonCardAssignContext.Provider>
  );
}
