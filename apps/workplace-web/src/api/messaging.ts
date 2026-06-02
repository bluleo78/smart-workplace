// messaging REST API client. 모든 함수는 AxiosResponse 반환 — 호출처(query 훅)에서 .data unwrap.

import type {
  ChannelMemberResponse,
  ChannelResponse,
  ChannelRole,
  CreateChannelRequest,
  CreateMessageRequest,
  DmResponse,
  MessagePage,
  MessageResponse,
} from '../types/messaging';
import { client } from './client';

export const messagingApi = {
  listChannels: () => client.get<ChannelResponse[]>('/messaging/channels'),

  createChannel: (payload: CreateChannelRequest) =>
    client.post<ChannelResponse>('/messaging/channels', payload),

  joinChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/join`),

  getMessages: (channelId: number, cursor?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<MessagePage>(
      `/messaging/channels/${channelId}/messages?${params.toString()}`,
    );
  },

  createMessage: (channelId: number, payload: CreateMessageRequest) =>
    client.post<MessageResponse>(`/messaging/channels/${channelId}/messages`, payload),

  // 공개 채널 탐색. q 비면 전체 공개 채널.
  discoverChannels: (q?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const qs = params.toString();
    return client.get<ChannelResponse[]>(
      `/messaging/channels/discover${qs ? `?${qs}` : ''}`,
    );
  },

  getChannel: (channelId: number) =>
    client.get<ChannelResponse>(`/messaging/channels/${channelId}`),

  renameChannel: (channelId: number, name: string) =>
    client.patch<ChannelResponse>(`/messaging/channels/${channelId}`, { name }),

  archiveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/archive`),

  unarchiveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/unarchive`),

  deleteChannel: (channelId: number) =>
    client.delete<void>(`/messaging/channels/${channelId}`),

  listMembers: (channelId: number) =>
    client.get<ChannelMemberResponse[]>(`/messaging/channels/${channelId}/members`),

  addMember: (channelId: number, userId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/members`, { userId }),

  removeMember: (channelId: number, userId: number) =>
    client.delete<void>(`/messaging/channels/${channelId}/members/${userId}`),

  leaveChannel: (channelId: number) =>
    client.post<void>(`/messaging/channels/${channelId}/leave`),

  updateMemberRole: (channelId: number, userId: number, role: ChannelRole) =>
    client.patch<void>(`/messaging/channels/${channelId}/members/${userId}`, { role }),

  // DM 목록(참여자·최근시각 포함).
  listDms: () => client.get<DmResponse[]>('/messaging/dms'),

  // DM find-or-create. 기존 멤버셋이면 서버가 같은 DM 반환.
  createDm: (userIds: number[]) =>
    client.post<DmResponse>('/messaging/dms', { userIds }),

  // 메시지 본문 수정.
  updateMessage: (messageId: number, body: string) =>
    client.patch<MessageResponse>(`/messaging/messages/${messageId}`, { body }).then((r) => r.data),

  // 메시지 삭제(soft delete).
  deleteMessage: (messageId: number) =>
    client.delete(`/messaging/messages/${messageId}`).then(() => undefined),

  // 채널 읽음 처리 — uptoMessageId 까지 읽음으로 표시.
  markRead: (channelId: number, uptoMessageId: number) =>
    client.post(`/messaging/channels/${channelId}/read`, { uptoMessageId }).then(() => undefined),

  // 스레드 답글 목록(오래된→최신).
  getReplies: (parentMessageId: number, cursor?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<MessagePage>(
      `/messaging/messages/${parentMessageId}/replies?${params.toString()}`,
    );
  },

  // 리액션 추가.
  addReaction: (messageId: number, emoji: string) =>
    client.post(`/messaging/messages/${messageId}/reactions`, { emoji }).then(() => undefined),

  // 리액션 제거.
  removeReaction: (messageId: number, emoji: string) =>
    client
      .delete(`/messaging/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`)
      .then(() => undefined),
};
