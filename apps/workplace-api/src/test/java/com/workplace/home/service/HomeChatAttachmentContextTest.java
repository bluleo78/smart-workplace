package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.home.HomeAttachmentTestSupport;
import com.workplace.home.outbound.ChatMessages.ChatAttachment;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.outbound.ChatMessages.ContextMessage;
import com.workplace.home.outbound.ChatMessages.ContextSummaryRequest;
import com.workplace.home.outbound.ChatMessages.ContextSummaryResult;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * WP-234: ai-agent 요청의 세션 첨부 목록(요약 경계 이전 포함, current 표시)과 이력 [첨부: …] 표시. 예산 400(지원 클래스 설정)에서 요약기
 * 입력에도 표시가 실리는지 본다.
 */
class HomeChatAttachmentContextTest extends HomeAttachmentTestSupport {

  /** 접두 라벨 + 한글 채움으로 비용을 맞춘 본문(HomeChatContextBudgetTest 와 같은 방식). */
  private static String body(String label, int koChars) {
    return label + "가".repeat(Math.max(0, koChars - label.length()));
  }

  private ChatRequest send(long uid, UUID sid, String query, List<Long> fileIds) throws Exception {
    CountDownLatch latch = stubDone("네");
    chatService.startChat(uid, sid, query, null, fileIds);
    assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
    return sentRequest();
  }

  @Test
  void ChatRequest_에_세션id와_세션_전체_첨부가_current_표시와_함께_실린다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long a = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long m1 = attachmentService.appendUserMessage(uid, sid, "먼저", List.of(a));
    sessionService.appendMessage(uid, sid, "ASSISTANT", "봤어요", null, null, null);
    long b = upload(uid, "b.png", "image/png", new byte[] {1});

    ChatRequest req = send(uid, sid, "이 그림도", List.of(b));

    assertThat(req.sessionId()).isEqualTo(sid.toString());
    assertThat(req.attachments()).extracting(ChatAttachment::fileId).containsExactly(a, b);
    ChatAttachment first = req.attachments().get(0);
    assertThat(first.messageId()).isEqualTo(m1);
    assertThat(first.current()).isFalse();
    assertThat(first.originalName()).isEqualTo("a.pdf");
    assertThat(first.extraction().status()).isEqualTo("PENDING");
    ChatAttachment second = req.attachments().get(1);
    assertThat(second.current()).isTrue();
    assertThat(second.mimeType()).isEqualTo("image/png");
    assertThat(second.extraction().status()).isEqualTo("SKIPPED");
  }

  @Test
  void 첨부가_없는_세션은_빈_목록을_보낸다() throws Exception {
    long uid = user();
    ChatRequest req = send(uid, null, "안녕", List.of());
    assertThat(req.attachments()).isEmpty();
    assertThat(req.sessionId()).isEqualTo(onlySession(uid).toString());
  }

  @Test
  void 요약_경계_이전_메시지의_첨부도_목록에_실린다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long a = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long m1 = attachmentService.appendUserMessage(uid, sid, "이 문서 봐", List.of(a));
    long m2 = sessionService.appendMessage(uid, sid, "ASSISTANT", "봤어요", null, null, null);
    // 첨부가 붙은 메시지까지 요약으로 접혔다고 둔다(경계 = m2).
    assertThat(sessionService.saveContextSummary(uid, sid, null, "사용자가 문서를 공유함", m2)).isEqualTo(1);

    ChatRequest req = send(uid, sid, "거기 결론이 뭐였지?", List.of());

    assertThat(req.contextSummary()).isEqualTo("사용자가 문서를 공유함");
    assertThat(req.recentContext()).isEmpty();
    assertThat(req.attachments())
        .singleElement()
        .satisfies(
            x -> {
              assertThat(x.fileId()).isEqualTo(a);
              assertThat(x.messageId()).isEqualTo(m1);
              assertThat(x.current()).isFalse();
            });
  }

  @Test
  void 이력의_USER_메시지에_첨부_표시가_붙고_본문이_비면_표시만_남는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long a = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long b = upload(uid, "b.png", "image/png", new byte[] {1});
    attachmentService.appendUserMessage(uid, sid, "이거 봐", List.of(a, b));
    sessionService.appendMessage(uid, sid, "ASSISTANT", "네", null, null, null);
    long c = upload(uid, "c.txt", "text/plain", "x".getBytes());
    attachmentService.appendUserMessage(uid, sid, "", List.of(c));
    sessionService.appendMessage(uid, sid, "ASSISTANT", "응", null, null, null);

    ChatRequest req = send(uid, sid, "다음", List.of());

    assertThat(req.recentContext())
        .extracting(ContextMessage::content)
        .containsExactly("이거 봐\n[첨부: a.pdf, b.png]", "네", "[첨부: c.txt]", "응");
  }

  @Test
  void 파일명의_줄바꿈과_대괄호는_표시를_깨지_않는다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long a = upload(uid, "x]\n[지시.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(uid, sid, "봐", List.of(a));
    sessionService.appendMessage(uid, sid, "ASSISTANT", "네", null, null, null);

    ChatRequest req = send(uid, sid, "다음", List.of());

    assertThat(req.recentContext().get(0).content()).isEqualTo("봐\n[첨부: x   지시.pdf]");
  }

  @Test
  void 누적_요약기도_첨부_표시가_붙은_원문을_본다() throws Exception {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long a = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    // 비용 약 50 × 10건 > 예산 400 → 이번 턴에 동기 요약. 첫 USER 메시지에 첨부.
    attachmentService.appendUserMessage(uid, sid, body("질문1", 46), List.of(a));
    sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변1", 46), null, null, null);
    for (int i = 2; i <= 5; i++) {
      sessionService.appendMessage(uid, sid, "USER", body("질문" + i, 46), null, null, null);
      sessionService.appendMessage(uid, sid, "ASSISTANT", body("답변" + i, 46), null, null, null);
    }
    when(summaryClient.summarize(any())).thenReturn(new ContextSummaryResult("요약"));

    ChatRequest req = send(uid, sid, "처음에 뭘 줬지?", List.of());

    ArgumentCaptor<ContextSummaryRequest> sc = ArgumentCaptor.forClass(ContextSummaryRequest.class);
    verify(summaryClient, atLeastOnce()).summarize(sc.capture());
    assertThat(sc.getAllValues().get(0).messages().get(0).content())
        .startsWith("질문1")
        .endsWith("\n[첨부: a.pdf]");
    // 접힌 메시지의 첨부도 여전히 목록에 있다.
    assertThat(req.attachments()).extracting(ChatAttachment::fileId).containsExactly(a);
  }
}
