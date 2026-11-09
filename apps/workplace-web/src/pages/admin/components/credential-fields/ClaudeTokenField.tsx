// Claude 구독 토큰 칸(WP-1451) — `claude setup-token` 으로 발급한 OAuth 토큰 한 줄을 받는다.
// AI 별 연결 창(ProviderCredentialDialog)과 계정 목록의 계정 창(AgentAccountDialog)이 같은 칸을 쓴다. 길이 검증은 제출하는 쪽이 아래 상수로 한다.
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Claude 구독 토큰 최소 길이 — 서버 @Size(min = 32) 와 같다. 짧으면 제출 때 토스트로 알린다. */
export const CLAUDE_TOKEN_MIN = 32;

/** Claude 구독 토큰 최대 길이 — 서버 @Size(max = 2048) 과 같다. 넘으면 칸 아래에 알리고 저장을 막는다. */
export const CLAUDE_TOKEN_MAX = 2048;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** 토큰 입력 칸 — 자동 완성·맞춤법 검사를 끄고 고정폭 글꼴로 보인다. */
export function ClaudeTokenField({ value, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="oauth-token">토큰</Label>
      <Textarea
        id="oauth-token"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-ant-oat..."
        className="font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
        rows={4}
      />
    </div>
  );
}
