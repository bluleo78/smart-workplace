import { zodResolver } from '@hookform/resolvers/zod';
import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type FieldErrors, type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { ISSUE_IMAGE_PATH_SOURCE, uploadIssueImage } from '../../../api/issueImages';
import type { RichInputHandle } from '../../../components/mentions/RichInput';
import type { MentionCandidate } from '../../../components/mentions/types';
import { useComponents } from '../../../hooks/queries/useComponents';
import { useIssueAiClassify } from '../../../hooks/queries/useIssueAiClassify';
import { useCreateIssue } from '../../../hooks/queries/useIssues';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useProject } from '../../../hooks/queries/useProjects';
import { isStatusGoneError, useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { extractApiError, handleApiError } from '../../../lib/api-error';
import { INCOMPLETE_DATE_MESSAGE, isIncompleteDateInput } from '../../../lib/dateInput';
import { hasActiveComponents } from '../../../lib/issueComponents';
import { type CreateEpicChoice, resolveCreateParent } from '../../../lib/issueCreateParent';
import { hasIssueDraftContent } from '../../../lib/issueDraft';
import { isIntakeOnly } from '../../../lib/projectPermissions';
import { defaultStatusOf } from '../../../lib/projectStatuses';
import { type CreateIssueFormData, createIssueSchema } from '../../../lib/validations/issue';
import { type CreateMode, useCreateAiHandoff } from './useCreateAiHandoff';

// 본문 속 이슈 이미지 주소 전부 — 첫 묶음이 프로젝트 키. 모듈에 한 번만 만든다(렌더마다 새로 만들지 않게).
// g 플래그는 matchAll 용이다 — matchAll 은 정규식을 복제해 쓰므로 공유 lastIndex 상태가 남지 않는다(test()/exec() 로는 쓰지 않는다).
const ISSUE_IMAGE_PATH_ALL = new RegExp(ISSUE_IMAGE_PATH_SOURCE, 'g');

/** 본문에 projectKey 프로젝트의 이슈 이미지 주소가 하나라도 있는지 — 다른 프로젝트 이미지는 세지 않는다. */
function bodyHasProjectImage(body: string, projectKey: string): boolean {
  for (const m of body.matchAll(ISSUE_IMAGE_PATH_ALL)) if (m[1] === projectKey) return true;
  return false;
}

const zodIssueCreateResolver = zodResolver(createIssueSchema);
const DATE_FIELDS = ['startDate', 'dueDate'] as const;
// 검사 실패 때 포커스를 옮길 칸 — 화면 위에서 아래 순서(두 화면 모두 이 순서로 그린다).
const ERROR_FOCUS_ORDER = ['title', 'body', 'startDate', 'dueDate', 'parentNumber'] as const;
// 멘션 후보를 아직 받지 못했을 때 — 렌더마다 새 빈 배열을 만들지 않게 하나를 쓴다.
const NO_MEMBERS: MentionCandidate[] = [];

/**
 * 이슈 만들기 폼 검사 — zod 검사에 「덜 넣은 날짜」 판정을 더한다(WP-1644, 이유는 lib/dateInput).
 * 값이 '' 라 zod 로는 못 거르므로 react-hook-form 이 넘겨 주는 칸 요소(fields[name].ref)를 읽는다. 검사 안에 두어
 * 제출(주 단추·「만들기만」)·다른 오류 함께 보이기·첫 오류 칸 포커스·제출 뒤 다시 검사가 다른 오류와 똑같이 움직인다.
 * 모바일 시트는 날짜 칸이 달력이라(ref 가 input 이 아님) 판정이 늘 false 다.
 */
const issueCreateResolver: Resolver<CreateIssueFormData> = async (values, context, options) => {
  const result = await zodIssueCreateResolver(values, context, options);
  const incomplete = DATE_FIELDS.filter((name) => isIncompleteDateInput(options.fields[name]?.ref));
  if (incomplete.length === 0) return result;
  const errors = { ...result.errors };
  for (const name of incomplete) errors[name] = { type: 'incomplete', message: INCOMPLETE_DATE_MESSAGE };
  return { values: {}, errors };
};

// 이슈 생성 폼 로직 — 데스크톱 다이얼로그와 모바일 시트가 공유한다(WP-196). 렌더링은 각 컴포넌트 몫.
export function useIssueCreateForm({
  projectKey, open, onOpenChange, initialTypeId, initialStatusId, initialAgentId,
}: {
  projectKey: string; open: boolean; onOpenChange: (v: boolean) => void;
  // 유형 기본값 오버라이드 — 에픽 패널 「＋ 에픽 만들기」가 EPIC id 를 넘긴다. 미지정 시 기존 TASK 기본.
  initialTypeId?: number;
  // 처음 프로젝트 상태 id(WP-464·WP-808) — 보드 컬럼의 「이슈 추가」가 그 컬럼 상태를 넘긴다. 미지정이면 할 일(범주 기본 상태).
  initialStatusId?: number;
  // 맡길 AI 미리 채우기(WP-1767) — 사람 카드의 「일 맡기기」. 열리면 「AI 에게 맡기기」가 펼쳐져 그 AI 가 골라진다.
  initialAgentId?: number;
}) {
  const create = useCreateIssue(projectKey);
  const classify = useIssueAiClassify(projectKey);
  // AI 제안 이유 — 제안 후 버튼 아래 표시.
  const [classifyReason, setClassifyReason] = useState<string | null>(null);
  const types = useIssueTypes(projectKey);
  // 처음 상태 안내 문구용 — 넘겨받은 상태 id 의 이름(WP-808).
  const statuses = useProjectStatusList(projectKey);
  const initialStatus = statuses.find((s) => s.id === initialStatusId);
  // OPEN 프로젝트 비멤버는 접수만 한다(WP-477) — 화면은 유형·우선순위·일정·담당자·부모 칸을 숨기고 송신도 제목·본문만 한다.
  const project = useProject(projectKey).data;
  const intakeOnly = isIntakeOnly(project);
  // 구성요소(WP-933) — 만들 때 고르는 것은 구성원만(서버도 비구성원 componentIds 를 거절). 개인 프로젝트는 구성요소가 없어 요청하지 않는다.
  // 사용 중 구성요소가 하나도 없으면 칸을 그리지 않는다(showComponents) — 구성요소를 안 쓰는 프로젝트의 만들기 창은 그대로.
  const components = useComponents(projectKey, { enabled: !!project && project.type !== 'PERSONAL' && !intakeOnly });
  const componentList = components.data ?? [];
  const showComponents = !intakeOnly && hasActiveComponents(componentList);
  const [componentIds, setComponentIds] = useState<number[]>([]);
  // 「AI 에게 맡기기」(WP-1315) — 만든 뒤 실행 일정을 저장하고, 「만들고 지금 실행」이면 시험 실행을 보낸다.
  const ai = useCreateAiHandoff(projectKey, open, initialAgentId);
  // 만들기 뒤 일정 저장·지금 실행까지 도는 동안 버튼을 잠근다(만들기 요청만 끝나도 두 번 누를 수 없게).
  const [submitting, setSubmitting] = useState(false);
  // 같은 틱에 두 번 눌러도(버튼 비활성이 그려지기 전 — Enter 연타·더블클릭) 만들기·지금 실행이 두 번 나가지 않게 막는 동기 잠금.
  const inFlight = useRef(false);
  // 모바일 에픽 칩 값(R8) — 폼 스키마 밖 별도 상태. 일반 이슈의 부모로 송신되고(다른 프로젝트 에픽은 parentKey, WP-1039), EPIC·SUBTASK 유형이면 해제된다.
  const [epic, setEpic] = useState<CreateEpicChoice | null>(null);
  const form = useForm<CreateIssueFormData>({
    resolver: issueCreateResolver,
    defaultValues: { priority: 'MID' },
    // 첫 오류 칸 포커스는 아래 focusFirstError 가 화면 순서대로 직접 한다 — 본문 칸은 DOM 입력이 아닌 편집칸이라
    // react-hook-form 의 등록 순서 포커스로는 본문을 화면 순서에 끼울 수 없다.
    shouldFocusError: false,
  });
  const { register, handleSubmit, reset, setValue, watch, getFieldState, trigger, setFocus } = form;

  // 본문 칸(WP-1657) — 본문 모드 RichInput(칸 안 이미지). 편집칸은 비제어(마운트 때 원문을 한 번 읽음)라 DOM ref 를 react-hook-form 에 걸 수 없다.
  // 그래서 register('body') 는 ref 없이 검사 대상(5만 자 상한)으로만 두고, 값은 편집칸이 알리는 원문(onBodyChange)으로 넣는다.
  // (ref 에 오래 사는 가짜 객체를 걸면 react-hook-form 이 그 객체에 값을 써 두었다가 reset 뒤 다시 등록할 때 지난 본문을 읽어 온다.)
  // 편집칸 핸들 — 데스크톱 「이미지」 버튼이 커서 자리에 이미지를 넣고(insertImages), 검사 실패 때 본문 끝으로 포커스한다(focus).
  const bodyEditorRef = useRef<RichInputHandle | null>(null);
  register('body');
  // 편집칸 안에 업로드 중 이미지(자리표시)가 있는가. 자리표시는 원문에 실리지 않으므로(빈 글자) 토큰 검사 대신 이 상태로 생성을 막는다.
  // ref 로도 들고 있어 같은 틱의 제출(onUploadingChange 직후 Enter 등)도 다시 그리기 전 최신 값을 읽는다.
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const onUploadingChange = useCallback((next: boolean) => {
    uploadingRef.current = next;
    setUploading(next);
  }, []);
  // 편집칸 원문 → 폼 값. 다듬지 않는다(앞뒤 공백·빈 줄 그대로 보낸다). 제출한 뒤에는 바로 다시 검사해 줄이면 5만 자 오류가 걷힌다
  // (예전 Textarea 는 react-hook-form 의 onChange 재검사가 했다). form 은 렌더마다 같은 객체라 지금 제출 상태를 읽는다.
  const onBodyChange = useCallback(
    (next: string) => setValue('body', next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted }),
    [form, setValue],
  );
  // 본문 모드 설정·이미지 업로드 함수 — 편집칸이 마운트 때 읽거나 ref 로 최신 값을 읽지만, 렌더마다 새로 만들지 않게 메모한다.
  const bodyMode = useMemo(() => ({ projectKey }), [projectKey]);
  const imageUpload = useCallback((file: File) => uploadIssueImage(projectKey, file), [projectKey]);
  // 멘션 후보(@) — 프로젝트 구성원.
  const members = useProjectMembers(projectKey).data ?? NO_MEMBERS;

  /**
   * 시작일·마감일 칸(WP-1644) — 덜 넣은 날짜 판정은 위 resolver 가 하고, 여기서는 안내를 거두는 때만 더한다.
   * 칸을 비우면 값이 '' 그대로라 change 가 오지 않고, 제출 뒤 react-hook-form 은 blur 에서 다시 검사하지 않으므로
   * 오류가 서 있을 때 keyUp·blur 에서 그 칸을 다시 검사한다. 달력으로 고르는 change 는 react-hook-form 이 다시 검사한다.
   * 화면(JSX)에서 그 칸을 그릴 때 부른다(입력 요소 ref 를 react-hook-form 에 건다 — 덜 넣은 날짜 판정·오류 칸 포커스가 읽는다).
   */
  const dateField = (name: 'startDate' | 'dueDate') => {
    const field = register(name);
    const recheck = () => {
      if (getFieldState(name).error) void trigger(name);
    };
    return {
      ...field,
      onKeyUp: recheck,
      onBlur: (e: FocusEvent<HTMLInputElement>) => {
        recheck();
        return field.onBlur(e);
      },
    };
  };

  // dialog가 열릴 때 폼 상태 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    // 업로드 상태는 열 때·닫힐 때 모두 거둔다 — 편집칸은 닫히면서 버려져(올리던 이미지도 함께) 알림이 오지 않고, 열 때마다 새로 만들어진다.
    // 닫힐 때 거두지 않으면 다시 열린 첫 렌더에 옛 값(true)이 남아 잠깐 hasContent·isSubmitting 이 true 가 된다.
    uploadingRef.current = false;
    setUploading(false);
    if (!open) return;
    reset({ priority: 'MID' });
    setClassifyReason(null); // AI 제안 이유 초기화
    setEpic(null); // 에픽 칩 선택 초기화
    setComponentIds([]); // 구성요소 선택 초기화
  }, [open, reset]);

  // 열린 채 프로젝트가 바뀌면(WP-1768 창 안 프로젝트 고르기) 제목·본문만 남기고 나머지를 처음으로 — 유형·구성요소·에픽·부모·담당자는
  // 프로젝트마다 다른 값이라 앞 프로젝트의 것을 실으면 서버가 거절한다. 유형은 아래 effect 가 새 프로젝트 목록으로 다시 채운다
  // (이 effect 가 먼저 선언돼 같은 커밋에서도 비운 뒤 채운다). AI 맡기기는 useCreateAiHandoff 가 projectKey 로 따로 돌린다.
  const prevProjectKey = useRef(projectKey);
  useEffect(() => {
    if (prevProjectKey.current === projectKey) return;
    prevProjectKey.current = projectKey;
    if (!open) return;
    const { title, body } = form.getValues();
    reset({ priority: 'MID', title, body });
    setClassifyReason(null);
    setEpic(null);
    setComponentIds([]);
  }, [projectKey, open, form, reset]);

  // 유형 목록 로드 시 기본값 세팅 — name === 'TASK' 우선, 없으면 첫 항목.
  useEffect(() => {
    const list = types.data;
    if (!list || list.length === 0) return;
    const currentTypeId = watch('typeId');
    if (currentTypeId) return;
    const task = list.find((t) => t.name === 'TASK');
    // initialTypeId 우선(존재하는 유형일 때만) → TASK → 첫 항목.
    const preferred = initialTypeId != null ? list.find((t) => t.id === initialTypeId) : undefined;
    setValue('typeId', preferred?.id ?? task?.id ?? list[0].id);
    // open 의존: 다이얼로그 재오픈 시 reset 이 typeId 를 지운 뒤 이 effect 가 다시 TASK 기본값을 채우도록 한다.
    // (개인 프로젝트는 select 가 숨겨져 사용자 보정이 불가하므로 payload typeId 누락을 막는 것이 특히 중요.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data, open, projectKey]);

  const currentTypeId = watch('typeId');
  // 선택된 유형이 SUBTASK 인지 — parentNumber 입력 동적 노출 + 송신 분기에 사용 (Phase 4a).
  const selectedType = (types.data ?? []).find((t) => t.id === currentTypeId);
  const isSubtaskSelected = selectedType?.name === 'SUBTASK';
  const isEpicSelected = selectedType?.name === 'EPIC';

  // 유형이 EPIC/SUBTASK 로 바뀌면 에픽 해제 — 남은 값이 parentNumber 로 새면 백엔드가 400.
  useEffect(() => {
    if (isEpicSelected || isSubtaskSelected) setEpic(null);
  }, [isEpicSelected, isSubtaskSelected]);

  // 새로고침 시 입력값 유실 방지 (#620) — 모달이 열려 있고 제목/본문 중 하나라도
  // 입력되어 있으면 beforeunload 확인 다이얼로그를 띄운다.
  const titleValue = watch('title');
  const bodyValue = watch('body');
  // hasContent 는 버림 확인에도 쓰인다. 글자 없이 이미지만 올리는 중이어도(원문은 아직 빈 글자) 버리면 아까운 입력으로 본다.
  const hasContent = hasIssueDraftContent(titleValue, bodyValue) || uploading;
  // 프로젝트 칸 잠금(WP-1768) — 본문 이미지는 그 프로젝트 키 주소로 올라가고 서버는 같은 프로젝트 이미지만 이슈에 잇는다(나머지는 하루 뒤 정리).
  // 지금 프로젝트의 이미지를 넣었거나 올리는 중이면 프로젝트를 바꾸지 못하게 해 이미지가 조용히 사라지지 않게 한다.
  // 다른 프로젝트 이미지(다른 이슈 본문에서 붙여넣은 주소 등)는 어차피 이 이슈에 이어지지 않으므로 잠그지 않는다.
  const hasOwnImage = useMemo(() => bodyHasProjectImage(bodyValue ?? '', projectKey), [bodyValue, projectKey]);
  const projectLocked = uploading || hasOwnImage;
  useUnsavedChangesWarning(open && hasContent);

  // AI 제안 핸들러 — 현재 폼 제목·본문으로 분류 요청.
  // 성공 시 type/priority 덮어쓰기, reason 표시. AI 제안 실패해도 폼 동작 보존.
  const handleClassify = () => {
    const title = watch('title') ?? '';
    const body = watch('body') ?? '';
    classify.mutate(
      { title, body },
      {
        onSuccess: (result) => {
          // 유형 제안 — 개인 프로젝트(personal=true)는 result.type 이 null 이므로 skip.
          if (result.type && types.data) {
            const matched = types.data.find((t) => t.name === result.type);
            if (matched) setValue('typeId', matched.id);
          }
          // 우선순위 덮어쓰기.
          setValue('priority', result.priority);
          setClassifyReason(result.reason);
        },
        // 서버 문구를 우선한다 — AI 연동 꺼짐(409 AI_DISABLED, WP-1640)·비서 없음(422)의 이유가 보이게.
        onError: (e) => {
          toast.error(extractApiError(e, 'AI 제안을 받지 못했습니다'));
        },
      },
    );
  };

  /**
   * 검사 실패 때 화면 위에서부터 첫 오류 칸으로 포커스한다(제목 → 본문 → 시작일 → 마감일 → 상위 이슈 번호) — 두 제출 경로가 함께 쓴다.
   * 본문은 편집칸 핸들(본문 끝으로 포커스), 나머지는 react-hook-form 이 쥔 입력 요소 ref(setFocus).
   * 모바일 시트의 날짜는 달력 칩이라 입력 요소가 없어 setFocus 가 아무것도 하지 않는다.
   */
  const focusFirstError = (errors: FieldErrors<CreateIssueFormData>) => {
    for (const name of ERROR_FOCUS_ORDER) {
      if (!errors[name]) continue;
      if (name === 'body') bodyEditorRef.current?.focus();
      else setFocus(name);
      return;
    }
  };

  const submit = async (data: CreateIssueFormData, mode: CreateMode) => {
    // 맡기기 일정이 틀리면(요일 없음·시각 형식) 만들지 않고 문구를 보인다 — 작업만 만들어지고 일정이 빠지지 않게 먼저 막는다.
    if (!intakeOnly && !ai.check()) return;
    // 업로드 중 이미지는 원문에 실리지 않아 그대로 만들면 이미지가 빠진다 — 마지막으로 막는다(버튼 비활성의 우회 경로 — 폼 제출 등).
    if (uploadingRef.current) {
      toast.error('이미지 업로드가 끝난 뒤 등록해 주세요');
      return;
    }
    const payload = intakeOnly ? { title: data.title, body: data.body || undefined } : {
      ...data,
      dueDate: data.dueDate || undefined,
      startDate: data.startDate || undefined,
      body: data.body || undefined,
      typeId: data.typeId ?? undefined,
      // 넘겨받은 상태가 지금 목록에 없으면(삭제돼 409 STATUS_DELETED·400 STATUS_NOT_FOUND 뒤 목록을 다시 받음, WP-936) 빼고 보낸다 — 서버가 할 일 기본
      // 상태로 만든다. 그대로 실으면 다시 눌러도 같은 409 만 되풀이한다. 목록을 아직 모르면(빈 배열) 넘겨받은 값을 그대로 싣는다.
      statusId: initialStatus?.id ?? (statuses.length === 0 ? initialStatusId : undefined),
      // SUBTASK=부모 태스크 번호, 일반 이슈=모바일 에픽 칩(R8, 백엔드는 일반 이슈 부모로 EPIC 만 허용 — 다른 프로젝트 에픽은 parentKey), EPIC=부모 불가.
      // 결과에 parentNumber 가 늘 있어 폼 값(...data)을 덮어쓴다.
      ...resolveCreateParent({
        isSubtask: isSubtaskSelected,
        isEpic: isEpicSelected,
        formParentNumber: data.parentNumber,
        epic,
        projectKey,
      }),
      // 고른 구성요소 — 칸이 보일 때만(구성원·사용 중 구성요소 있음). 담당자를 비워 두면 서버가 구성요소 담당자를 자동으로 붙인다.
      componentIds: showComponents && componentIds.length > 0 ? componentIds : undefined,
    };
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const created = await create.mutateAsync(payload);
      // 맡기기가 켜져 있으면 일정 저장(·지금 실행)까지 하고 그 결과를 토스트로 알린다. 일정 저장이 실패해도 작업은 이미 있어 창을 닫는다.
      const handled = !intakeOnly && (await ai.afterCreate(created.number, mode));
      if (!handled) toast.success('태스크를 생성했습니다');
      reset({ priority: 'MID' });
      onOpenChange(false);
    } catch (e) {
      // 처음 상태가 없어졌으면(WP-936) 서버 문구 「다른 상태를 골라 주세요」 대신 결과를 알린다 — 다이얼로그엔 상태 고르기가 없고,
      // 목록을 다시 받으면 위 statusId 가 빠져 다시 누르면 할 일 기본 상태로 만들어진다.
      if (isStatusGoneError(e)) {
        toast.error(`상태가 방금 삭제됐어요. 다시 만들면 '${defaultStatusOf(statuses, 'TODO')?.name ?? '할 일'}'로 만들어져요.`);
      } else {
        handleApiError(e, '태스크 생성에 실패했습니다');
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return {
    // 할 일이 아닌 처음 상태면 다이얼로그에 「상태: 진행 중」처럼 보인다(접수 전용은 상태를 보내지 않으므로 없음).
    // 할 일 범주의 기본 상태(새 이슈 기본값)면 안내하지 않는다 — 「검토 중」처럼 다른 상태에서 연 경우만.
    statusNote: !intakeOnly && initialStatus && initialStatus.id !== defaultStatusOf(statuses, 'TODO')?.id ? initialStatus.name : null,
    form, types, intakeOnly, selectedType, isSubtaskSelected, isEpicSelected,
    classify, classifyReason, handleClassify,
    // 본문 칸(본문 모드 RichInput)에 넘길 것 — 두 화면이 같이 쓴다. bodyMode·imageUpload·두 콜백은 렌더마다 같은 참조.
    bodyEditor: { ref: bodyEditorRef, bodyMode, imageUpload, members, onBodyChange, onUploadingChange },
    // 시작일·마감일 칸에 펼치는 register 결과 — 덜 넣은 날짜 안내를 거두는 keyUp·blur 가 얹혀 있다(WP-1644).
    dateField,
    // 폼 제출(Enter·주 버튼) — 맡기기가 켜져 있으면 「만들고 지금 실행」, 아니면 만들기. 검사 실패면 첫 오류 칸으로 포커스.
    onSubmit: handleSubmit((d) => submit(d, 'run'), focusFirstError),
    // 「만들기만」 — 맡기기 일정은 저장하되 지금 실행하지 않는다.
    onSubmitOnly: handleSubmit((d) => submit(d, 'only'), focusFirstError),
    ai,
    // 버튼을 맡기기용(「만들고 지금 실행」/「만들기만」)으로 그릴지 — 맡겼거나 담당 AI 후보를 받는 중(그때는 잠가 둔다). 접수 전용은 맡기지 않는다.
    aiActions: !intakeOnly && (ai.active || ai.loading),
    // 버튼 비활성 = 생성 요청 중 또는 이미지 업로드 중. 「생성 중…」 문구는 실제 생성 요청 중일 때만(isCreating) — 업로드 중엔 「생성」 유지.
    // submitting 이 만들기 요청(create)부터 일정 저장·지금 실행까지 덮는다.
    isSubmitting: uploading || submitting,
    isCreating: submitting,
    hasContent, epic, setEpic,
    // 프로젝트 고르기 칸을 잠글지(WP-1768) — 본문에 이슈 이미지가 있거나 올리는 중.
    projectLocked,
    // 구성요소(WP-933) — 칸 노출 여부·목록(보관 포함)·고른 id.
    showComponents, componentList, componentIds, setComponentIds,
  };
}
