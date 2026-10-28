// 에이전트 정보 편집 — 이름(name)·아이디(username)·설명(역할, description)·지시(instructions) 변경(관리자).
// 설명은 다른 AI 가 일을 맡길 상대를 고를 때 MCP 구성원 조회로 읽는다(WP-455).
// 지시는 그 AI 자신이 일할 때마다 따르는 규칙이다 — 외부 AI 의 work-loop 만 읽으므로 외부 실행일 때만 보인다(WP-1077).
// 내부로 바꾼 AI 도 이미 적힌 지시가 있으면 보여 지울 수 있게 한다(숨기면 보이지도 지워지지도 않는 지시가 남는다).
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
// 지시 최대 길이 — 서버 RenameAgentRequest 의 @Size 와 같다.
const AGENT_INSTRUCTIONS_MAX = 4000;

// agent 가 바뀌면(다른 행 선택) 부모에서 key 로 remount 해 입력값을 새 agent 로 시드한다.
export function AgentIdentitySection({ agent }: { agent: AgentResponse }) {
  const rename = useRenameAgent();
  const [name, setName] = useState(agent.name);
  const [username, setUsername] = useState(agent.username);
  const savedDescription = agent.description ?? '';
  const [description, setDescription] = useState(savedDescription);
  const savedInstructions = agent.instructions ?? '';
  const [instructions, setInstructions] = useState(savedInstructions);
  // 내부 AI 는 지시를 읽지 않는다 — 적힌 지시가 없으면 칸을 숨기고 저장할 때도 보내지 않아 기존 값을 그대로 둔다.
  const external = agent.runtime === 'EXTERNAL';
  const showInstructions = external || savedInstructions !== '';

  // 개인 비서는 관리자가 변경 불가 — 섹션 자체를 숨긴다.
  if (agent.type === 'PERSONAL') return null;

  const dirty =
    name.trim() !== agent.name ||
    username.trim() !== agent.username ||
    description.trim() !== savedDescription ||
    instructions.trim() !== savedInstructions;
  const valid = name.trim().length > 0 && username.trim().length > 0;

  // mutate(비-async) 사용 — 훅이 성공/실패 토스트를 처리하므로 unhandled rejection 회피.
  const onSave = () => {
    rename.mutate({
      userId: agent.id,
      username: username.trim(),
      name: name.trim(),
      // 빈 문자열이면 서버가 지운다(빼면 그대로 둔다).
      description: description.trim(),
      ...(showInstructions ? { instructions: instructions.trim() } : {}),
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
      {showInstructions && (
        <div className="space-y-1">
          <Label htmlFor="agent-instructions-input">지시</Label>
          <Textarea
            id="agent-instructions-input"
            data-testid="agent-instructions-input"
            value={instructions}
            maxLength={AGENT_INSTRUCTIONS_MAX}
            rows={6}
            aria-describedby="agent-instructions-help"
            placeholder={'예:\n- 기획 이슈는 반드시 다른 서비스 사례를 조사해 근거와 링크를 붙인다.\n- 화면이 바뀌면 바뀌기 전·후 시안을 함께 올린다.'}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <p id="agent-instructions-help" className="text-xs text-muted-foreground">
            {external
              ? '이 AI 가 이슈를 맡을 때마다 따르는 규칙입니다. 다른 AI 는 보지 않습니다. 프로젝트 저장소의 규칙과 부딪히면 저장소 규칙이 먼저입니다.'
              : '서버에서 실행하는 AI 는 지시를 읽지 않습니다. 외부로 바꾸면 다시 따릅니다.'}
          </p>
        </div>
      )}
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
