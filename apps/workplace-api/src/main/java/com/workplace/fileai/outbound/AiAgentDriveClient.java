package com.workplace.fileai.outbound;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * api → ai-agent 드라이브 요약 동기 호출(AiAgentMailClient 미러).
 *
 * <p>POST /drive/summarize 로 파일 텍스트를 전송하고 요약문을 받는다. 무재시도(단발 호출). 오류 시 RuntimeException 으로 변환해
 * FileExtractionPipeline 이 TEXT_READY 로 복귀할 수 있도록 전파한다.
 */
@Slf4j
public class AiAgentDriveClient {

  private final RestClient restClient;
  private final String internalToken;

  /** RestClient 와 내부 토큰을 주입받는다. */
  public AiAgentDriveClient(RestClient restClient, String internalToken) {
    this.restClient = restClient;
    this.internalToken = internalToken;
  }

  /**
   * 파일 텍스트 요약 요청.
   *
   * @param req 요약 요청(텍스트, 파일명, MIME, 비서 사양)
   * @return 요약문
   */
  public Res summarize(Req req) {
    try {
      return restClient
          .post()
          .uri("/drive/summarize")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(Res.class);
    } catch (RestClientException e) {
      log.error("ai-agent 드라이브 요약 실패: {}", e.getMessage());
      throw new RuntimeException("파일 요약 AI 요청에 실패했습니다.", e);
    }
  }

  /**
   * 드라이브 요약 요청 페이로드.
   *
   * @param text 추출된 텍스트
   * @param fileName 파일명 (컨텍스트용)
   * @param mime MIME 타입
   * @param assistantAgentId 비서 에이전트 userId
   * @param model 사용할 모델 ID
   * @param maxTurns 최대 turns
   * @param timeoutMs 타임아웃(밀리초)
   */
  public record Req(
      String text,
      String fileName,
      String mime,
      long assistantAgentId,
      String model,
      int maxTurns,
      long timeoutMs) {}

  /** 드라이브 요약 응답 페이로드. */
  public record Res(String summary) {}
}
