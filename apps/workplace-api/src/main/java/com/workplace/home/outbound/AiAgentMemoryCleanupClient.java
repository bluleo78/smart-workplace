package com.workplace.home.outbound;

import com.workplace.home.outbound.MemoryCleanupMessages.Request;
import com.workplace.home.outbound.MemoryCleanupMessages.Result;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent POST /home/memory-cleanup 동기 호출(WP-385) — 배경 정리 예약 작업이 트랜잭션 밖에서 부른다. 추천 질문 클라이언트와 달리 실패를
 * 빈 결과로 삼키지 않고 예외로 던진다: 빈 결과는 "할 일 없음"이라 세션을 처리 완료로 표시하는데, 실패를 그렇게 다루면 정리를 잃는다. Internal 토큰, 무재시도.
 */
@Slf4j
public class AiAgentMemoryCleanupClient {

  private final RestClient restClient;
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(HomeChatConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentMemoryCleanupClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** 정리 ops — ops 가 없으면 빈 목록. 실패는 MemoryCleanupAiException. */
  public Result cleanup(Request req) {
    try {
      Result r =
          restClient
              .post()
              .uri("/home/memory-cleanup")
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(req)
              .retrieve()
              .body(Result.class);
      // ops 가 null 이거나 null·이름 없는 op 는 Result 생성자가 거른다.
      return r == null ? new Result(List.of()) : r;
    } catch (RestClientException e) {
      // 503·404 는 일시 불가(WARN), 그 외 상태는 ERROR — 호출부가 연속 횟수로 판단한다. 번역은 공용 도우미가 맡는다.
      throw AiAgentCallErrors.translate(log, "memory cleanup", "AI 메모리 정리 요청에 실패했어요.", e, true);
    }
  }
}
