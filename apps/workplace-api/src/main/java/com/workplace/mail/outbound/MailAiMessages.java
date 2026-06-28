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

  /** 초안 코칭 노트 1건(ai-agent 와이어). */
  public record CoachingNoteWire(String dimension, String message) {}

  /** 초안 코칭 요청: 초안 평문 + (답장이면) 원문 스레드. 새 메일이면 thread 빈 리스트. */
  public record DraftCoachingRequest(
      String draftBody,
      List<ThreadMessage> thread,
      String replyingAs,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  /** 초안 코칭 결과: 코칭 노트 목록 + 다듬은 개선본 HTML. */
  public record DraftCoachingResult(List<CoachingNoteWire> notes, String improvedBodyHtml) {}

  /** #520 이슈 초안 요청. candidateProjects 로 AI 가 projectKey 를 고른다. */
  public record IssueDraftRequest(
      String subject,
      String body,
      java.util.List<CandidateProject> candidateProjects,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  /** 후보 프로젝트(key+name) — ai-agent 전송용. */
  public record CandidateProject(String key, String name) {}

  /** #520 이슈 초안 응답. suggestedProjectKey 는 후보 중 하나 또는 null. */
  public record IssueDraftResult(String title, String body, String priority, String projectKey) {}
}
