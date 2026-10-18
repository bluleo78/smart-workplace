// 에이전트 정보 편집 — 이름(name)·아이디(username)·설명(역할, description) 변경(관리자).
// 설명은 다른 AI 가 일을 맡길 상대를 고를 때 MCP 구성원 조회로 읽는다(WP-455).
// 개인 비서(PERSONAL)는 노출하지 않는다 — 소유자만 자신의 프로필에서 변경(백엔드도 403 으로 이중 가드).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useRenameAgent } from '../../../hooks/queries/useAgents';
import type { AgentResponse } from '../../../types/agent';

// 설명 최대 길이 — 서버 RenameAgentRequest 의 @Size 와 같다.
const AGENT_DESCRIPTION_MAX = 500;

// agent 가 바뀌면(다른 행 선택) 부모에서 key 로 remount 해 입력값을 새 agent 로 시드한다.
export function AgentIdentitySection({ agent }: { agent: AgentResponse }) {
  const rename = useRenameAgent();
  const [name, setName] = useState(agent.name);
  const [username, setUsername] = useState(agent.username);
  const savedDescription = agent.description ?? '';
  const [description, setDescription] = useState(savedDescription);

  // 개인 비서는 관리자가 변경 불가 — 섹션 자체를 숨긴다.
  if (agent.type === 'PERSONAL') return null;

  const dirty =
    name.trim() !== agent.name ||
    username.trim() !== agent.username ||
    description.trim() !== savedDescription;
  const valid = name.trim().length > 0 && username.trim().length > 0;

  // mutate(비-async) 사용 — 훅이 성공/실패 토스트를 처리하므로 unhandled rejection 회피.
  const onSave = () => {
    rename.mutate({
      userId: agent.id,
      username: username.trim(),
      name: name.trim(),
      // 빈 문자열이면 서버가 지운다(빼면 그대로 둔다).
      description: description.trim(),
    });
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
      <div className="space-y-1">
        <Label htmlFor="agent-description-input">설명(역할)</Label>
        <Textarea
          id="agent-description-input"
          data-testid="agent-description-input"
          value={description}
          maxLength={AGENT_DESCRIPTION_MAX}
          rows={3}
          aria-describedby="agent-description-help"
          placeholder="예: 코드 리뷰를 맡습니다. 변경 이유와 빠진 테스트를 보고 이슈 댓글로 남깁니다."
          onChange={(e) => setDescription(e.target.value)}
        />
        <p id="agent-description-help" className="text-xs text-muted-foreground">
          다른 AI 가 일을 맡길 상대를 고를 때 읽습니다. 무엇을 맡고 어떻게 일하는지 적어 주세요.
        </p>
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
