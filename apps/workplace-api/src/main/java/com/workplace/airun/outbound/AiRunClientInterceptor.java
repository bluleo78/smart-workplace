package com.workplace.airun.outbound;

import com.workplace.airun.context.AiRunHeader;
import com.workplace.airun.service.AiRunRecorder;
import java.io.IOException;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

/**
 * ai-agent 호출에 X-AI-Run 헤더를 싣고, ai-agent 에 닿기 전 실패·5xx 를 FAILED 로 기록하는 RestClient 인터셉터 (WP-1829).
 *
 * <p>왜: 호출마다 새 runId 를 헤더로 보내면 ai-agent 가 같은 runId 로 보고하고, ai-agent 가 받지 못한 실패는 여기서 같은 runId 로 남겨 한
 * 행으로 합쳐진다. 4xx 는 호출자 잘못이라 기록하지 않고, 어떤 경우에도 호출자가 받는 예외·응답은 바꾸지 않는다.
 */
public class AiRunClientInterceptor implements ClientHttpRequestInterceptor {

  private final AiRunRecorder recorder;

  public AiRunClientInterceptor(AiRunRecorder recorder) {
    this.recorder = recorder;
  }

  @Override
  public ClientHttpResponse intercept(
      HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
    AiRunHeader.Call call = AiRunHeader.begin(request.getURI().getPath());
    request.getHeaders().set(AiRunHeader.NAME, AiRunHeader.encode(call));
    ClientHttpResponse response;
    try {
      response = execution.execute(request, body);
    } catch (IOException e) {
      // 연결 거부·시간 초과 등 — RestClient 가 ResourceAccessException 으로 감싸기 전의 원본 예외를 기록하고 그대로 던진다.
      // 스레드 인터럽트(취소)는 장애가 아니므로 기록하지 않는다.
      if (!AiRunFailures.isInterrupt(e)) {
        AiRunFailures.recordFailure(recorder, call, AiRunFailures.reasonFor(e), e.getMessage());
      }
      throw e;
    }
    try {
      // 사유는 ai-agent 가 같은 runId 로 보고하는 값에 양보한다(AiRunFailures.recordServerError).
      AiRunFailures.recordIfServerError(recorder, call, response.getStatusCode().value());
    } catch (RuntimeException | IOException e) {
      // 상태 읽기 실패는 기록만 포기한다 — 응답은 그대로 돌려준다.
    }
    return response;
  }
}
