import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { eulReul } from '../../lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

interface BaseProps {
  entityName: string;
  itemName: string;
  onConfirm: () => void;
  /** 기본 자동 생성 문구 대신 사용할 커스텀 설명. 미지정 시 자동 생성. */
  description?: ReactNode;
  /**
   * 설명 아래 덧붙이는 영향 안내(WP-488 — 「이슈 N개에서 라벨이 빠집니다」). 문자열이면 강조 문단으로 감싸고, 요소면 그대로 그린다
   * (스스로 수를 받아 0건이면 아무것도 그리지 않는 컴포넌트용 — {@link DeleteImpactNote}).
   */
  impact?: ReactNode;
  /** 확인창 제목 — 기본 `${entityName} 삭제`(WP-1682: 「메일을 완전히 삭제할까요?」처럼 문장형 제목이 필요한 곳). */
  title?: ReactNode;
  /** 확인(파괴) 버튼 글자 — 기본 「삭제」(WP-1682: 「비우기」). */
  actionLabel?: string;
  /**
   * 확인 뒤 처리 중인지(WP-1682) — 이 prop 을 넘기면 확인을 눌러도 창을 닫지 않고(호출부가 처리가 끝나면 open 을 내린다),
   * true 인 동안 확인 버튼을 끄고 스피너를 보인다. 되돌릴 수 없는 서버 작업이 연타로 두 번 나가지 않고 진행이 보이게 하려는 것.
   * 넘기지 않으면 지금처럼 확인 즉시 닫힌다(기존 호출부 영향 없음).
   */
  pending?: boolean;
  /** 확인창 본문(AlertDialogContent)의 data-testid — E2E 가 특정 확인창을 집을 때 */
  contentTestId?: string;
  /** 확인(삭제) 버튼의 data-testid */
  confirmTestId?: string;
  /** 확인창이 열렸을 때 도움말 패널이 보일 매뉴얼 도움말 id(WP-1507) — 호출부가 글자 그대로 넘겨 manual:check 가 짝을 본다. */
  'data-help'?: string;
}

/** 트리거 모드(트리거 버튼이 연다) 또는 controlled 모드(모바일 액션 시트처럼 트리거 밖에서 연다, WP-223) — 둘 중 하나만. */
type DeleteConfirmDialogProps = BaseProps & (
  | { trigger: ReactNode; open?: never; onOpenChange?: never }
  | { trigger?: never; open: boolean; onOpenChange: (open: boolean) => void }
);

export function DeleteConfirmDialog({
  entityName,
  itemName,
  onConfirm,
  trigger,
  open,
  onOpenChange,
  description,
  impact,
  title,
  actionLabel = '삭제',
  pending,
  contentTestId,
  confirmTestId,
  'data-help': dataHelp,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
          {trigger}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent onClick={(e) => e.stopPropagation()} data-testid={contentTestId} data-help={dataHelp}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? `${entityName} 삭제`}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? (
              <>&quot;{itemName}&quot; {entityName}{eulReul(entityName)} 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</>
            )}
          </AlertDialogDescription>
          {typeof impact === 'string' ? <DeleteImpactNote note={impact} /> : impact}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업임을 시각적으로 표시 — 실수 클릭 방지 */}
          <AlertDialogAction
            variant="destructive"
            disabled={pending === true}
            onClick={(e) => {
              // pending 을 넘긴 호출부는 끝날 때 스스로 닫는다 — Radix 의 기본 닫기를 막는다.
              if (pending !== undefined) e.preventDefault();
              onConfirm();
            }}
            data-testid={confirmTestId}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 삭제 확인창의 영향 안내 문단 — note 가 없으면(0건·모름) 그리지 않는다(WP-488). */
export function DeleteImpactNote({ note }: { note: string | null | undefined }) {
  if (!note) return null;
  return <p className="text-sm font-medium text-foreground" data-testid="delete-impact">{note}</p>;
}
