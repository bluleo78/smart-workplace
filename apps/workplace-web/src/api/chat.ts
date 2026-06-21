// chat REST API client.
// 모든 함수는 axios envelope(AxiosResponse) 반환 — 호출처(query 훅)에서 .data unwrap.

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
import { client } from './client';

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

  // 타이핑 알림 — DB 변경 없음, 204. thread 멤버에게 SSE typing 이벤트 fan-out 트리거.
  sendTyping: (threadId: number) =>
    client.post<void>(`/chat/threads/${threadId}/typing`),

  addMember: (threadId: number, payload: AddChatMemberRequest) =>
    client.post<ChatMemberResponse>(
      `/chat/threads/${threadId}/members`,
      payload,
    ),

  // #358: 첨부 사전 업로드 — multipart/form-data, 필드명 `files`.
  uploadAttachments: (threadId: number, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return client.post<
      { fileId: number; originalName: string; mimeType: string; sizeBytes: number }[]
    >(`/chat/threads/${threadId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // #358: 첨부 다운로드 — blob → a[download].
  downloadAttachment: async (
    threadId: number,
    messageId: number,
    fileId: number,
    fileName: string,
  ) => {
    const { data } = await client.get<Blob>(
      `/chat/threads/${threadId}/messages/${messageId}/attachments/${fileId}/content`,
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

  // #358: 인라인 이미지 썸네일용 blob fetch.
  fetchAttachmentBlob: (threadId: number, messageId: number, fileId: number) =>
    client
      .get<Blob>(
        `/chat/threads/${threadId}/messages/${messageId}/attachments/${fileId}/content`,
        { responseType: 'blob' },
      )
      .then((r) => r.data),
};
