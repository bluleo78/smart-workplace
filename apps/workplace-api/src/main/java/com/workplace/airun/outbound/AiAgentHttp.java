package com.workplace.airun.outbound;

import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * ai-agent 호출용 RestClient 빌더 공장 (WP-1829).
 *
 * <p>왜: {@link InternalHttp#restClient} 에 X-AI-Run 인터셉터를 얹은 빌더를 한 곳에서 만들어, 각 설정이 같은 방식으로 헤더·실패 기록을
 * 얻게 한다.
 */
@Component
public class AiAgentHttp {

  private final AiRunClientInterceptor interceptor;

  public AiAgentHttp(AiRunRecorder recorder) {
    this.interceptor = new AiRunClientInterceptor(recorder);
  }

  /** HTTP/1.1 고정 빌더 + X-AI-Run 인터셉터. */
  public RestClient.Builder restClient(String baseUrl, Duration connect, Duration read) {
    // 인터셉터가 있으면 RestClient 가 요청 본문을 통째로 버퍼링한다 — 큰 본문(메일 분석 등)이 메모리에 복제되지 않게 끈다.
    return InternalHttp.restClient(baseUrl, connect, read)
        .bufferContent((uri, method) -> false)
        .requestInterceptor(interceptor);
  }
}
