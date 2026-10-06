import { useHomeAttachmentBlob } from '@/hooks/useHomeAttachmentBlob';
import type { TurnAttachment } from '@/types/home';

/**
 * 메인 AI 채팅 말풍선의 이미지 첨부 썸네일(WP-234). 클릭 시 새 탭 원본.
 * 방금 보낸 이미지는 로컬 미리보기(previewUrl)를 그대로 쓴다 — 새 대화는 첫 응답이 끝나기 전엔 세션 id 가 없어
 * 서버 원본을 받을 수 없다. 복원된 이미지는 세션 첨부 원본을 blob 으로 받는다.
 * testid 는 이슈·팀 채팅 썸네일과 같은 attachment-image-{fileId}.
 */
export function HomeMessageImage({ sessionId, attachment }: { sessionId: string | null; attachment: TurnAttachment }) {
  // 미리보기가 있으면 서버 요청을 하지 않는다(세션 id 를 null 로 넘겨 훅을 멈춘다).
  const remote = useHomeAttachmentBlob(attachment.previewUrl ? null : sessionId, attachment.fileId);
  const url = attachment.previewUrl ?? remote.url;
  if (remote.error) return <span className="text-xs text-muted-foreground">이미지를 불러올 수 없습니다</span>;
  if (!url) {
    // 미리보기도 세션도 없으면(드묾) 끝나지 않는 로딩 대신 파일명만 보인다.
    if (!sessionId) return <span className="text-xs text-muted-foreground">{attachment.originalName}</span>;
    return (
      <div
        className="h-32 w-32 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
        data-testid={`attachment-image-loading-${attachment.fileId}`}
      />
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt={attachment.originalName}
        data-testid={`attachment-image-${attachment.fileId}`}
        // 시안 7: 좁은 모바일 시트에서는 말풍선 폭에 맞춰 줄고(max-w-full), 넓을 땐 이슈 챗 썸네일과 같은 20rem 상한.
        className="max-h-64 w-auto max-w-[min(100%,20rem)] rounded-md border object-contain"
      />
    </a>
  );
}
