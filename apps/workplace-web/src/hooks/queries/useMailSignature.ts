// 메일 서명 쿼리/뮤테이션(WP-1517) — 설정 › 메일 계정 「서명」 카드가 읽고 저장하며, 작성창이 자동 넣기에 읽는다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getMailSignature, updateMailSignature } from '../../api/mailSignature';
import { handleApiError } from '../../lib/api-error';
import type { UpdateMailSignatureRequest } from '../../types/mailSignature';

const mailSignatureKey = ['mail', 'signature'] as const;

/**
 * 내 서명 조회 옵션 — 훅과 미리 받기(usePrefetchMailSignature)가 같은 값을 쓴다.
 * 작성창은 본문을 먼저 그리고 서명이 오면 그때 넣으므로(아직 안 쓴 본문에만) 재시도로 오래 끌지 않는다 — 실패는 펜이 「다시 시도」로 알린다.
 * 서명은 자주 바뀌지 않아 5분 동안은 다시 부르지 않는다(저장하면 캐시를 바로 바꾼다).
 */
const mailSignatureQuery = {
  queryKey: mailSignatureKey,
  queryFn: getMailSignature,
  retry: false,
  staleTime: 5 * 60_000,
} as const;

/** 내 서명. */
export function useMailSignature() {
  return useQuery(mailSignatureQuery);
}

/**
 * 메일 화면에 들어오면 서명을 미리 받아 둔다 — 작성창을 열 때 이미 캐시에 있으면 처음 본문에 서명이 바로 들어가
 * 늦게 끼워 넣는 일(쓰기 시작한 뒤라 못 넣는 경우)이 줄어든다. 실패해도 조용히 넘긴다(작성창이 다시 부른다).
 */
export function usePrefetchMailSignature() {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.prefetchQuery(mailSignatureQuery);
  }, [qc]);
}

/** 서명 저장 — 서버가 정리한 서명 전체를 돌려주므로 재조회 없이 캐시를 그 값으로 바꾼다. 실패는 서버 문구로 알린다. */
export function useUpdateMailSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMailSignatureRequest) => updateMailSignature(body),
    // 진행 중인 재조회를 취소한다 — 저장 전 값으로 늦게 도착한 GET 이 저장 결과를 덮지 않게(알림 설정과 같은 이유).
    onMutate: () => qc.cancelQueries({ queryKey: mailSignatureKey }),
    onSuccess: (data) => qc.setQueryData(mailSignatureKey, data),
    onError: (e) => handleApiError(e, '서명을 저장하지 못했어요'),
  });
}
