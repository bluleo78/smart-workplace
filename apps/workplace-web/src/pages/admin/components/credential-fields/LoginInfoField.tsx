// 로그인 정보 칸(WP-1296·1297, 공용화 WP-1451) — Gen:iA·ChatGPT 프로그램이 로그인한 결과(auth.json 내용)를 받는다.
// 만드는 순서 안내 + 붙여넣기·끌어다 놓기·파일 선택 + 넣은 뒤엔 내용(토큰)을 펼치지 않고 크기만 + 브라우저 미리 확인(어떤 로그인·어느 계정·언제까지).
// 계정 목록의 계정 창(AgentAccountDialog)이 쓴다. 글(value)과 확인 결과(check)는 부르는 쪽이 갖는다 — 제출 가능 여부를 그쪽이 정하므로.
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { accountLabel } from '@/lib/agentAccount';
import { isFileDrag } from '@/lib/clipboardFiles';
import { formatFileSize, formatMonthDayClock } from '@/lib/formatters';
import type { LoginInfoCheck } from '@/lib/loginInfo';
import { cn } from '@/lib/utils';
import type { LoginProvider } from '@/types/providerCredential';

/** 로그인 정보를 만드는 앞 두 단계와 그 파일 자리 — 프로그램마다. 로그인은 계정 목록 전용 계정으로 새로 한다(같은 로그인을 나눠 쓰면 한쪽이 풀린다). */
const STEPS: Record<LoginProvider, { steps: React.ReactNode[]; path: string }> = {
  chatgpt: {
    steps: [<>내 컴퓨터 터미널에서 <Code>codex login</Code></>, '브라우저에서 이 목록 전용 ChatGPT 계정으로 로그인'],
    path: '~/.codex/auth.json',
  },
  genia: {
    steps: [<>내 컴퓨터 터미널에서 <Code>genia</Code> 를 띄우고 <Code>/login genia</Code></>, '이 목록 전용 Gen:iA 계정으로 로그인'],
    path: '~/.genia/agent/auth.json',
  },
};

/** 안내 문장 안의 명령·경로. */
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>;
}

interface Props {
  provider: LoginProvider;
  value: string;
  onChange: (value: string) => void;
  /** checkLoginInfo(value, provider) 결과 — 비었으면 null. */
  check: LoginInfoCheck | null;
}

/** 로그인 정보 입력부 — 만드는 순서 · 넣는 칸(또는 넣은 요약) · 미리 확인 결과. */
export function LoginInfoField({ provider, value, onChange, check }: Props) {
  // 붙여넣기·끌어다 놓기·파일 선택으로 넣었으면 내용(토큰)을 화면에 펼치지 않고 요약만 보인다. 직접 타이핑은 칸이 계속 보여야 이어 쓸 수 있다.
  // 바깥에서 글을 비우면(창 초기화) 요약도 함께 풀린다 — 빈 글은 늘 칸으로 보인다.
  const [maskedInput, setMaskedInput] = useState(false);
  const masked = maskedInput && value !== '';
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = accountLabel(provider);
  // 크기는 요약(masked)에만 보이므로 그때만 잰다 — 타이핑마다 Blob 을 만들지 않게
  const size = useMemo(() => (masked ? formatFileSize(new Blob([value]).size) : ''), [masked, value]);
  const { steps, path } = STEPS[provider];

  /** 넣은 내용을 비운다 — 요약 표시도 함께 풀어 다시 칸이 보이게 한다. */
  const clear = () => {
    onChange('');
    setMaskedInput(false);
  };

  // 파일 하나를 글자로 읽어 칸에 넣는다 — 끌어다 놓기·파일 선택이 같은 길을 쓴다.
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    onChange(await file.text());
    setMaskedInput(true);
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label>로그인 정보 만들기</Label>
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          <li>
            <Code>{path}</Code> 을 아래에 넣기
          </li>
        </ol>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-info-text">로그인 정보</Label>
          <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} data-testid="login-info-file-pick">
            파일 선택
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
            data-testid="login-info-file"
          />
        </div>
        {!masked ? (
          <Textarea
            id="login-info-text"
            value={value}
            onChange={(e) => {
              // 직접 타이핑은 칸이 계속 보여야 한다 — 바깥에서 비운 뒤 남은 요약 표시 표식도 여기서 푼다
              setMaskedInput(false);
              onChange(e.target.value);
            }}
            onPaste={(e) => {
              // 붙여 넣은 글을 커서 자리에 넣고 곧바로 요약으로 바꾼다 — 기본 동작에 맡기면 토큰이 한 번 칸에 그려진다
              e.preventDefault();
              const el = e.currentTarget;
              const pasted = e.clipboardData.getData('text');
              onChange(value.slice(0, el.selectionStart) + pasted + value.slice(el.selectionEnd));
              setMaskedInput(true);
            }}
            // 파일을 끌 때만 받는다 — 글 조각 끌기는 기본 동작(칸에 넣기)에 맡긴다
            onDragOver={(e) => {
              if (!isFileDrag(e.dataTransfer)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              setDragging(false);
              if (!isFileDrag(e.dataTransfer)) return;
              e.preventDefault();
              void readFile(e.dataTransfer.files[0]);
            }}
            placeholder={`${path} 파일을 끌어다 놓거나 내용을 붙여 넣어요`}
            className={cn('h-24 font-mono text-xs', dragging && 'border-primary')}
            spellCheck={false}
            autoComplete="off"
            // auth.json 은 토큰 덩어리 — 이름 낱말로는 비밀값으로 안 잡혀 명시한다(도움말 포커스가 값을 AI 로 보내지 않게).
            data-ai-secret="true"
            data-testid="login-info-text"
          />
        ) : (
          // 붙여넣기·파일로 넣은 뒤에는 내용(토큰)을 화면에 펼치지 않는다 — 크기만 보이고 「지우기」로 다시 넣는다.
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid="login-info-filled">
            <span>
              로그인 정보를 넣었어요 <span className="text-xs text-muted-foreground">({size})</span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={clear}>
              지우기
            </Button>
          </div>
        )}
        {check &&
          (check.ok ? (
            <p className="rounded-md bg-success-subtle px-3 py-2 text-xs text-success" data-testid="login-info-check">
              {label} 정보예요{check.account ? ` · ${check.account}` : ''}
              {check.expiresAt ? ` · 로그인 만료 ${formatMonthDayClock(check.expiresAt.toISOString())}(이후 AI 가 스스로 갱신)` : ''}
            </p>
          ) : (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="login-info-check">
              {check.reason}
            </p>
          ))}
      </div>
    </>
  );
}
