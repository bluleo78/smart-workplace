import { useHomeAttachmentBlob } from '@/hooks/useHomeAttachmentBlob';
import { isHomeChatImage } from '@/lib/homeChatAttachments';
import type { TurnAttachment } from '@/types/home';

/**
 * 메인 AI 채팅 말풍선의 이미지 첨부 썸네일(WP-234). 클릭 시 새 탭 원본.
 * 방금 보낸 이미지는 로컬 미리보기(previewUrl)를 그대로 쓴다 — 새 대화는 첫 응답이 끝나기 전엔 세션 id 가 없어
 * 서버 원본을 받을 수 없다. 복원된 이미지는 세션 첨부 원본을 blob 으로 받는다.
 * testid 는 이슈·팀 채팅 썸네일과 같은 attachment-image-{fileId}.
 * 썸네일 4종(isHomeChatImage) 밖이면 원본도 받지 않고 파일명만 보인다 — 목록이 카드로 보내므로 평소엔 오지 않는 방어선이다
 * (SVG 를 앱 출처 blob 새 탭으로 열면 스크립트가 돈다).
 */
export function HomeMessageImage({ sessionId, attachment }: { sessionId: string | null; attachment: TurnAttachment }) {
  const inline = isHomeChatImage(attachment.mimeType);
  // 미리보기가 있거나 4종 밖이면 서버 요청을 하지 않는다(세션 id 를 null 로 넘겨 훅을 멈춘다 — 훅은 조건부로 부를 수 없다).
  const remote = useHomeAttachmentBlob(attachment.previewUrl || !inline ? null : sessionId, attachment.fileId);
  if (!inline) return <span className="text-xs text-muted-foreground">{attachment.originalName}</span>;
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
    // 상한(20rem)은 고정값으로 <a> 에 두고 img 는 그 안에서 100% 로만 줄인다. min(100%,20rem) 을 img 에 두면 감싼 요소의
    // 폭 계산(max-content)에서 퍼센트가 무시돼 래퍼가 원본 비율 폭(예: 384px)으로 잡히고, 오른쪽 정렬 때 썸네일 끝이 말풍선·카드보다 안쪽에서 끝난다.
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit max-w-80">
      <img
        src={url}
        alt={attachment.originalName}
        data-testid={`attachment-image-${attachment.fileId}`}
        // 시안 7: 좁은 모바일 시트에서는 말풍선 폭에 맞춰 줄고(max-w-full), 넓을 땐 부모 <a> 의 20rem 상한(이슈 챗 썸네일과 같음).
        className="max-h-64 block w-auto max-w-full rounded-md border object-contain"
      />
    </a>
  );
}
