package com.workplace.home.outbound;

import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.CheckResult;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractRequest;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractResult;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 공용 메모리 검사·추출 동기 호출(WP-386). 6.2 직접 요청의 검사는 짧은 읽기 시간(15초) 클라이언트로, 6.3 배경 추출·검사는 긴
 * 것(40초)으로 부른다. 실패를 빈 결과로 삼키지 않고 MemoryCleanupAiException 으로 던진다 — 검사 실패는 호출부가 "불통과"로, 추출 실패는 그 공간
 * 건너뛰기(또는 에이전트 불가면 세션 미룸)로 다룬다. 요청에 사람이 한 말이 들어가므로 로그에는 요청·응답 본문과 예외 메시지를 싣지 않는다.
 */
@Slf4j
public class AiAgentSharedMemoryClient {

  private static final String FAIL_MESSAGE = "공용 메모리 AI 요청에 실패했어요.";

  private final RestClient quick;
  private final RestClient slow;
  private final String internalToken;

  /**
   * @param quick read 15s 빌더(6.2 동기 검사)
   * @param slow read 40s 빌더(6.3 배경)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentSharedMemoryClient(
      RestClient.Builder quick, RestClient.Builder slow, String internalToken) {
    this.quick = quick.build();
    this.slow = slow.build();
    this.internalToken = internalToken;
  }

  /** 6.2 직접 요청 검사 — 사용자 채팅 턴 안에서 기다리므로 짧은 읽기 시간. */
  public CheckResult checkNow(CheckRequest req) {
    return post(
        quick, "/home/shared-memory-check", req, CheckResult.class, new CheckResult(List.of()));
  }

  /** 6.3 배경 검사. */
  public CheckResult check(CheckRequest req) {
    return post(
        slow, "/home/shared-memory-check", req, CheckResult.class, new CheckResult(List.of()));
  }

  /** 6.3 배경 추출 — ops 가 없으면 빈 목록. */
  public ExtractResult extract(ExtractRequest req) {
    ExtractResult r = post(slow, "/home/shared-memory-extract", req, ExtractResult.class, null);
    return r == null || r.ops() == null ? new ExtractResult(List.of()) : r;
  }

  /** 공통 POST — 실패는 공용 도우미로 번역한다(본문·메시지는 로그에 싣지 않는다). */
  private <T> T post(RestClient client, String path, Object body, Class<T> type, T empty) {
    try {
      T r =
          client
              .post()
              .uri(path)
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(body)
              .retrieve()
              .body(type);
      return r == null ? empty : r;
    } catch (RestClientException e) {
      throw AiAgentCallErrors.translate(log, path, FAIL_MESSAGE, e, false);
    }
  }
}
