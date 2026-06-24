package com.workplace.mail.outbound;

import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.outbound.MailAiMessages.ClassifyRequest;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingRequest;
import com.workplace.mail.outbound.MailAiMessages.DraftCoachingResult;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftRequest;
import com.workplace.mail.outbound.MailAiMessages.ReplyDraftResult;
import com.workplace.mail.outbound.MailAiMessages.SummarizeRequest;
import com.workplace.mail.outbound.MailAiMessages.SummarizeResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /mail/{classify,summarize,reply-draft} 동기 호출(7d). 무재시도(CLI cold-start 동기). 503 →
 * MailAiUnavailableException(친화 메시지), 그 외 실패 → MailAiException(502). AiAgentComposeClient 미러.
 */
@Slf4j
public class AiAgentMailClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentMailClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** 메일 분류 요청 → 카테고리·답장필요 여부. */
  public ClassifyResult classify(ClassifyRequest req) {
    return post("/mail/classify", req, ClassifyResult.class);
  }

  /** 메일 요약 요청 → 요약문. */
  public SummarizeResult summarize(SummarizeRequest req) {
    return post("/mail/summarize", req, SummarizeResult.class);
  }

  /** 답장 초안 요청 → 초안 본문. */
  public ReplyDraftResult replyDraft(ReplyDraftRequest req) {
    return post("/mail/reply-draft", req, ReplyDraftResult.class);
  }

  /** 초안 코칭 요청 → 코칭 노트 + 개선본. */
  public DraftCoachingResult coachDraft(DraftCoachingRequest req) {
    return post("/mail/draft-coaching", req, DraftCoachingResult.class);
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
        log.error("ai-agent mail 미설정/불가: {}", b);
        throw new MailAiUnavailableException("AI 비서를 사용할 수 없어요. 잠시 후 다시 시도해주세요.");
      }
      log.error("ai-agent mail 실패: status={} body={}", e.getStatusCode(), b);
      throw new MailAiException("AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent mail 실패: {}", e.getMessage());
      throw new MailAiException("AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    }
  }
}
