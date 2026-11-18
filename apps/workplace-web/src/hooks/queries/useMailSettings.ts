// 메일 사용자 설정 쿼리/뮤테이션(WP-1744) — 설정 › 메일 계정 「작성 방식」 카드가 읽고 저장하며, 작성 상태 공급자(MailComposeProvider)가
// 새 작성을 어디서 열지(작성 방식 기본값) 정하려고 읽는다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMailSettings, updateMailSettings } from '../../api/mailSettings';
import { handleApiError } from '../../lib/api-error';
import type { MailUserSettings } from '../../types/mailSettings';

/** 메일 설정 캐시 키 — 작성 상태 공급자가 클릭 처리 중 이 캐시를 바로 읽고(getQueryData), 테스트도 이 키로 본다. */
export const mailSettingsKey = ['mail', 'settings'] as const;

/** 설정 저장 뮤테이션 키 — 진행 중인 저장이 마지막 하나일 때만 캐시를 서버 응답으로 맞추려고 센다(isMutating). */
const UPDATE_MAIL_SETTINGS_KEY = ['mail', 'settings', 'update'] as const;

/**
 * 내 메일 설정. 작성 상태 공급자는 앱 셸에서 늘 부르지만 작성창 열기는 이 조회를 기다리지 않는다
 * (못 받았거나 실패하면 우측 하단으로 연다). 자주 바뀌지 않아 5분 동안은 다시 부르지 않는다(저장하면 캐시를 바로 바꾼다).
 */
export function useMailSettings({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: mailSettingsKey, queryFn: getMailSettings, staleTime: 5 * 60_000, enabled });
}

/**
 * 메일 설정 저장 — 고르는 즉시 저장하므로 낙관적으로 캐시를 먼저 바꾸고, 실패하면 서버 문구로 알린다(프로젝트 즐겨찾기와 같은 모양).
 * 빠르게 여러 번 고르면 요청이 엇갈려 앞 요청의 늦은 응답이 나중 선택을 덮지 않게 같은 scope 로 차례로 보낸다(TanStack Query v5).
 * - 실패: 남은 낙관 값이 없게 서버 값을 다시 받는다(뒤 선택이 있으면 그 선택이 끝날 때 다시 맞춘다).
 * - 성공: 진행 중인 저장이 이것 하나일 때만 캐시를 응답으로 맞춘다 — 앞 저장의 응답이 뒤 선택의 낙관 값을 되돌리지 않게.
 */
export function useUpdateMailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_MAIL_SETTINGS_KEY,
    scope: { id: 'mail-settings' },
    mutationFn: (body: MailUserSettings) => updateMailSettings(body),
    onMutate: async (body) => {
      // 진행 중인 재조회를 취소한다 — 저장 전 값으로 늦게 도착한 GET 이 고른 값을 덮지 않게.
      await qc.cancelQueries({ queryKey: mailSettingsKey });
      qc.setQueryData<MailUserSettings>(mailSettingsKey, body);
    },
    onError: (e) => {
      handleApiError(e, '작성 방식을 저장하지 못했어요');
      return qc.invalidateQueries({ queryKey: mailSettingsKey });
    },
    onSettled: (data, err) => {
      if (!err && data && qc.isMutating({ mutationKey: UPDATE_MAIL_SETTINGS_KEY }) === 1) qc.setQueryData(mailSettingsKey, data);
    },
  });
}
