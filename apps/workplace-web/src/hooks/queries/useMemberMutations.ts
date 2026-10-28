// 멤버 단위 mutation 모음. 성공 시 멤버 목록·멤버 부서·채널 상세(memberCount) 무효화.
// WP-1058 — 비공개 채널은 조직도 부서도 멤버로 둔다(부서 추가·제거). 사람을 내보내면 그 사람이 부서 대상에서도 빠져 부서 인원 수가 바뀌므로
// 사람 쪽 변경도 부서 목록을 함께 다시 받는다 — 부서 목록 키가 멤버 키 아래라 멤버 무효화 하나로 덮는다.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { messagingApi } from '../../api/messaging';
import { addMembersFromGroup, type GroupMembersAddResult } from '../../components/members/personalGroups';
import { handleApiError } from '../../lib/api-error';
import type { ChannelMemberGroup, ChannelRole } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

/** 멤버 변경 뒤 공통 무효화 — 멤버 목록(실효 멤버)과 그 아래 멤버 부서(인원 수)·채널 상세(memberCount). */
// 재조회 promise 를 돌려줘, 필요한 곳(역할 변경)은 목록이 다시 올 때까지 pending 을 유지할 수 있다(WP-1131).
function invalidateMembership(qc: ReturnType<typeof useQueryClient>, channelId: number) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: messagingKeys.members(channelId) }),
    qc.invalidateQueries({ queryKey: messagingKeys.detail(channelId) }),
  ]);
}

export function useAddMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => messagingApi.addMember(channelId, userId).then((r) => r.data),
    onSuccess: () => invalidateMembership(qc, channelId),
    onError: (err) => handleApiError(err, '멤버 추가에 실패했습니다'),
  });
}

export function useRemoveMember(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (userId) =>
      messagingApi.removeMember(channelId, userId).then((r) => r.data),
    onSuccess: () => {
      invalidateMembership(qc, channelId);
      toast.success('멤버를 제거했습니다');
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했습니다'),
  });
}

// 역할 변경(OWNER 만). role:OWNER 지정 시 서버가 본인을 ADMIN 으로 강등(소유권 이전).
// 부서로만 들어온 사람(direct=false)을 관리자로 올리면 서버가 직접 멤버 행으로 남긴다(WP-1058) — 부서 인원 표시도 다시 받는다.
export function useUpdateMemberRole(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, { userId: number; role: ChannelRole }>({
    mutationFn: ({ userId, role }) =>
      messagingApi.updateMemberRole(channelId, userId, role).then((r) => r.data),
    // 재조회 promise 를 돌려줘 목록·내 역할이 다시 올 때까지 pending 을 유지한다 — 소유권을 넘긴 직후 낡은 내 역할(OWNER)로
    // 역할 select 가 다시 풀려 또 넘기다 403 을 받지 않게(WP-1131).
    onSuccess: () => invalidateMembership(qc, channelId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  });
}

/** 조직도 부서를 비공개 채널 멤버로 더한다(WP-1058) — 본문은 { groupId } 만(채널 부서에는 역할이 없다). 성공 안내는 화면이 한다. */
export function useAddMemberGroup(channelId: number) {
  const qc = useQueryClient();
  return useMutation<ChannelMemberGroup, unknown, number>({
    mutationFn: (groupId) => messagingApi.addMemberGroup(channelId, groupId).then((r) => r.data),
    onSuccess: () => invalidateMembership(qc, channelId),
    onError: (err) => handleApiError(err, '조직 추가에 실패했습니다'),
  });
}

/** 멤버 부서를 뺀다(WP-1058) — 그 부서로만 들어와 있던 사람은 채널에서 빠진다(직접 멤버는 남는다). */
export function useRemoveMemberGroup(channelId: number) {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: (groupId) => messagingApi.removeMemberGroup(channelId, groupId).then((r) => r.data),
    onSuccess: () => {
      invalidateMembership(qc, channelId);
      toast.success('조직을 제거했습니다');
    },
    onError: (err) => handleApiError(err, '조직 제거에 실패했습니다'),
  });
}

/**
 * 내 그룹 구성원을 사람 멤버로 한 명씩 초대한다(WP-1058, 드라이브 useAddDriveMembersFromGroup 과 같은 공용 흐름 addMembersFromGroup) — 그룹 자체는 서버에 보내지 않는다.
 * 화면 캐시가 아니라 방금 받은 멤버 목록의 직접 멤버로 걸러, 이미 직접 멤버인 사람에게 다시 초대를 보내지 않는다. 부서로만 들어온 사람(direct=false)은
 * 초대한다 — 서버가 직접 멤버로 고정해(역할·읽음 위치 유지) 부서가 빠져도 남는다.
 * 사람마다 실패 토스트가 뜨지 않게 mutation 대신 API 를 바로 부르고, 끝에 한 번만 무효화한다. 더한·뺀·실패한 수를 돌려준다.
 */
export function useAddChannelMembersFromGroup(channelId: number) {
  const qc = useQueryClient();
  return (memberIds: number[] | Promise<number[]>): Promise<GroupMembersAddResult> =>
    addMembersFromGroup(memberIds, {
      readCurrentIds: () =>
        qc
          .fetchQuery({
            queryKey: messagingKeys.members(channelId),
            queryFn: () => messagingApi.listMembers(channelId).then((r) => r.data),
            staleTime: 0,
          })
          .then((latest) => latest.filter((m) => m.direct).map((m) => m.userId)),
      addOne: (userId) => messagingApi.addMember(channelId, userId),
      invalidate: () => invalidateMembership(qc, channelId),
    });
}
