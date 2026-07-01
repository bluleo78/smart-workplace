// 이슈 상세 우측 속성 레일 — 3개 접기 그룹으로 속성을 구조화.
// 무엇을: 상태·담당 / 일정 / 분류·관계 3그룹.
// 왜: 9개 속성이 단일 스크롤에 나열되어 과밀한 기존 aside 를 해소(#343).
// 첨부 섹션은 Task 2 에서, 활동 섹션은 Task 3 에서 본문 탭으로 이동 완료.

import { CyclePickerPopover } from '../../../components/cycle/CyclePickerPopover';
import { AiClassifyButton } from '../../../components/issue/AiClassifyButton';
import { LabelChip } from '../../../components/labels/LabelChip';
import { LabelPickerPopover } from '../../../components/labels/LabelPickerPopover';
import type { IssueFieldEntry } from '../../../types/customField';
import type { IssueLinkSummary, IssuePriority, IssueStatus, ParentRef, UpdateIssueRequest } from '../../../types/issue';
import type { LabelSummary } from '../../../types/label';
import type { UserSummary } from '../../../types/user';
import { AssigneePickerPopover } from './AssigneePickerPopover';
import { CustomFieldsSection } from './CustomFieldsSection';
import { DueDatePickerPopover } from './DueDatePickerPopover';
import { IssueDependenciesSection } from './IssueDependenciesSection';
import { IssueParentSlot } from './IssueParentSlot';
import { IssuePrioritySelect } from './IssuePrioritySelect';
import { IssuePropertyGroup } from './IssuePropertyGroup';
import { IssueStatusSelect } from './IssueStatusSelect';

// 속성 레일이 받는 props — 기존 aside 가 사용하던 summary.* 값 그대로 전달.
interface IssuePropertyRailProps {
  projectKey: string;
  issueNumber: number;
  isSubtask: boolean;
  parent: ParentRef | null;   // summary.parent
  status: IssueStatus;        // summary.status
  priority: IssuePriority;    // summary.priority
  dueDate: string | null;     // summary.dueDate
  assignees: UserSummary[];   // summary.assignees
  labels: LabelSummary[];     // summary.labels
  blockedBy: IssueLinkSummary[];  // summary.blockedBy
  blocks: IssueLinkSummary[];     // summary.blocks
  customFields: IssueFieldEntry[];    // summary.customFields
  updatePending: boolean;     // update.isPending
  onPatch: (changes: UpdateIssueRequest) => void;
  /** 서버 플래그 — 상태·우선순위·담당자·마감일·사이클 편집 가능 여부(멤버만). */
  canEditWorkflow?: boolean;
  /** AI 분류 제안 버튼 — undefined 이면 렌더 안 함 */
  onAiClassify?: () => void;
  isAiClassifying?: boolean;
  aiClassifyReason?: string | null;
}

export function IssuePropertyRail({
  projectKey,
  issueNumber,
  isSubtask,
  parent,
  status,
  priority,
  dueDate,
  assignees,
  labels,
  blockedBy,
  blocks,
  customFields,
  updatePending,
  onPatch,
  canEditWorkflow = false, // 안전 방향 기본값 — 호출자는 항상 명시적으로 전달
  onAiClassify,
  isAiClassifying,
  aiClassifyReason,
}: IssuePropertyRailProps) {
  // 분류 그룹 배지 — 라벨 수.
  const classificationCount = labels.length;
  // 커스텀 필드 그룹 배지 — 값이 채워진 필드 수는 섹션이 자체 관리하므로 정의 수 기준.
  const customFieldCount = customFields.length;
  // 의존성 그룹 배지 — 차단됨 + 차단 중(양방향) 합산.
  const dependencyCount = blockedBy.length + blocks.length;

  return (
    <div className="space-y-3" data-testid="property-rail">
      {/* SUBTASK 상세에서만 부모 슬롯 노출 */}
      {isSubtask && (
        <IssueParentSlot
          projectKey={projectKey}
          issueNumber={issueNumber}
          parent={parent}
        />
      )}

      {/* 그룹 1: 상태·담당 — 기본 펼침 */}
      <IssuePropertyGroup
        title="상태·담당"
        storageKey="issue-rail:status-people"
        defaultOpen={true}
        testId="property-group-status-people"
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">상태</label>
          <IssueStatusSelect
            value={status}
            onChange={(v) => onPatch({ status: v })}
            disabled={updatePending || !canEditWorkflow}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">우선순위</label>
          <IssuePrioritySelect
            value={priority}
            onChange={(v) => onPatch({ priority: v })}
            disabled={updatePending || !canEditWorkflow}
          />
        </div>
        {/* 담당자 — 라벨 + 인라인 필드(값 표시 겸 클릭 트리거). 칩/미지정은 필드 내부에서 렌더. */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">담당자</span>
          <AssigneePickerPopover
            projectKey={projectKey}
            issueNumber={issueNumber}
            current={assignees}
            disabled={updatePending || !canEditWorkflow}
          />
        </div>
        {/* AI 분류 제안 — 섹션 가장 아래(목업 배치). 구분선 후 full-width. */}
        {onAiClassify !== undefined && (
          <>
            <div className="border-t" />
            <AiClassifyButton
              hasTitle={true}
              isPending={isAiClassifying ?? false}
              reason={aiClassifyReason}
              onClick={onAiClassify}
              fullWidth
            />
          </>
        )}
      </IssuePropertyGroup>

      {/* 그룹 2: 일정 — 기본 펼침 */}
      <IssuePropertyGroup
        title="일정"
        storageKey="issue-rail:planning"
        defaultOpen={true}
        testId="property-group-planning"
      >
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">마감일</span>
          <DueDatePickerPopover
            value={dueDate}
            disabled={updatePending || !canEditWorkflow}
            onChange={(date) =>
              onPatch({
                dueDate: date,
                clearDueDate: !date,
              })
            }
          />
        </div>
        {/* 사이클 피커 — 이슈에 연결된 사이클 조회·변경 */}
        <section data-testid="issue-cycles-section">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">사이클</h3>
          <CyclePickerPopover projectKey={projectKey} issueNumber={issueNumber} />
        </section>
      </IssuePropertyGroup>

      {/* 그룹 3: 분류 — 라벨. 기본 접힘, 비어있지 않으면 배지 표시 */}
      <IssuePropertyGroup
        title="분류"
        storageKey="issue-rail:classification"
        defaultOpen={false}
        count={classificationCount}
        testId="property-group-classification"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">라벨</span>
            <LabelPickerPopover
              projectKey={projectKey}
              issueNumber={issueNumber}
              current={labels}
            />
          </div>
          <div className="flex flex-wrap gap-1" data-testid="issue-labels">
            {labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
            {labels.length === 0 && (
              <span className="text-xs text-muted-foreground">없음</span>
            )}
          </div>
        </div>
      </IssuePropertyGroup>

      {/* 그룹 4: 의존성 — 차단됨/차단 중 두 슬롯(커스텀 필드보다 앞). 기본 접힘, 비어있지 않으면 배지 표시 */}
      <IssuePropertyGroup
        title="의존성"
        storageKey="issue-rail:dependencies"
        defaultOpen={false}
        count={dependencyCount}
        testId="property-group-dependencies"
      >
        <IssueDependenciesSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          blockedBy={blockedBy}
          blocks={blocks}
        />
      </IssuePropertyGroup>

      {/* 그룹 5: 커스텀 필드 — 프로젝트 커스텀 필드 인라인 편집(Phase 4c). 기본 접힘 */}
      <IssuePropertyGroup
        title="커스텀 필드"
        storageKey="issue-rail:custom-fields"
        defaultOpen={false}
        count={customFieldCount}
        testId="property-group-custom-fields"
      >
        <CustomFieldsSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          current={customFields}
        />
      </IssuePropertyGroup>

    </div>
  );
}
