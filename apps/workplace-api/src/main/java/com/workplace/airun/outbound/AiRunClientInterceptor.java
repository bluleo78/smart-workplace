package com.workplace.airun.outbound;

import com.workplace.airun.context.AiRunHeader;
import com.workplace.airun.service.AiRunRecorder;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
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
    int status;
    try {
      status = response.getStatusCode().value();
    } catch (RuntimeException | IOException e) {
      // 상태 읽기 실패는 기록만 포기한다 — 응답은 그대로 돌려준다.
      return response;
    }
    if (status < 500) {
      return response;
    }
    // 5xx 는 본문의 reason(사용 한도 초과 등)을 사유로 남기려 본문을 읽고, 호출자에게는 같은 본문을 다시 주는 응답을 돌려준다(WP-2106).
    // 중간에 읽기가 실패해도 반쯤 소비된 원 응답을 돌려주지 않는다 — 이미 읽은 바이트로 감싼 응답을 주고 사유는 http_<코드> 로 남긴다.
    java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
    try {
      java.io.InputStream in = response.getBody();
      byte[] chunk = new byte[8192];
      int n;
      while ((n = in.read(chunk)) != -1) {
        buf.write(chunk, 0, n);
      }
    } catch (RuntimeException | IOException e) {
      AiRunFailures.recordIfServerError(recorder, call, status);
      return new ReplayedResponse(response, buf.toByteArray());
    }
    byte[] bytes = buf.toByteArray();
    AiRunFailures.recordIfServerError(
        recorder, call, status, new String(bytes, StandardCharsets.UTF_8));
    return new ReplayedResponse(response, bytes);
  }

  /** 본문을 미리 읽어 둔 응답 — 헤더·상태는 원 응답에 위임하고 본문만 읽어 둔 바이트에서 다시 준다. */
  private static final class ReplayedResponse implements ClientHttpResponse {
    private final ClientHttpResponse delegate;
    private final byte[] body;

    ReplayedResponse(ClientHttpResponse delegate, byte[] body) {
      this.delegate = delegate;
      this.body = body;
    }

    @Override
    public HttpStatusCode getStatusCode() throws IOException {
      return delegate.getStatusCode();
    }

    @Override
    public String getStatusText() throws IOException {
      return delegate.getStatusText();
    }

    @Override
    public void close() {
      delegate.close();
    }

    @Override
    public InputStream getBody() {
      return new ByteArrayInputStream(body);
    }

    @Override
    public HttpHeaders getHeaders() {
      return delegate.getHeaders();
    }
  }
}
