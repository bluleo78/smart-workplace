// 상태 이름 입력기(WP-808) — 보드 범주 띠 ＋·헤더 ⋯ 「이 뒤에 상태 추가」(팝오버)와 헤더 인라인 이름 변경,
// 모바일 탭 ⋯ 바텀시트(MobileStatusSheet)가 같이 쓴다.
// 오류는 토스트가 아니라 입력 바로 아래에 보인다 — 클라이언트 검증(빈 이름·30자·중복) 뒤 서버 오류(409 동시 중복 등)도 같은 자리.
import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ProjectStatus } from '@/types/projectStatus';

import { useStatusNameForm } from '../status/useStatusNameForm';

export function StatusNameEditor({
  initial = '',
  statuses,
  excludeId,
  onSubmit,
  onCancel,
  submitLabel,
  inline = false,
  touch = false,
  className,
}: {
  initial?: string;
  // 중복 검사 대상 — 이 프로젝트의 상태 목록.
  statuses: ProjectStatus[];
  // 이름을 바꾸는 상태 자신(중복 비교에서 뺀다). 없으면 새 상태 — 상한(20)도 검사한다.
  excludeId?: number;
  // 앞뒤 공백을 뺀 이름으로 저장한다. 실패(reject)하면 서버 문구를 입력 아래에 보이고 입력을 유지한다.
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  // 주면 저장 버튼을 둔다(팝오버). 헤더 인라인 편집은 Enter·Esc 만 쓴다.
  submitLabel?: string;
  // 헤더 인라인 편집 — 입력 높이를 헤더 줄에 맞추고, 바깥을 누르면 취소(Esc 와 같다). 오류는 입력 아래 흐름 안에 두어(편집 중에만 헤더가 늘어난다) 카드를 가리지 않는다.
  inline?: boolean;
  // 모바일 바텀시트 — 입력 16px(iOS 포커스 자동 확대 방지)·높이 44px, 저장 버튼은 입력 아래 전체 폭 44px.
  touch?: boolean;
  className?: string;
}) {
  // 검증·Enter(한글 조합 가드)·Esc·서버 오류 문구는 설정 추가 입력 줄과 같은 흐름(WP-937).
  // 바뀌지 않은 이름(이름 변경)은 요청 없이 닫는다.
  // 실패 문구는 설정 추가 폼(「상태를 만들지 못했어요」)과 같은 해요체 — 새 상태면 만들기, 이름 변경이면 저장.
  const form = useStatusNameForm({
    initial, statuses, excludeId, onSubmit, onCancel,
    failMessage: excludeId == null ? '상태를 만들지 못했어요' : '상태를 저장하지 못했어요',
  });
  const { error, saving } = form;
  // 오류 문구 id — 인라인 편집과 팝오버가 동시에 떠 있어도 겹치지 않게 인스턴스마다 고유.
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // 인라인 편집의 바깥 누르기 = 취소. 포커스(blur) 대신 포인터로 본다 — 메뉴가 닫히며 포커스를 옮기는 순간 닫히지 않게.
  useEffect(() => {
    // 저장 중에는 닫지 않는다 — 요청이 실패하면 오류를 그 자리에 보여야 한다.
    if (!inline || saving) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [inline, saving, onCancel]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
      className={cn('relative flex min-w-0 flex-col gap-1', className)}>
      {/* 바텀시트(touch)는 입력 → 오류 → 전체 폭 저장 버튼 순 — 줄(div)을 contents 로 풀고 버튼을 맨 뒤(order-last)로 보낸다. */}
      <div className={touch ? 'contents' : 'flex min-w-0 items-center gap-2'}>
        {/* maxLength 를 두지 않는다 — 30자에서 입력이 조용히 잘리면 왜 막혔는지 모른다. 길이 오류는 아래 문구로 알린다.
            저장 중엔 disabled 대신 readOnly — disabled 는 포커스를 잃어 실패 뒤 바로 고칠 수 없다. */}
        <Input
          {...form.inputProps}
          autoFocus
          onKeyDown={(e) => {
            // 보드 키보드 DnD(Space 시작)·메뉴 타입어헤드로 새지 않게 입력 안의 키는 여기서 끝낸다.
            e.stopPropagation();
            form.inputProps.onKeyDown(e);
          }}
          readOnly={saving}
          aria-busy={saving}
          aria-label="상태 이름"
          aria-invalid={error != null}
          aria-describedby={error ? errorId : undefined}
          className={cn('min-w-0 font-normal', touch ? 'h-11 text-base' : inline ? 'h-6 px-2 py-0 text-sm' : 'h-8 text-sm')}
          data-testid="status-name-input"
        />
        {submitLabel && (
          <Button type="submit" size="sm" className={cn('shrink-0', touch ? 'order-last mt-2 h-11 w-full text-base' : 'h-8')} disabled={saving} data-testid="status-name-submit">
            {submitLabel}
          </Button>
        )}
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          // 오류 문구는 DS 09 대로 text-sm(설정 추가 폼과 같다). 헤더 인라인만 헤더 줄 높이 때문에 text-xs 로 둔다.
          className={cn(
            'break-keep font-normal text-destructive',
            inline ? 'text-xs' : 'text-sm',
          )}
          data-testid="status-name-error"
        >
          {error}
        </p>
      )}
    </form>
  );
}

// 새 상태 팝오버 본문 — 범주 띠 ＋ 와 헤더 ⋯ 「이 뒤에 상태 추가」가 같이 쓴다. 저장되면 닫는다.
export function NewStatusPopoverBody({
  subtitle,
  statuses,
  onSubmit,
  onClose,
}: {
  // 제목 옆 흐린 문구 — 범주 이름 또는 「X 뒤」.
  subtitle: string;
  statuses: ProjectStatus[];
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <>
      <p className="break-words text-sm font-semibold">
        새 상태 <span className="font-normal text-muted-foreground">· {subtitle}</span>
      </p>
      <StatusNameEditor
        statuses={statuses}
        submitLabel="추가"
        onSubmit={async (name) => {
          await onSubmit(name);
          onClose();
        }}
        onCancel={onClose}
      />
    </>
  );
}
