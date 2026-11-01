package com.workplace.fileai.outbound;

import com.workplace.fileai.exception.FileAiException;
import com.workplace.global.outbound.AgentOutageGuard;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * api → ai-agent 드라이브 요약 동기 호출(AiAgentMailClient 미러).
 *
 * <p>POST /drive/summarize 로 파일 텍스트를 전송하고 요약문을 받는다. 무재시도(단발 호출). 오류 시 {@link FileAiException} 으로
 * 변환해 FileExtractionPipeline 이 TEXT_READY 로 복귀할 수 있도록 전파한다.
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
      // agent 불가(재기동 중 연결 실패·503)는 호출부(FileExtractionPipeline)가 WARN 한 줄로 남긴다(WP-177). 그 외 응답 오류만
      // ERROR.
      if (!AgentOutageGuard.isAgentDown(e)) {
        log.error("ai-agent 드라이브 요약 실패: {}", e.getMessage());
      }
      throw new FileAiException("파일 요약 AI 요청에 실패했습니다.", e);
    }
  }

  /**
   * HTML 스크립트 요지 보안 점검 요청(WP-1262). POST /drive/security-check — 요지를 보내 위험도·근거를 받는다. 무재시도(단발).
   * 재시도·시도 횟수는 FileSecurityCheckPipeline 이 맡는다.
   *
   * @param req 점검 요청(요지, 파일명, 잘림 여부, 비서 사양)
   * @return 위험도(LOW/CAUTION/HIGH)·한 줄 요약·근거
   */
  public SecurityCheckRes securityCheck(SecurityCheckReq req) {
    try {
      return restClient
          .post()
          .uri("/drive/security-check")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(SecurityCheckRes.class);
    } catch (RestClientException e) {
      // agent 불가는 호출부가 WARN 한 줄로 남긴다(summarize 와 같다). 그 외 응답 오류만 ERROR.
      if (!AgentOutageGuard.isAgentDown(e)) {
        log.error("ai-agent HTML 보안 점검 실패: {}", e.getMessage());
      }
      throw new FileAiException("HTML 보안 점검 AI 요청에 실패했습니다.", e);
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

  /**
   * HTML 보안 점검 요청 페이로드(WP-1262) — ai-agent securityCheckSchema 와 1:1.
   *
   * @param digest 스크립트 요지(ScriptDigest, 비신뢰 데이터)
   * @param fileName 파일명(컨텍스트용)
   * @param truncated 요지가 상한으로 잘렸는지
   * @param assistantAgentId 비서 에이전트 userId
   * @param model 사용할 모델 ID
   * @param maxTurns 최대 turns
   * @param timeoutMs 타임아웃(밀리초)
   */
  public record SecurityCheckReq(
      String digest,
      String fileName,
      boolean truncated,
      long assistantAgentId,
      String model,
      int maxTurns,
      long timeoutMs) {}

  /**
   * HTML 보안 점검 응답 페이로드.
   *
   * @param risk LOW / CAUTION / HIGH
   * @param headline 한 줄 요약(화면 안내 줄·카드 제목에 쓴다)
   * @param evidence 근거 목록
   */
  public record SecurityCheckRes(String risk, String headline, List<Evidence> evidence) {}

  /**
   * 보안 점검 근거 한 건.
   *
   * @param kind EXTERNAL_REQUEST / CREDENTIAL_INPUT / OBFUSCATION / NAVIGATION / OTHER
   * @param detail 사람이 읽는 설명
   */
  public record Evidence(String kind, String detail) {}
}
