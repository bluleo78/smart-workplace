package com.workplace.mail.outbound;

import java.util.List;

/** ai-agent /mail/* 요청·응답 계약. assistant 설정(agentId/model/maxTurns/timeoutMs)은 요청 본문으로 전달. */
public final class MailAiMessages {
  private MailAiMessages() {}

  /** 분류 요청 — 제목/보낸사람/미리보기만(본문 미전송). */
  public record ClassifyRequest(
      String subject,
      String from,
      String snippet,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  public record ClassifyResult(String category, boolean needsReply) {}

  /** 요약 요청 — 본문 포함. */
  public record SummarizeRequest(
      String subject,
      String from,
      String body,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  public record SummarizeResult(String summary) {}

  /** 스레드 메시지 1건(답장 초안 컨텍스트). */
  public record ThreadMessage(String from, String date, String body) {}

  public record ReplyDraftRequest(
      List<ThreadMessage> thread,
      String replyingAs,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  public record ReplyDraftResult(String draftBody) {}
}
