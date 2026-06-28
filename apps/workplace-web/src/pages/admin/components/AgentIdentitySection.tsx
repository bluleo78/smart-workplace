// 에이전트 정보 편집 — 이름(name)·아이디(username) 변경(관리자).
// 개인 비서(PERSONAL)는 노출하지 않는다 — 소유자만 자신의 프로필에서 변경(백엔드도 403 으로 이중 가드).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useRenameAgent } from '../../../hooks/queries/useAgents';
import type { AgentResponse } from '../../../types/agent';

// agent 가 바뀌면(다른 행 선택) 부모에서 key 로 remount 해 입력값을 새 agent 로 시드한다.
export function AgentIdentitySection({ agent }: { agent: AgentResponse }) {
  const rename = useRenameAgent();
  const [name, setName] = useState(agent.name);
  const [username, setUsername] = useState(agent.username);

  // 개인 비서는 관리자가 변경 불가 — 섹션 자체를 숨긴다.
  if (agent.type === 'PERSONAL') return null;

  const dirty = name.trim() !== agent.name || username.trim() !== agent.username;
  const valid = name.trim().length > 0 && username.trim().length > 0;

  // mutate(비-async) 사용 — 훅이 성공/실패 토스트를 처리하므로 unhandled rejection 회피.
  const onSave = () => {
    rename.mutate({ userId: agent.id, username: username.trim(), name: name.trim() });
  };

  return (
    <div className="space-y-2" data-testid="agent-identity-section">
      <h3 className="text-sm font-medium">에이전트 정보</h3>
      <div className="space-y-1">
        <Label htmlFor="agent-name-input">이름</Label>
        <Input
          id="agent-name-input"
          data-testid="agent-name-input"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="agent-username-input">아이디</Label>
        <Input
          id="agent-username-input"
          data-testid="agent-username-input"
          value={username}
          maxLength={50}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <Button
        onClick={onSave}
        disabled={!dirty || !valid || rename.isPending}
        data-testid="agent-identity-save"
      >
        저장
      </Button>
    </div>
  );
}
