package com.workplace.messaging.outbound;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.service.LinkPreviewService;
import com.workplace.messaging.service.LinkUrlExtractor;
import java.util.List;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

/**
 * 메시지 생성·수정 커밋 뒤 링크 미리보기 가져오기를 linkPreviewExecutor 에 넘긴다(WP-874). 사람·AI(AGENT)·제안 카드 등
 * MessageCreatedEvent·MessageUpdatedEvent 를 내는 모든 작성 경로가 대상이다.
 *
 * <p>이벤트 리스너가 아니라 {@link MessageSseDispatcher} 가 커밋 뒤 콜백 안에서 created/updated SSE 를 보낸 <b>바로 다음</b>에
 * 부른다 — 그래야 한 SSE 스트림에서 {@code messaging.message.created}(또는 updated)가 늘 {@code
 * messaging.message.link-previews} 보다 먼저 나간다(별도 리스너면 두 커밋 뒤 작업의 순서가 보장되지 않아 미리보기가 메시지보다 먼저 도착할 수
 * 있었다). 실행기의 TenantContextTaskDecorator 가 제출 시점(요청 스레드)의 테넌트를 워커로 복원한다.
 */
@Slf4j
@Component
public class LinkPreviewDispatcher {

  private final LinkPreviewService service;
  private final Executor executor;

  public LinkPreviewDispatcher(
      LinkPreviewService service, @Qualifier("linkPreviewExecutor") Executor executor) {
    this.service = service;
    this.executor = executor;
  }

  /** 새 메시지 — 본문에 URL 이 없으면 제출하지 않는다(만들 것도, 지울 것도 없다). */
  void afterCreated(long messageId, String body) {
    List<String> urls = LinkUrlExtractor.extract(body);
    if (!urls.isEmpty()) submit(messageId, body, urls);
  }

  /** 본문 수정 — URL 이 빠졌으면 기존 미리보기를 지워야 하므로 늘 제출한다. */
  void afterUpdated(long messageId, String body) {
    submit(messageId, body, LinkUrlExtractor.extract(body));
  }

  /** 테넌트가 없으면(전파 실패) RLS 가 막으므로 건너뛰고 남긴다. 미리보기는 best-effort — 실패는 로그만. */
  private void submit(long messageId, String body, List<String> urls) {
    if (TenantContext.get() == null) {
      log.warn("[link-preview] 테넌트 컨텍스트 없음 — 건너뜀 messageId={}", messageId);
      return;
    }
    executor.execute(
        () -> {
          try {
            service.refresh(messageId, body, urls);
          } catch (Exception ex) {
            log.warn("[link-preview] 미리보기 갱신 실패 messageId={}: {}", messageId, ex.getMessage());
          }
        });
  }
}
