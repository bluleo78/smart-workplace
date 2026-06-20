// messaging REST API client. 모든 함수는 AxiosResponse 반환 — 호출처(query 훅)에서 .data unwrap.

import type {
  ChannelDriveSpaceResponse,
  ChannelMemberResponse,
  ChannelResponse,
  ChannelRole,
  CreateChannelRequest,
  CreateMessageRequest,
  DmResponse,
  MessagePage,
  MessageResponse,
  ThreadInboxPage,
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

  // 스레드 패널 열기 — 해당 스레드를 최신 답글까지 읽음 표시.
  markThreadRead: (rootId: number) =>
    client.post(`/messaging/messages/${rootId}/thread/read`).then(() => undefined),

  // #65 2단계: 크로스채널 미읽음 스레드 목록(활동순, keyset).
  threadsInbox: (cursor?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<ThreadInboxPage>(`/messaging/threads/inbox?${params.toString()}`);
  },
  // 미읽음 스레드 개수(뱃지).
  threadsInboxUnreadCount: () =>
    client
      .get<{ count: number }>('/messaging/threads/inbox/unread-count')
      .then((r) => r.data.count),

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

  // 첨부 사전 업로드 — multipart/form-data, 필드명 `files`. 응답 fileId 로 메시지 작성 시 연결.
  uploadAttachments: (channelId: number, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return client.post<
      { fileId: number; originalName: string; mimeType: string; sizeBytes: number }[]
    >(`/messaging/channels/${channelId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // 첨부 다운로드 — blob 으로 받아 a[download] 트리거. Bearer 인증이라 직접 href 불가.
  downloadAttachment: async (
    channelId: number,
    messageId: number,
    fileId: number,
    fileName: string,
  ) => {
    const { data } = await client.get<Blob>(
      `/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/content`,
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // #76: 채널 '파일' 탭 — 연동 드라이브 공간 보장 후 spaceId 반환.
  ensureChannelDriveSpace: (channelId: number) =>
    client.post<ChannelDriveSpaceResponse>(`/messaging/channels/${channelId}/drive-space`),

  // 인라인 이미지 썸네일용 blob fetch — objectURL 은 호출처(훅)에서 생성/revoke.
  fetchAttachmentBlob: (channelId: number, messageId: number, fileId: number) =>
    client
      .get<Blob>(
        `/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/content`,
        { responseType: 'blob' },
      )
      .then((r) => r.data),
};
