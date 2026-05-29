// chat REST API client.
// 모든 함수는 axios envelope(AxiosResponse) 반환 — 호출처(query 훅)에서 .data unwrap.

import { client } from './client';
import type {
  AddChatMemberRequest,
  ChatMemberResponse,
  ChatMessagePage,
  ChatMessageResponse,
  ChatThreadResponse,
  CreateChatMessageRequest,
  MarkChatReadRequest,
  UpdateChatMessageRequest,
} from '../types/chat';

export const chatApi = {
  // 이슈에 묶인 thread getter — 백엔드가 lazy create.
  getThread: (projectKey: string, issueNumber: number) =>
    client.get<ChatThreadResponse>(
      `/projects/${projectKey}/issues/${issueNumber}/chat/thread`,
    ),

  // cursor 페이징 — cursor 없으면 최신부터 50건.
  getMessages: (threadId: number, cursor?: string, limit: number = 50) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return client.get<ChatMessagePage>(
      `/chat/threads/${threadId}/messages?${params.toString()}`,
    );
  },

  createMessage: (threadId: number, payload: CreateChatMessageRequest) =>
    client.post<ChatMessageResponse>(
      `/chat/threads/${threadId}/messages`,
      payload,
    ),

  updateMessage: (messageId: number, payload: UpdateChatMessageRequest) =>
    client.patch<ChatMessageResponse>(
      `/chat/messages/${messageId}`,
      payload,
    ),

  deleteMessage: (messageId: number) =>
    client.delete<void>(`/chat/messages/${messageId}`),

  markRead: (threadId: number, payload: MarkChatReadRequest) =>
    client.post<void>(`/chat/threads/${threadId}/read`, payload),

  addMember: (threadId: number, payload: AddChatMemberRequest) =>
    client.post<ChatMemberResponse>(
      `/chat/threads/${threadId}/members`,
      payload,
    ),
};
