// 작성창 임시저장 상태 한 줄(WP-577) — 데스크톱은 머리 제목 옆, 모바일은 상단 바 제목 아래.
// 저장 중·저장됨은 흐린 글씨로 조용히, 실패·충돌은 무엇을 하면 되는지(다시 시도·다시 불러오기)를 바로 옆 버튼으로 둔다.
// 다른 곳에서 보냈거나 버린 임시저장(gone)은 흐린 글씨 안내만 둔다 — 여기서 보내는 것은 그대로 된다.
// 검증 오류(invalid)는 원인만 짧게 보인다 — 같은 내용으로 다시 시도해도 같으므로 「다시 시도」를 두지 않는다(고치면 다시 저장한다).
import type { DraftSaveStatus } from '@/hooks/useMailDraftAutosave';
import { cn } from '@/lib/utils';

export function MailDraftSaveStatus({
  status,
  reason,
  onRetry,
  onReload,
  mobile,
}: {
  status: DraftSaveStatus;
  /** invalid 의 원인(서버 검증 문구의 첫 문장). */
  reason?: string;
  onRetry: () => void;
  onReload: () => void;
  mobile: boolean;
}) {
  if (status === 'idle') return null;
  const failed = status === 'error' || status === 'invalid' || status === 'conflict';
  // 다른 곳에서 보냈거나 버림 — 실패가 아니라 알림이라 흐린 글씨로 두되, 한 번 바뀌는 상태라 읽어 준다.
  const gone = status === 'gone';
  // 상태 글 옆 동작 — 모바일은 줄 높이를 그대로 두고 위아래 투명 영역으로 44px 터치를 맞춘다.
  const action = (label: string, onClick: () => void, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'shrink-0 font-medium underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
        mobile && "relative after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']",
      )}
    >
      {label}
    </button>
  );
  // 안내 글 — 모바일 상단 바는 제목 아래 줄 폭이 🗑·📎·➤ 앞까지라(390px 에서 약 200px) 긴 안내(충돌 등)가 아이콘 위로 넘쳤다.
  // 글만 말줄임하고 옆 동작 버튼은 줄지 않게 둔다. 띄어쓰기는 낭독·문구 그대로 두고, 화면 간격은 바깥 gap 이 맡는다.
  const message = (text: string) => <span className="min-w-0 truncate">{text}</span>;
  // 검증 오류 원인 — 모바일 한 줄(약 200px)에 「저장하지 못했어요 · 」까지 넣으면 원인이 잘려서, 모바일은 원인만 보인다(빨간 글씨라 실패임은 보인다).
  // 앞 문구는 화면에서만 감추고 낭독·title 에는 전체 문구를 남긴다.
  const invalidReason = reason ?? '내용을 확인해 주세요';
  const invalidFull = `저장하지 못했어요 · ${invalidReason}`;
  return (
    <span
      data-testid="mail-compose-save-status"
      data-status={status}
      // 저장 중·저장됨은 입력마다 바뀌어 읽어 주면 시끄럽다 — 실패·충돌만 알린다.
      role={failed || gone ? 'status' : undefined}
      title={status === 'invalid' ? invalidFull : undefined}
      className={cn(
        'flex items-baseline gap-1 whitespace-nowrap text-xs',
        // 데스크톱은 제목 옆 — 제목만 말줄임하고 상태는 줄이지 않는다. 「저장 중…」↔「저장됨」이 번갈아도 폭이 같게
        // 최소 폭을 「저장 중…」만큼 잡아, 긴 제목의 말줄임 위치가 입력마다 흔들리지 않게 한다.
        // 모바일은 제목 아래 한 줄을 다 쓰므로 줄어들 수 있게(안의 글이 말줄임) 둔다.
        mobile ? 'min-w-0' : 'min-w-12 shrink-0',
        failed ? 'text-destructive-text' : 'text-muted-foreground',
      )}
    >
      {status === 'pending' || status === 'saving' ? (
        '저장 중…'
      ) : status === 'saved' ? (
        '저장됨'
      ) : gone ? (
        message('다른 곳에서 보냈거나 버린 메일이에요')
      ) : status === 'invalid' ? (
        mobile ? (
          <>
            <span className="sr-only">저장하지 못했어요 · </span>
            {message(invalidReason)}
          </>
        ) : (
          message(invalidFull)
        )
      ) : status === 'error' ? (
        <>
          {message('저장하지 못했어요 · ')}
          {action('다시 시도', onRetry, 'mail-compose-save-retry')}
        </>
      ) : (
        <>
          {message('다른 곳에서 고친 내용이 있어요 · ')}
          {action('다시 불러오기', onReload, 'mail-compose-save-reload')}
        </>
      )}
    </span>
  );
}
