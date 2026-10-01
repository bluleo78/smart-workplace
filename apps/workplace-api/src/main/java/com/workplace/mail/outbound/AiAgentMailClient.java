package com.workplace.mail.outbound;

import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzeContentResult;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /mail/{analyze-content,analyze-personal,reply-draft,draft-coaching,issue-draft}
 * 동기 호출(7d · WP-149). 무재시도(CLI cold-start 동기). 503 → MailAiUnavailableException(친화 메시지), 그 외 실패 →
 * MailAiException(502). AiAgentComposeClient 미러.
 */
@Slf4j
public class AiAgentMailClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentMailClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** 답장 초안 요청 → 초안 본문. */
  public ReplyDraftResult replyDraft(ReplyDraftRequest req) {
    return post("/mail/reply-draft", req, ReplyDraftResult.class);
  }

  /** 초안 코칭 요청 → 코칭 노트 + 개선본. */
  public DraftCoachingResult coachDraft(DraftCoachingRequest req) {
    return post("/mail/draft-coaching", req, DraftCoachingResult.class);
  }

  /** #520 이슈 초안 요청 → 제목·본문·우선순위·추천 프로젝트. */
  public MailAiMessages.IssueDraftResult issueDraft(MailAiMessages.IssueDraftRequest req) {
    return post("/mail/issue-draft", req, MailAiMessages.IssueDraftResult.class);
  }

  /**
   * ai-agent 에 POST 요청을 전송한다.
   *
   * <p>503 은 MailAiUnavailableException(사용자 친화 메시지), 그 외 HTTP 오류·IO 오류는 MailAiException 으로 변환.
   */
  private <T> T post(String uri, Object body, Class<T> type) {
    try {
      return restClient
          .post()
          .uri(uri)
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(body)
          .retrieve()
          .body(type);
    } catch (HttpStatusCodeException e) {
      String b = e.getResponseBodyAsString();
      if (e.getStatusCode().value() == 503) {
        log.warn("ai-agent mail 미설정/불가: {}", b); // 재기동 중에도 난다 — 배치가 연속 횟수로 판단(WP-166)
        throw new MailAiUnavailableException("AI 비서를 사용할 수 없어요. 잠시 후 다시 시도해주세요.");
      }
      log.error("ai-agent mail 실패: status={} body={}", e.getStatusCode(), b);
      throw new MailAiException("AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    } catch (RestClientException e) {
      // 연결·읽기 실패는 ai-agent 재기동 중에도 난다 — 배치 호출부가 연속 횟수로 판단하므로 WARN(WP-166)
      log.warn("ai-agent mail 실패: {}", e.getMessage());
      throw new MailAiException("AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    }
  }

  /** WP-149 ③ 원본 분석 → 분류·객관 요약(요청한 항목만). */
  public AnalyzeContentResult analyzeContent(AnalyzeContentRequest req) {
    return post("/mail/analyze-content", req, AnalyzeContentResult.class);
  }

  /** WP-149 ④ 개인 분석 → 회신필요 원판정·개인 요약·보조 분류(요청한 항목만). */
  public AnalyzePersonalResult analyzePersonal(AnalyzePersonalRequest req) {
    return post("/mail/analyze-personal", req, AnalyzePersonalResult.class);
  }
}
