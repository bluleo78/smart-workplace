// Anthropic 워크스페이스 ID 칸(WP-1496) — Claude 토큰 칸 바로 아래에 늘 보이는 선택 칸.
// 워크스페이스를 지정하지 않고 만든 API 키는 호출마다 워크스페이스 ID 가 있어야 동작한다. 그런 키인지는 서버가 등록 때 시험해
// errors.workspaceId 로 알려 주고, 부르는 쪽이 그 문구를 error 로 넘기고 inputRef 로 이 칸에 초점을 옮긴다.
// 개인 비서(PersonalAssistantSection)·AI 별 연결 창(ProviderCredentialDialog)·계정 창(AgentAccountDialog)이 같은 칸을 쓴다.
import type { Ref } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';

/** 칸 아래 안내 — 언제 필요한지와 어디서 찾는지. 매뉴얼(12장·AI 계정)과 같은 말을 쓴다. */
export const WORKSPACE_ID_HELP = '워크스페이스를 지정하지 않고 만든 API 키만 필요합니다. Anthropic 콘솔 Workspaces 에서 확인';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 칸 아래 빨간 문구 — 형식 오류 또는 서버가 「워크스페이스 ID 가 필요하다」고 거절한 안내. */
  error?: string | null;
  /** 서버 거절 뒤 이 칸으로 초점을 옮기려고 부르는 쪽이 쥐는 ref. */
  inputRef?: Ref<HTMLInputElement>;
  /** 입력 id — 한 화면에 한 칸만 그리므로 기본값을 쓴다. */
  id?: string;
  /**
   * 한 줄 칸 Enter 로 부를 동작(WP-1622) — 계정 창·AI 별 연결 창이 제출을 넘긴다. 넘기지 않으면 Enter 를 다루지 않는다(개인 비서).
   * 한글 조합 Enter·macOS Chrome 꼬리 Enter 는 공용 훅이 거른다.
   */
  onEnter?: () => void;
}

/** 워크스페이스 ID 입력 칸 — 자동 완성·맞춤법 검사를 끄고 고정폭 글꼴로 보인다. 오류가 있으면 aria-invalid 로 빨간 테두리. */
export function AnthropicWorkspaceIdField({ value, onChange, error, inputRef, id = 'anthropic-workspace-id', onEnter }: Props) {
  // 한 줄 칸 Enter 공용 처리(WP-331) — onEnter 가 있을 때만 칸에 건다.
  const enterKey = useSingleLineEnter();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Anthropic 워크스페이스 ID(선택)</Label>
      <Input
        id={id}
        ref={inputRef}
        data-testid="anthropic-workspace-id-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="wrkspc_..."
        className="font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${helpId}` : helpId}
        onCompositionEnd={onEnter ? enterKey.onCompositionEnd : undefined}
        onKeyDown={onEnter ? (e) => enterKey.handleEnter(e, onEnter) : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive" data-testid="anthropic-workspace-id-error">
          {error}
        </p>
      )}
      <p id={helpId} className="text-xs text-muted-foreground">
        {WORKSPACE_ID_HELP}
      </p>
    </div>
  );
}
