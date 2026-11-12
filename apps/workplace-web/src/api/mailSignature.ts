// 메일 서명 REST 호출(WP-1517) — 사용자당 서명 하나를 읽고 저장하고, 보낼 때 서명 이미지의 작성창 업로드 사본을 만든다.
// 서명 이미지 경로(/api/v1/mail/signature/images/{id})는 인증(메모리 Bearer)이 필요해 <img src> 로 바로 그릴 수 없다 —
// 설정 화면은 useApiBlobUrl(blob objectURL), 작성창의 격리 iframe 은 fetchSignatureImageDataUri(data URI)로 그린다.
import type { MailSignature, SignatureImageStaged, UpdateMailSignatureRequest } from '../types/mailSignature';
import { blobToDataUri, fetchBlobByPath } from './blobContent';
import { client } from './client';

/** 내 서명 — 아직 없으면 서버가 빈 서명과 기본 스위치를 돌려준다. */
export async function getMailSignature(): Promise<MailSignature> {
  const { data } = await client.get<MailSignature>('/mail/signature');
  return data;
}

/** 서명 저장 — 서버가 정리한 html 과 가져오지 못해 뺀 이미지 수(droppedImageCount)를 돌려준다. */
export async function updateMailSignature(body: UpdateMailSignatureRequest): Promise<MailSignature> {
  const { data } = await client.put<MailSignature>('/mail/signature', body);
  return data;
}

/**
 * 서명 이미지의 발송용 사본(작성창 업로드)을 만든다 — 서명 이미지는 영구 파일이고 작성창 업로드는 24시간짜리 소비형이라,
 * 보낼 때마다 사본을 만들어 붙여 넣은 이미지(WP-947)와 같은 cid 경로로 보낸다. 하나라도 내 것이 아니면 404.
 */
export async function stageSignatureImages(imageIds: number[]): Promise<SignatureImageStaged[]> {
  const { data } = await client.post<SignatureImageStaged[]>('/mail/signature/images/stage', { imageIds });
  return data;
}

/**
 * 서명 이미지 경로를 data URI 로 받는다 — 작성창 서명 노드뷰의 sandbox iframe 은 불투명 출처라 부모의 blob: URL 을 읽지 못한다
 * (fetchMailAttachmentDataUri 와 같은 이유). 타입은 서버가 저장 MIME(png·jpeg·gif·webp)으로 내려 주는 응답 그대로 쓴다.
 */
export async function fetchSignatureImageDataUri(src: string): Promise<string> {
  return blobToDataUri(await fetchBlobByPath(src));
}
