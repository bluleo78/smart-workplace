// Gen:iA 브라우저 로그인(WP-1461) — 계정 창에서 auth.json 붙여 넣기 대신 Microsoft 로그인으로 Gen:iA 계정을 넣는다.
// [로그인] → API 가 Gen:iA 로그인 서버에 진행을 만들고 Microsoft 로그인 주소를 준다 → 관리자가 「Microsoft 로그인 열기」로 새 탭에서 로그인 →
// 이 칸이 2초마다 상태를 물어(그 조회가 API 의 Gen:iA 폴링을 일으킨다) 성공하면 API 가 계정을 저장해 둔다.
// 새 탭은 자동으로 열지 않는다 — 시작 응답(비동기) 뒤의 window.open 은 팝업 차단에 걸려서, 관리자가 링크를 직접 누르게 한다.
// 진행 중에 칸이 사라지면(창 닫기·종류 바꾸기) 진행을 취소한다 — 남겨 두면 다른 탭에서 로그인을 마쳐 원치 않은 계정이 생길 수 있다.
import { useEffect, useRef, useState } from 'react';

import { cancelGeniaLogin } from '@/api/agentAccounts';
import { Button } from '@/components/ui/button';
import { useGeniaLogin, useStartGeniaLogin } from '@/hooks/queries/useAgentAccounts';
import { extractApiError } from '@/lib/api-error';
import { formatGeniaLoginRemaining } from '@/lib/geniaLogin';

/** 아무것도 시작하지 않았을 때의 안내 — 이 방법은 지금 브라우저로 로그인한 「내」 계정만 넣을 수 있다. */
const IDLE_HINT = '지금 로그인한 내 Gen:iA 계정을 Microsoft 로그인으로 넣어요. 다른 사람의 계정은 아래에 로그인 정보를 붙여 넣어요.';

interface Props {
  /** 다시 로그인할 계정 — 주면 그 계정의 로그인 정보만 바꾼다(수정 창). 없으면 새 계정을 만든다. */
  accountId?: number;
  /** 새 계정의 라벨 — [로그인] 을 누른 때의 값으로 저장된다. 비우면 서버 기본(「Gen:iA 로그인 계정」). */
  label?: string;
  /** 성공을 처음 받았을 때 한 번 — 로그인한 계정 이메일(서버가 못 읽었으면 null). */
  onSucceeded: (email: string | null) => void;
  /** 진행 중(시작 중·대기) 여부가 바뀔 때 — 창이 그동안 라벨을 잠근다(라벨은 [로그인] 때 값으로 저장된다). 칸이 사라지면 false 로 알린다. */
  onActiveChange?: (active: boolean) => void;
}

/** 지금 보일 화면 — 시작 응답·상태 조회 결과에서 정한다. */
type View =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'pending'; authorizeUrl: string | null; expiresAt: string }
  | { kind: 'done'; email: string | null }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

/** Gen:iA 브라우저 로그인 칸 — 시작·대기(링크+남은 시간)·성공·만료·실패를 보이고, 진행 중에 사라지면 취소한다. */
export function GeniaBrowserLogin({ accountId, label, onSucceeded, onActiveChange }: Props) {
  const start = useStartGeniaLogin();
  const [loginId, setLoginId] = useState<string | null>(null);
  const login = useGeniaLogin(loginId);

  const view = toView();

  /** 시작 응답·상태 조회 결과 → 화면. 404(진행이 지워짐)는 useGeniaLogin 이 만료(EXPIRED)로 바꿔 준다. */
  function toView(): View {
    if (start.isPending) return { kind: 'starting' };
    if (start.isError) return { kind: 'error', message: extractApiError(start.error, 'Gen:iA 로그인을 시작하지 못했어요') };
    if (loginId == null) return { kind: 'idle' };
    // 그 밖의 조회 실패(잠깐 끊김)는 마지막 상태를 그대로 보인다 — 대기면 다음 간격에 다시 묻는다.
    const data = login.data;
    if (!data) return { kind: 'starting' };
    switch (data.status) {
      case 'PENDING':
        return { kind: 'pending', authorizeUrl: data.authorizeUrl, expiresAt: data.expiresAt };
      case 'SUCCEEDED':
        return { kind: 'done', email: data.accountEmail };
      case 'EXPIRED':
        return { kind: 'expired' };
      case 'FAILED':
        return { kind: 'error', message: data.errorMessage ?? 'Gen:iA 로그인에 실패했어요' };
    }
  }

  // 정리 함수가 볼 최신 진행 — 마운트 때 한 번 건 정리 함수는 그 뒤의 상태를 클로저로 보지 못한다.
  const pendingIdRef = useRef<string | null>(null);
  const pendingId = view.kind === 'pending' ? loginId : null;
  useEffect(() => {
    pendingIdRef.current = pendingId;
  }, [pendingId]);

  // 사라질 때 대기 중인 진행을 취소한다. 실패해도 진행은 10분 뒤 저절로 끝나니 오류는 삼킨다.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const id = pendingIdRef.current;
      pendingIdRef.current = null;
      if (id) cancelGeniaLogin(id).catch(() => {});
    };
  }, []);

  // 진행 중 여부를 창에 알린다 — 칸이 사라질 때(종류 바꾸기·창 닫기)는 정리 함수가 false 로 되돌려 잠금이 남지 않게 한다.
  const active = view.kind === 'starting' || view.kind === 'pending';
  useEffect(() => {
    if (!onActiveChange) return;
    onActiveChange(active);
    return () => onActiveChange(false);
  }, [active, onActiveChange]);

  // 성공은 진행마다 한 번만 알린다 — 다시 그려지거나 같은 결과를 다시 받아도 토스트가 겹치지 않게.
  const notifiedRef = useRef<string | null>(null);
  const doneEmail = view.kind === 'done' ? view.email : undefined;
  useEffect(() => {
    if (doneEmail === undefined || loginId == null || notifiedRef.current === loginId) return;
    notifiedRef.current = loginId;
    onSucceeded(doneEmail);
  }, [doneEmail, loginId, onSucceeded]);

  /** 진행을 (다시) 시작한다 — 서버는 같은 사람의 이전 진행을 지운다. 응답 전에 칸이 사라졌으면 막 만든 진행을 바로 취소한다. */
  const begin = async () => {
    setLoginId(null);
    try {
      const data = await start.mutateAsync({
        ...(label ? { label } : {}),
        ...(accountId != null ? { accountId } : {}),
      });
      if (!mountedRef.current) {
        cancelGeniaLogin(data.id).catch(() => {});
        return;
      }
      setLoginId(data.id);
    } catch {
      // 시작 실패는 start.error 로 화면에 보인다(toView).
    }
  };

  const retryButton = (
    <Button type="button" variant="outline" size="sm" onClick={() => void begin()} data-testid="genia-login-retry">
      다시 시도
    </Button>
  );

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="genia-login">
      {view.kind === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{IDLE_HINT}</p>
          <Button type="button" size="sm" onClick={() => void begin()} data-testid="genia-login-start">
            로그인
          </Button>
        </div>
      )}
      {view.kind === 'starting' && <p className="text-sm text-muted-foreground">로그인 시작 중…</p>}
      {view.kind === 'pending' && (
        <div className="flex flex-wrap items-center gap-3">
          {view.authorizeUrl && (
            <Button asChild size="sm">
              <a href={view.authorizeUrl} target="_blank" rel="noopener noreferrer" data-testid="genia-login-open">
                Microsoft 로그인 열기
              </a>
            </Button>
          )}
          {/* 진행마다 새로 마운트해 시계를 그 진행의 응답 시각부터 잰다. */}
          <GeniaLoginRemaining key={loginId} expiresAt={view.expiresAt} />
        </div>
      )}
      {view.kind === 'done' && (
        <p role="status" className="text-sm text-success" data-testid="genia-login-done">
          {view.email ? `로그인됨 — ${view.email}` : '로그인됨'}
        </p>
      )}
      {view.kind === 'expired' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>로그인 시간이 지났어요 — </span>
          {retryButton}
        </div>
      )}
      {view.kind === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive" data-testid="genia-login-error">
            {view.message}
          </p>
          {retryButton}
        </div>
      )}
    </div>
  );
}

/** 「남은 시간 M:SS」 — 1초마다 다시 그린다. 만료 판정은 서버가 한다(여기는 보이기만). */
function GeniaLoginRemaining({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-xs text-muted-foreground tabular-nums" data-testid="genia-login-remaining">
      {formatGeniaLoginRemaining(expiresAt, now)}
    </span>
  );
}
