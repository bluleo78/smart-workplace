// 드라이브 REST API client. 모든 함수는 AxiosResponse 반환 — 호출처에서 .data unwrap.

import type {
  DriveFile,
  DriveFolder,
  DriveItemList,
  DriveMember,
  DriveSearchResult,
  DriveSpace,
} from '../types/drive'
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

  // 공간 전체 이름 검색
  search: (spaceId: number, q: string) =>
    client.get<DriveSearchResult>(`/drive/spaces/${spaceId}/search`, { params: { q } }),

  // 썸네일 blob → object URL. 메모리 Bearer 라 <img> 가 헤더를 못 실으므로 axios 로 받아 objectURL 생성.
  // 404(썸네일 없음)면 null 반환. 호출처가 revokeObjectURL 책임.
  fetchThumbnailUrl: async (driveFileId: number): Promise<string | null> => {
    try {
      const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/thumbnail`, {
        responseType: 'blob',
      })
      return URL.createObjectURL(data)
    } catch {
      return null
    }
  },

  // 미리보기 콘텐츠(이미지/PDF) blob → object URL. 호출처가 revoke.
  fetchContentUrl: async (driveFileId: number): Promise<string> => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/content`, {
      responseType: 'blob',
    })
    return URL.createObjectURL(data)
  },

  // 텍스트 미리보기 — blob 을 문자열로.
  fetchTextContent: async (driveFileId: number): Promise<string> => {
    const { data } = await client.get<Blob>(`/drive/files/${driveFileId}/content`, {
      responseType: 'blob',
    })
    return await data.text()
  },
}
