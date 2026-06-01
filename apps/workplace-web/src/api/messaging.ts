// messaging REST API client. 모든 함수는 AxiosResponse 반환 — 호출처(query 훅)에서 .data unwrap.

import type {
  ChannelResponse,
  CreateChannelRequest,
  CreateMessageRequest,
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
};
