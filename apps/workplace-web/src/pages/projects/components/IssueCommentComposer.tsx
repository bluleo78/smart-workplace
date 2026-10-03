// 이슈 신규 코멘트 작성창 — IssueCommentList 에서 분리(WP-196).
// 왜: 데스크톱은 활동 탭(코멘트 목록 아래)에, 모바일은 화면 하단 고정 줄에 같은 작성창을 둔다.
// #785: 이슈 채팅과 동일한 RichInput + 공용 멘션 파이프라인 — @ 자동완성 지원.

import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { RichInput } from '@/components/mentions/RichInput';
import type { MentionCandidate } from '@/components/mentions/types';

import { useCreateComment } from '../../../hooks/queries/useIssueComments';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { handleApiError } from '../../../lib/api-error';

// 코멘트 본문 최대 길이 — createCommentSchema/updateCommentSchema(서버 @Size)와 동일 기준. 목록의 수정 폼도 공유.
export const COMMENT_MAX_LENGTH = 10000;

export function IssueCommentComposer({
  projectKey,
  issueNumber,
  issueId,
  editorMaxHeightClass,
  keepFocusOnSubmit,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  /** RichInput 에디터 최대 높이 — 모바일 하단은 4줄(max-h-28). 미지정 시 RichInput 기본. */
  editorMaxHeightClass?: string;
  /** 전송 탭이 에디터를 blur 하지 않게(모바일 키보드 유지). RichInput 으로 그대로 전달. */
  keepFocusOnSubmit?: boolean;
}) {
  const create = useCreateComment(projectKey, issueNumber, issueId);

  // 프로젝트 멤버 = RichInput @ 자동완성 후보(목록 쪽 역매핑과 같은 쿼리 캐시 공유).
  const membersQuery = useProjectMembers(projectKey);
  const mentionCandidates: MentionCandidate[] = membersQuery.data ?? [];

  // 새로고침 시 작성 중이던 코멘트 유실 방지 (#620) — RichInput 은 실시간 본문을 노출하지 않으므로
  // "입력 발생 여부"로 근사한다. 제출 성공 직후의 clearOnSubmit 이 유발하는 onChange 는
  // suppressNextChangeRef 로 걸러 거짓 경고를 막는다.
  const [hasDraft, setHasDraft] = useState(false);
  const suppressNextChangeRef = useRef(false);
  useUnsavedChangesWarning(hasDraft);

  const handleDraftChange = () => {
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      setHasDraft(false);
      return;
    }
    setHasDraft(true);
  };

  // 제출 → API 호출 → 성공 시 clearOnSubmit 이 입력창을 비움 + 토스트, 실패 시 입력 보존(reject) + 공통 에러 핸들러.
  const handleSubmit = async (body: string): Promise<void> => {
    try {
      await create.mutateAsync({ body });
      suppressNextChangeRef.current = true;
      toast.success('코멘트를 작성했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 작성에 실패했습니다');
      throw e;
    }
  };

  return (
    // RichInput — 이슈 채팅(ChatComposer)과 동일한 컴포넌트로 시각 일관성(#310) + 멘션 자동완성(#785) 확보
    <RichInput
      members={mentionCandidates}
      onSubmit={handleSubmit}
      onChange={handleDraftChange}
      clearOnSubmit
      disableWhenEmpty
      maxLength={COMMENT_MAX_LENGTH}
      placeholder="코멘트를 작성하세요"
      submitLabel={create.isPending ? '작성 중…' : '작성'}
      submitDisabled={create.isPending}
      inputTestId="issue-comment-input"
      submitTestId="issue-comment-submit"
      editorMaxHeightClass={editorMaxHeightClass}
      keepFocusOnSubmit={keepFocusOnSubmit}
    />
  );
}
