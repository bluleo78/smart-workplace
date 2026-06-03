// 드라이브 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type { DriveFile, DriveFolder, DriveItemList, DriveMember, DriveSpace } from '../types/drive'
import { client } from './client'

export const driveApi = {
  listSpaces: () => client.get<DriveSpace[]>('/drive/spaces'),

  createSpace: (name: string) => client.post<DriveSpace>('/drive/spaces', { name }),

  getSpace: (spaceId: number) => client.get<DriveSpace>(`/drive/spaces/${spaceId}`),

  listMembers: (spaceId: number) =>
    client.get<DriveMember[]>(`/drive/spaces/${spaceId}/members`),

  listItems: (spaceId: number, parentId: number | null) =>
    client.get<DriveItemList>(`/drive/spaces/${spaceId}/items`, {
      params: parentId == null ? {} : { parentId },
    }),

  createFolder: (spaceId: number, parentId: number | null, name: string) =>
    client.post<DriveFolder>(`/drive/spaces/${spaceId}/folders`, { parentId, name }),

  renameFolder: (folderId: number, name: string) =>
    client.patch<DriveFolder>(`/drive/folders/${folderId}`, { name }),

  deleteFolder: (folderId: number) => client.delete<void>(`/drive/folders/${folderId}`),

  uploadFile: (spaceId: number, folderId: number | null, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId != null) fd.append('folderId', String(folderId))
    return client.post<DriveFile>(`/drive/spaces/${spaceId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  deleteFile: (driveFileId: number) => client.delete<void>(`/drive/files/${driveFileId}`),

  moveFile: (driveFileId: number, targetFolderId: number | null) =>
    client.patch<void>(`/drive/files/${driveFileId}/move`, { targetFolderId }),

  copyFile: (driveFileId: number, targetFolderId: number | null) =>
    client.post<DriveFile>(`/drive/files/${driveFileId}/copy`, { targetFolderId }),

  moveFolder: (folderId: number, targetParentId: number | null) =>
    client.patch<void>(`/drive/folders/${folderId}/move`, { targetParentId }),

  copyFolder: (folderId: number, targetParentId: number | null) =>
    client.post<DriveFolder>(`/drive/folders/${folderId}/copy`, { targetParentId }),

  // blob 다운로드 → a[download] 트리거
  downloadFile: async (driveFileId: number, fileName: string) => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/download`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
