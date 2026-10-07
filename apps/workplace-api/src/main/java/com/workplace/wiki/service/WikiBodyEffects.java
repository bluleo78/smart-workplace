package com.workplace.wiki.service;

import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiReferenceRepository;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 본문이 바뀐 저장의 후처리 — 기존 낙관적 저장({@link WikiPageService})과 동기화 서버 파생 저장({@link WikiCollabDocService})이
 * 같은 규칙을 쓰도록 한곳에 둔다. 한쪽에만 후처리를 더하면 collab 저장과 기존 저장의 백링크·첨부 수명주기가 어긋난다.
 *
 * <p>호출자 트랜잭션 안에서 부른다 — 백링크 delete+insert 가 본문 저장과 원자적으로 묶이고, SSE 이벤트는 AFTER_COMMIT 으로 나간다.
 */
@Component
@RequiredArgsConstructor
public class WikiBodyEffects {
  private final WikiReferenceRepository references;
  private final WikiReferenceParser refParser;
  private final WikiAttachmentService attachments;
  private final ApplicationEventPublisher publisher;

  /**
   * 본문 저장 직후 — ① 본문에서 page/issue 참조를 추출해 백링크 테이블을 교체(diff-replace, 유저 멘션은 적재 안 함) ② 본문 이미지 첨부를
   * 영구화하고 참조가 빠진 것은 강등(#759) ③ 저장 사실을 스페이스 멤버에게 SSE 로 알린다(#724).
   *
   * <p>강등 = 즉시 삭제가 아니라 만료 재무장이다 — 잘라내기-붙여넣기·undo 중간 상태가 각각 저장되고, 페이지 간 복사도 원본에서 참조가 빠진 것처럼 보인다. 유예
   * 창 안에 참조가 돌아오면 원상 복구되고, 실제 삭제는 FileCleanupService 스윕이 보존 정책을 한 번 더 확인한 뒤 한다.
   *
   * @param actorId SSE 페이로드의 수정자 — null 허용(편집자 없는 파생 저장에서 직전 수정자도 없을 때)
   */
  public void afterBodySaved(long spaceId, long pageId, String title, String body, Long actorId) {
    references.replaceForSource(pageId, refParser.parse(pageId, body));
    attachments.syncReferences(pageId, body);
    publisher.publishEvent(
        new WikiPageUpdatedEvent(spaceId, pageId, title, actorId, Instant.now()));
  }
}
