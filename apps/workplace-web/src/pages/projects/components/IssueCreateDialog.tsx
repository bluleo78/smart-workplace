import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/useIsMobile';

import { AiClassifyButton } from '../../../components/issue/AiClassifyButton';
import { IssueBodyImageButton } from '../../../components/issue/IssueBodyImageButton';
import { getIssueTypeLabel } from '../../../lib/issueTypeLabels';
import { SUPPORTED_DATE_MAX, SUPPORTED_DATE_MIN } from '../../../lib/supportedDate';
import { useIssueCreateForm } from '../hooks/useIssueCreateForm';
import { MobileIssueCreateSheet } from './mobile/MobileIssueCreateSheet';

type Props = {
  projectKey: string; open: boolean; onOpenChange: (v: boolean) => void; personal?: boolean;
  // 유형 기본값 오버라이드 — 에픽 패널 「＋ 에픽 만들기」가 EPIC id 를 넘긴다. 미지정 시 기존 TASK 기본.
  initialTypeId?: number;
  // 처음 상태(WP-464·WP-808) — 보드 컬럼의 「이슈 추가」가 그 컬럼의 프로젝트 상태 id 를 넘긴다.
  initialStatusId?: number;
};

// 새 이슈 생성 진입점 — 모바일(<1024px)은 전체 화면 시트(WP-196), 데스크톱은 기존 모달.
// 훅 순서가 바뀌지 않도록 분기는 이 얇은 래퍼에서만 하고 각 구현이 자기 훅을 쓴다.
export function IssueCreateDialog(props: Props) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileIssueCreateSheet {...props} /> : <DesktopIssueCreateDialog {...props} />;
}

// 새 이슈 생성 모달. priority 기본 MID, dueDate 미지정 시 빈 문자열 → API 호출 직전 undefined 변환.
// 유형 select 의 기본값은 프로젝트 유형 목록에서 name === 'TASK' 인 id (없으면 첫 번째).
// personal=true 면 개인 프로젝트(#226) — 유형 select 를 숨긴다. 기본값 effect 가 typeId 를 TASK 로
// 채우므로 셀렉트가 없어도 payload 의 typeId 는 TASK 로 유지된다.
function DesktopIssueCreateDialog({ projectKey, open, onOpenChange, personal = false, initialTypeId, initialStatusId }: Props) {
  const f = useIssueCreateForm({ projectKey, open, onOpenChange, initialTypeId, initialStatusId });
  const { register, watch, setValue, formState: { errors } } = f.form;
  const { types, images, bodyField, bodyRef, classify, classifyReason, isSubtaskSelected, intakeOnly } = f;
  const currentTypeId = watch('typeId');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* 유형 드롭다운(에픽/버그/스토리 등)과 무관한 중립 문구로 통일 — 유형별 동적 제목보다 단순하고 확장에 안전 (#641) */}
        <DialogHeader><DialogTitle>새 이슈</DialogTitle><DialogDescription className="sr-only">새 이슈</DialogDescription></DialogHeader>
        {/* noValidate — 날짜 칸 min/max·부모 번호 칸 min/step 을 넘는 값이면 브라우저 기본 검증(영문 말풍선)이 제출을 먼저
            막아 zod 의 한국어 안내가 그려지지 않는다(WP-900·WP-906). 검증은 zod 스키마 한 곳에서 한다. */}
        <form noValidate onSubmit={f.onSubmit} className="space-y-4">
          {/* 보드 컬럼에서 연 경우 그 상태로 만들어진다는 것을 알린다(WP-464). */}
          {f.statusNote && (
            <p className="text-sm text-muted-foreground" data-testid="create-status-note">상태: {f.statusNote}</p>
          )}
          {/* 제목 — 필수 필드: FormField required 로 붉은 별표 표시 (캘린더 EventDialog 동일 패턴) */}
          <FormField label="제목" htmlFor="issue-title" required error={errors.title?.message}>
            <Input id="issue-title" {...register('title')} />
          </FormField>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="issue-body">본문</label>
              <IssueBodyImageButton onFiles={images.uploadFiles} />
            </div>
            <Textarea
              id="issue-body"
              aria-invalid={!!errors.body || undefined}
              aria-describedby={errors.body ? 'issue-body-error' : undefined}
              {...bodyField}
              ref={(el) => {
                bodyField.ref(el);
                bodyRef.current = el;
              }}
              rows={6}
              onPaste={images.onPaste}
              onDrop={images.onDrop}
              onDragOver={images.onDragOver}
            />
            {/* 10000자 초과 검증 실패를 그리지 않으면 「생성」이 아무 반응 없이 멈춘다(WP-929). */}
            {errors.body && (
              <p id="issue-body-error" role="alert" className="text-sm text-destructive">
                {errors.body.message}
              </p>
            )}
          </div>
          {/* OPEN 프로젝트 비멤버는 접수만 한다(WP-477) — 유형·우선순위·일정·부모 칸과 AI 분류(유형·우선순위 제안) 대신 안내 한 줄. */}
          {intakeOnly ? (
            <p className="text-sm text-muted-foreground" data-testid="create-intake-notice">우선순위·일정은 처리팀이 정합니다</p>
          ) : (<>
          {/* AI 분류 제안 버튼 — 제목이 있을 때만 활성화. */}
          <AiClassifyButton
            hasTitle={!!(watch('title') ?? '').trim()}
            isPending={classify.isPending}
            reason={classifyReason}
            onClick={f.handleClassify}
          />
          {/* 유형(팀만)/우선순위/시작일/마감일 — 필드 수에 맞춰 컬럼 수를 맞춰 마지막 줄이 혼자 남지 않게 한다.
              팀은 4칸 한 줄이면 칸이 약 106px 라 날짜 입력의 연도가 잘려(WP-463) 2×2(유형·우선순위 / 시작일·마감일)로 둔다. */}
          <div className={personal ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3'}>
            {/* 개인 프로젝트는 TASK 단일 유형(#226) — 유형 select 를 숨긴다(typeId 는 effect 가 TASK 로 채움). */}
            {!personal && (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="issue-type">유형</label>
                {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
                {/* shadcn Select — value 는 항상 string 이어야 controlled 유지(undefined 면 mount→로드 사이 uncontrolled→controlled 전환 경고, #364). 미선택은 '' 로 표현. */}
                <Select
                  value={currentTypeId !== undefined ? String(currentTypeId) : ''}
                  onValueChange={(v) => setValue('typeId', Number(v))}
                >
                  <SelectTrigger
                    id="issue-type"
                    data-testid="create-type-select"
                    aria-label="이슈 유형"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(types.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {getIssueTypeLabel(t.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-priority">우선순위</label>
              {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
              <Select
                value={watch('priority') ?? 'MID'}
                onValueChange={(v) => setValue('priority', v as 'LOW' | 'MID' | 'HIGH')}
              >
                <SelectTrigger id="issue-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">낮음</SelectItem>
                  <SelectItem value="MID">보통</SelectItem>
                  <SelectItem value="HIGH">높음</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-start">시작일</label>
              <Input
                id="issue-start"
                type="date"
                min={SUPPORTED_DATE_MIN}
                max={SUPPORTED_DATE_MAX}
                aria-invalid={!!errors.startDate || undefined}
                aria-describedby={errors.startDate ? 'issue-start-error' : undefined}
                {...register('startDate')}
              />
              {errors.startDate && (
                <p id="issue-start-error" role="alert" className="text-sm text-destructive">
                  {errors.startDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-due">마감일</label>
              <Input
                id="issue-due"
                type="date"
                min={SUPPORTED_DATE_MIN}
                max={SUPPORTED_DATE_MAX}
                aria-invalid={!!errors.dueDate || undefined}
                aria-describedby={errors.dueDate ? 'issue-due-error' : undefined}
                {...register('dueDate')}
              />
              {/* 마감일 오류도 그린다 — 안 그리면 「생성」이 막혀도 아무 안내가 없었다(WP-900). */}
              {errors.dueDate && (
                <p id="issue-due-error" role="alert" className="text-sm text-destructive">
                  {errors.dueDate.message}
                </p>
              )}
            </div>
          </div>
          {/* SUBTASK 선택 시에만 부모 number 입력 노출 (Phase 4a).
              valueAsNumber 로 number 변환 — 빈 값은 NaN 이 되어 송신 시 undefined. */}
          {isSubtaskSelected && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="create-parent-number">
                부모 이슈 번호
              </label>
              <Input
                id="create-parent-number"
                type="number"
                min={1}
                aria-invalid={!!errors.parentNumber || undefined}
                aria-describedby={errors.parentNumber ? 'create-parent-number-error' : undefined}
                {...register('parentNumber', { valueAsNumber: true })}
                data-testid="create-parent-number"
              />
              {errors.parentNumber && (
                <p id="create-parent-number-error" role="alert" className="text-sm text-destructive">
                  {errors.parentNumber.message}
                </p>
              )}
            </div>
          )}
          </>)}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={f.isSubmitting}>{f.isCreating ? '생성 중…' : '생성'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
