import { client } from './client';

export interface UploadedFile {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  // 서버 FileUploadService 범주 — VIDEO 는 WP-1519.
  fileCategory: 'IMAGE' | 'PDF' | 'TEXT' | 'DATA' | 'DOCUMENT' | 'VIDEO' | 'OTHER';
  createdAt: string;
}

export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const { data } = await client.post('/files', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
