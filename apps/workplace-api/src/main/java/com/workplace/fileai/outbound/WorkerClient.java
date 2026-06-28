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

  public WorkerClient(RestClient restClient, String internalToken) {
    this.restClient = restClient;
    this.internalToken = internalToken;
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
    try {
      restClient
          .post()
          .uri("/tasks/extract")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(new ExtractTask(jobId, storageKey, mime, tenantId))
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      log.error("워커 추출 디스패치 실패: jobId={} error={}", jobId, e.getMessage());
      throw e;
    }
  }

  /**
   * 워커 추출 작업 페이로드.
   *
   * <p>tenantId 는 워커가 해석하지 않고 콜백 페이로드에 그대로 에코한다. 콜백 컨트롤러가 RLS GUC 복원에 사용.
   */
  public record ExtractTask(long jobId, String storageKey, String mime, long tenantId) {}
}
