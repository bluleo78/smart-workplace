// 메일 계정 목록 조회 + 생성/수정/삭제/연결 테스트 mutation. queryKey 는 ['mail-accounts'] 단일.

import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createMailAccount,
  deleteMailAccount,
  getM365MailStatus,
  listMailAccounts,
  setMailAiEnabled,
  setMailNotifyMode,
  testMailConnection,
  testMailConnectionForAccount,
  updateMailAccount,
} from '../../api/mailAccounts';
import { handleApiError } from '../../lib/api-error';
import type { MailAccountRequest, MailAccountResponse, MailNotifyMode } from '../../types/mailAccount';

export const mailAccountKeys = {
  all: ['mail-accounts'] as const,
};

export function useMailAccounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mailAccountKeys.all,
    queryFn: listMailAccounts,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 메일 계정 추가 시 Outlook(Microsoft 365)을 기본으로 고를지(WP-879). 워크스페이스 설정이라 거의 바뀌지 않는다.
 * 실패하면 기본값(IMAP)을 그대로 쓰면 되므로 재시도하지 않는다.
 */
export function useM365MailStatus() {
  return useQuery({
    // 계정 목록 키(['mail-accounts']) 밖에 둔다 — 계정 추가·수정 무효화 때마다 다시 조회할 필요가 없다.
    queryKey: ['mail-m365-status'],
    queryFn: getM365MailStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useCreateMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MailAccountRequest) => createMailAccount(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 추가했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 추가에 실패했습니다'),
  });
}

export function useUpdateMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MailAccountRequest }) =>
      updateMailAccount(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 수정에 실패했습니다'),
  });
}

export function useDeleteMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMailAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 삭제에 실패했습니다'),
  });
}

// 연결 테스트는 캐시 무효화 없이 결과만 반환(폼 인라인 표시).
export function useTestMailConnection() {
  return useMutation({
    mutationFn: (body: MailAccountRequest) => testMailConnection(body),
  });
}

/** 모든 활성 메일 계정의 개인 비서 사용 여부를 일괄 변경한다(전역 토글). */
export function useSetMailAiEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aiEnabled: boolean) => setMailAiEnabled(aiEnabled),
    onSuccess: (_data, aiEnabled) => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success(aiEnabled ? '개인 비서를 켰습니다' : '개인 비서를 껐습니다');
    },
    onError: (e) => handleApiError(e, '개인 비서 설정에 실패했습니다'),
  });
}

// 기존 계정 연결 테스트(수정 폼) — 비밀번호 미입력 시 저장된 비밀번호로 폴백(#448).
export function useTestMailConnectionForAccount() {
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MailAccountRequest }) =>
      testMailConnectionForAccount(id, body),
  });
}

/** 알림 범위 저장 뮤테이션 키 — 진행 중인 저장을 계정별로 모아 볼 때 쓴다. */
export const setMailNotifyModeKey = ['mail-accounts', 'notify-mode'] as const;

/** 캐시된 계정 목록에서 한 계정의 알림 범위만 바꾼다 — 낙관적 반영과 실패 되돌리기가 함께 쓴다. */
function patchNotifyMode(qc: QueryClient, id: number, notifyMode: MailNotifyMode) {
  qc.setQueryData<MailAccountResponse[]>(mailAccountKeys.all, (old) =>
    old?.map((a) => (a.id === id ? { ...a, notifyMode } : a)),
  );
}

/**
 * 계정 하나의 새 메일 알림 범위를 바꾼다(WP-1740). 라디오가 즉시 반응하도록 캐시를 먼저 바꾸고(낙관적),
 * 실패하면 그 계정의 이전 값만 되돌리며 토스트로 알린다. 성공 토스트는 없다 — 라디오 선택이 곧 피드백이다.
 */
export function useSetMailNotifyMode() {
  const qc = useQueryClient();
  return useMutation({
    // 계정별 저장 중 여부를 useMutationState 로 읽을 수 있게 하는 키(MailNotifySection 의 라디오 잠금).
    mutationKey: setMailNotifyModeKey,
    mutationFn: ({ id, notifyMode }: { id: number; notifyMode: MailNotifyMode }) =>
      setMailNotifyMode(id, notifyMode),
    onMutate: async ({ id, notifyMode }) => {
      // 진행 중인 목록 조회가 낙관적 값을 덮어쓰지 않게 먼저 취소한다.
      await qc.cancelQueries({ queryKey: mailAccountKeys.all });
      // 되돌릴 값은 이 계정의 이전 알림 범위뿐 — 목록 전체를 되돌리면 동시에 저장 중인 다른 계정의 낙관적 값을 덮는다.
      const previous = qc
        .getQueryData<MailAccountResponse[]>(mailAccountKeys.all)
        ?.find((a) => a.id === id)?.notifyMode;
      patchNotifyMode(qc, id, notifyMode);
      return { previous };
    },
    onError: (e, { id }, ctx) => {
      const prev = ctx?.previous;
      if (prev) patchNotifyMode(qc, id, prev);
      handleApiError(e, '메일 알림 범위를 바꾸지 못했어요');
    },
    // 다시 받기는 마지막 저장이 끝날 때 한 번만 — 겹친 저장 중 먼저 끝난 쪽이 목록을 받아 오면 아직 저장 중인
    // 다른 계정의 낙관적 값을 서버의 옛 값으로 덮어 라디오가 되돌아간다. onSettled 시점에는 이 뮤테이션도 아직
    // pending 으로 세어지므로 1 이면 자기만 남은 것이다.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: setMailNotifyModeKey }) > 1) return;
      return qc.invalidateQueries({ queryKey: mailAccountKeys.all });
    },
  });
}
