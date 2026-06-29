package com.workplace.fileai.outbound;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * api→워커 디스패치 클라이언트. AiAgentMailClient 미러.
 *
 * <p>작업 타입별 /tasks/{type} 에 Internal 토큰으로 POST 한다. 무재시도 — 재시도는 상위 레이어(스케줄러)가 담당.
 */
@Slf4j
public class WorkerClient {

  private final RestClient restClient;
  private final String internalToken;

  /** 스프링 빈 생성 경로 — WorkerClientConfig 에서 호출. */
  public WorkerClient(RestClient restClient, String internalToken) {
    this.restClient = restClient;
    this.internalToken = internalToken;
  }

  /**
   * 테스트용 편의 생성자 — WorkerProperties 로 RestClient 를 내부 구성한다.
   *
   * <p>단위 테스트에서 로컬 HttpServer 스텁을 직접 지정하기 위해 사용한다.
   */
  WorkerClient(WorkerProperties props) {
    this(RestClient.builder().baseUrl(props.baseUrl()).build(), props.internalToken());
  }

  /**
   * 텍스트 추출 작업을 워커에 디스패치한다.
   *
   * @param jobId worker_job.id (워커가 콜백 시 사용)
   * @param storageKey 파일 스토리지 경로(file.storage_path)
   * @param mime MIME 타입 (워커 파서 분기용)
   * @param tenantId 테넌트 ID — 워커가 콜백 페이로드에 그대로 에코(round-trip). 콜백 수신 측이 TenantContext 복원에 사용.
   */
  public void dispatchExtract(long jobId, String storageKey, String mime, long tenantId) {
    post("/tasks/extract", new ExtractTask(jobId, storageKey, mime, tenantId));
  }

  /**
   * 추출 텍스트를 워커에 임베딩 디스패치(POST /tasks/embed).
   *
   * <p>본문은 텍스트 직접 전달(blob 경로 아님 — 텍스트가 이미 api DB 에 있음).
   *
   * @param jobId worker_job.id (워커가 콜백 시 사용)
   * @param text 임베딩할 텍스트 (file_extraction.extracted_text)
   * @param tenantId 테넌트 ID — 워커가 콜백 페이로드에 그대로 에코(round-trip). 콜백 수신 측이 TenantContext 복원에 사용.
   */
  public void dispatchEmbed(long jobId, String text, long tenantId) {
    post("/tasks/embed", new EmbedTask(jobId, text, tenantId));
  }

  /**
   * 내부 POST 헬퍼 — Authorization 헤더 주입 및 오류 로깅을 공통화한다.
   *
   * @param path 워커 상대 경로 (예: /tasks/extract)
   * @param body 직렬화할 요청 본문
   */
  private void post(String path, Object body) {
    try {
      restClient
          .post()
          .uri(path)
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(body)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      log.error("워커 디스패치 실패: path={} error={}", path, e.getMessage());
      throw e;
    }
  }

  /**
   * 워커 추출 작업 페이로드.
   *
   * <p>tenantId 는 워커가 해석하지 않고 콜백 페이로드에 그대로 에코한다. 콜백 컨트롤러가 RLS GUC 복원에 사용.
   */
  public record ExtractTask(long jobId, String storageKey, String mime, long tenantId) {}

  /**
   * 워커 /tasks/embed 요청 본문(zod/pydantic 와 1:1).
   *
   * <p>tenantId 는 워커가 해석하지 않고 콜백 페이로드에 그대로 에코한다. 콜백 컨트롤러가 RLS GUC 복원에 사용.
   */
  public record EmbedTask(long jobId, String text, long tenantId) {}
}
