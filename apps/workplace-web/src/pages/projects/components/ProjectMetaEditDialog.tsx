// 프로젝트 설정 — 라벨·이슈 유형 편집 대화상자와 색상·아이콘 고르개(WP-660).
// 예전엔 이름만 고칠 수 있어 색·아이콘을 바꾸려면 지우고 다시 만들어야 했고(이슈에 붙은 연결이 사라진다),
// 이름이 겹치면 창이 닫히고 토스트만 떠 고치던 값을 잃었다. 이제 이름·색상(유형은 아이콘까지)을 한 창에서 고치고,
// 서버가 거절하면(이름 중복 409 등) 그 문구를 창 안에 보이고 닫지 않는다.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter';
import { extractApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

import { ISSUE_TYPE_ICONS } from '../../../lib/issueTypeIcons';
import { LABEL_COLORS } from '../../../lib/labelColors';
import { ICON_LABELS, ICON_NAMES, type IconName } from '../../../types/issueType';
import { COLOR_TOKEN_LABELS, COLOR_TOKENS, type ColorToken } from '../../../types/label';

/** 색상 견본 줄 — 만들기 폼과 편집 창이 같이 쓴다. testIdPrefix 를 주면 견본마다 `${prefix}${토큰}` testid 를 단다. */
export function ColorTokenPicker({
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
  className,
  swatchClassName,
}: {
  value: ColorToken;
  onChange: (tok: ColorToken) => void;
  ariaLabel: string;
  testIdPrefix?: string;
  /** 견본 줄 배치를 바꿀 때(예: 에픽 색 팝오버의 6열 격자, WP-1017). 기본은 입력 높이에 맞춘 한 줄 흐름. */
  className?: string;
  /** 견본 크기를 바꿀 때(예: 터치 기기에서 크게, WP-1017). */
  swatchClassName?: string;
}) {
  return (
    // 견본 줄을 입력(h-9) 높이에 맞춰야 items-end 정렬에서 '색상' 라벨이 '이름' 라벨과 같은 줄에 선다(WP-397).
    <div role="group" aria-label={ariaLabel} className={cn('flex min-h-9 items-center gap-1 flex-wrap', className)}>
      {COLOR_TOKENS.map((tok) => (
        <button
          key={tok}
          type="button"
          onClick={() => onChange(tok)}
          // 코드값(GRAY) 대신 한국어 색 이름 — 스크린리더가 읽고, 마우스엔 툴팁으로 보인다(WP-849).
          aria-label={COLOR_TOKEN_LABELS[tok]}
          title={COLOR_TOKEN_LABELS[tok]}
          aria-pressed={value === tok}
          className={cn('h-6 w-6 rounded-full', LABEL_COLORS[tok].dot, value === tok && 'ring-2 ring-foreground', swatchClassName)}
          data-testid={testIdPrefix && `${testIdPrefix}${tok}`}
        />
      ))}
    </div>
  );
}

/** 이슈 유형 아이콘 고르개 — 만들기 폼과 편집 창이 같이 쓴다. testid 는 `${testIdPrefix}${아이콘}`. */
export function IssueTypeIconPicker({
  value,
  onChange,
  testIdPrefix,
}: {
  value: IconName;
  onChange: (icon: IconName) => void;
  testIdPrefix: string;
}) {
  return (
    <div role="group" aria-label="유형 아이콘" className="flex min-h-9 items-center gap-1 flex-wrap">
      {ICON_NAMES.map((n) => {
        const I = ISSUE_TYPE_ICONS[n];
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={ICON_LABELS[n]}
            title={ICON_LABELS[n]}
            aria-pressed={value === n}
            data-testid={`${testIdPrefix}${n}`}
            className={cn(
              'h-6 w-6 inline-flex items-center justify-center rounded-full border',
              value === n && 'ring-2 ring-foreground',
            )}
          >
            <I className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}

/** 편집 창이 다루는 값 — icon 이 있으면(이슈 유형) 아이콘 고르개도 보인다. */
export interface ProjectMetaEditValue {
  name: string;
  colorToken: ColorToken;
  icon?: IconName;
}

/**
 * 라벨·이슈 유형 편집 창. target 이 있으면 열린다. onSave 가 resolve 되면 닫고, reject 되면 서버 문구를 창 안에 보인다 —
 * 그래서 호출부의 수정 훅은 실패 토스트를 띄우지 않는다(같은 말이 두 번 나오지 않게, WP-611 과 같은 방식).
 */
export function ProjectMetaEditDialog({
  title,
  target,
  onSave,
  onClose,
  nameMaxLength = 40,
}: {
  title: string;
  /** 이름 최대 길이 — 라벨·유형은 40, 상태는 30(서버 ProjectStatusService.NAME_MAX, WP-809). */
  nameMaxLength?: number;
  target: ({ id: number } & ProjectMetaEditValue) | null;
  onSave: (value: ProjectMetaEditValue) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* 대상이 바뀔 때마다 입력을 새로 채우려고 key 로 다시 그린다. */}
      {target && <EditForm key={target.id} title={title} initial={target} onSave={onSave} onClose={onClose} nameMaxLength={nameMaxLength} />}
    </Dialog>
  );
}

function EditForm({
  title,
  initial,
  onSave,
  onClose,
  nameMaxLength,
}: {
  title: string;
  nameMaxLength: number;
  initial: ProjectMetaEditValue;
  onSave: (value: ProjectMetaEditValue) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [colorToken, setColorToken] = useState(initial.colorToken);
  const [icon, setIcon] = useState(initial.icon);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Enter 저장 — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 저장으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter();

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave({ name: trimmed, colorToken, ...(icon && { icon }) });
      onClose();
    } catch (e) {
      setError(extractApiError(e, '저장하지 못했습니다'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent data-testid="meta-edit-dialog">
      <DialogHeader>
        <DialogTitle className="break-words pr-6">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="meta-edit-name">
            이름
          </label>
          <Input
            id="meta-edit-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onCompositionEnd={enterKey.onCompositionEnd}
            onKeyDown={(e) => enterKey.handleEnter(e, () => void save())}
            maxLength={nameMaxLength}
            aria-invalid={!!error}
          />
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium block">색상</span>
          <ColorTokenPicker value={colorToken} onChange={setColorToken} ariaLabel="색상" testIdPrefix="meta-edit-color-" />
        </div>
        {icon && (
          <div className="space-y-1">
            <span className="text-sm font-medium block">아이콘</span>
            <IssueTypeIconPicker value={icon} onChange={setIcon} testIdPrefix="meta-edit-icon-" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!name.trim() || saving}>
          저장
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
