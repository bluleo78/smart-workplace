import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterAgentProviderCredential } from '@/hooks/queries/useAgentProviderCredential';
import { accountLabel } from '@/lib/agentAccount';
import { handleApiError } from '@/lib/api-error';
import { isFileDrag } from '@/lib/clipboardFiles';
import { formatFileSize, formatMonthDayClock } from '@/lib/formatters';
import { checkLoginInfo } from '@/lib/loginInfo';
import { cn, objectParticle } from '@/lib/utils';
import type { LoginProvider } from '@/types/providerCredential';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentUserId: number;
  provider: LoginProvider;
  isReissue: boolean;
}

/** 로그인 정보를 만드는 앞 두 단계와 그 파일 자리 — 프로그램마다. 셋째 단계(「파일을 아래에 넣기」)는 path 로 그린다. */
const STEPS: Record<LoginProvider, { steps: React.ReactNode[]; path: string }> = {
  chatgpt: {
    steps: [
      <>내 컴퓨터 터미널에서 <Code>codex login</Code></>,
      '브라우저에서 이 AI 전용 ChatGPT 계정으로 로그인',
    ],
    path: '~/.codex/auth.json',
  },
  genia: {
    steps: [
      <>내 컴퓨터 터미널에서 <Code>genia</Code> 를 띄우고 <Code>/login genia</Code></>,
      '이 AI 전용 Gen:iA 계정으로 로그인',
    ],
    path: '~/.genia/agent/auth.json',
  },
};

/** 안내 문장 안의 명령·경로. */
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>;
}

/**
 * Gen:iA·ChatGPT 로그인 정보 연결 창(WP-1296·1297) — 토큰 한 줄을 받는 Claude 와 달리 그 프로그램이 로그인한 결과(auth.json 내용)를 받는다.
 * 넣는 즉시 어떤 로그인인지·어느 계정인지·언제까지인지 보여 주고, 다른 프로그램의 파일이면 연결을 막는다. 값은 서버가 다시 확인·다듬어 암호화 저장한다.
 * 같은 로그인을 다른 곳과 나눠 쓰면 갱신 때 한쪽이 로그아웃되므로 「이 AI 전용 계정」을 안내한다.
 */
export function LoginInfoDialog({ open, onOpenChange, agentUserId, provider, isReissue }: Props) {
  const [text, setText] = useState('');
  // 붙여넣기·끌어다 놓기·파일 선택으로 넣었으면 내용(토큰)을 화면에 펼치지 않고 요약만 보인다. 직접 타이핑은 칸이 계속 보여야 이어 쓸 수 있다.
  const [masked, setMasked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mutation = useRegisterAgentProviderCredential(agentUserId);
  const label = accountLabel(provider);
  // 끌어다 놓기 표시·저장 중처럼 text 가 그대로인 다시 그리기에서 다시 파싱하지 않는다
  const check = useMemo(() => checkLoginInfo(text, provider), [text, provider]);
  // 크기는 요약(masked)에만 보이므로 그때만 잰다 — 타이핑마다 Blob 을 만들지 않게
  const size = useMemo(() => (masked ? formatFileSize(new Blob([text]).size) : ''), [masked, text]);
  const { steps, path } = STEPS[provider];

  /** 넣은 내용을 비운다 — 「지우기」·닫기가 쓴다. 요약 표시도 함께 풀어 다시 칸이 보이게 한다. */
  const reset = () => {
    setText('');
    setMasked(false);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // 파일 하나를 글자로 읽어 칸에 넣는다 — 끌어다 놓기·파일 선택이 같은 길을 쓴다.
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setMasked(true);
  };

  const submit = async () => {
    if (!check?.ok) return;
    try {
      await mutation.mutateAsync({ provider, loginInfo: text });
      toast.success(isReissue ? '연결 정보를 변경했습니다.' : `${label}${objectParticle(label)} 연결했습니다.`);
      close(false);
    } catch (e) {
      handleApiError(e, '연결에 실패했습니다');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" data-testid="login-info-dialog">
        <DialogHeader>
          <DialogTitle>{label} 연결</DialogTitle>
          <DialogDescription>
            이 AI 전용 계정으로 로그인한 정보를 넣어요.{isReissue ? ' 기존 연결은 자동으로 해제됩니다.' : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  // 붙여 넣은 글을 커서 자리에 넣고 곧바로 요약으로 바꾼다 — 기본 동작에 맡기면 토큰이 한 번 칸에 그려진다
                  e.preventDefault();
                  const el = e.currentTarget;
                  const pasted = e.clipboardData.getData('text');
                  setText(text.slice(0, el.selectionStart) + pasted + text.slice(el.selectionEnd));
                  setMasked(true);
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
                data-testid="login-info-text"
              />
            ) : (
              // 붙여넣기·파일로 넣은 뒤에는 내용(토큰)을 화면에 펼치지 않는다 — 크기만 보이고 「지우기」로 다시 넣는다.
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid="login-info-filled">
                <span>로그인 정보를 넣었어요 <span className="text-xs text-muted-foreground">({size})</span></span>
                <Button type="button" size="sm" variant="ghost" onClick={reset}>
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
          <p className="text-xs text-muted-foreground">
            로그인 갱신은 AI 가 일하는 곳에서 스스로 해요. 같은 로그인을 내 컴퓨터나 다른 AI 에서도 쓰면 갱신할 때 한쪽이 로그아웃되니, 이 AI 전용 계정으로 로그인해 주세요.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            취소
          </Button>
          <Button disabled={!check?.ok || mutation.isPending} onClick={() => void submit()} data-testid="login-info-submit">
            연결
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
