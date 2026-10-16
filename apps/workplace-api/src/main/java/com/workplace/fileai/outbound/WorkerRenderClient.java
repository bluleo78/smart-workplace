package com.workplace.fileai.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.AttachmentViewException;
import com.workplace.global.outbound.InternalHttp;
import com.workplace.global.outbound.InternalResponses;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 워커 /render 동기 호출(WP-250) — PDF 한 쪽 또는 이미지를 모델 입력용 PNG/JPEG 로 그려 받는다.
 *
 * <p>오류 매핑: 워커의 사용자 쪽 4xx 코드(페이지 범위·형식·크기·손상·원본 없음)는 그대로 {@link AttachmentViewException} 으로 전한다. 연결
 * 실패·타임아웃·5xx·워커 비활성과, BAD_KEY·인증 실패·요청 검증 실패(목록형 detail)처럼 API 쪽 결함은 모두 503 WORKER_UNAVAILABLE 로
 * 모은다 — 모델이 고칠 수 없는 원인을 "다시 올려 달라" 같은 엉뚱한 안내로 바꾸지 않기 위해서다. 결함 쪽은 경고 로그로 남긴다.
 *
 * <p>호출은 트랜잭션 밖에서 해야 한다(최대 timeoutSeconds 동안 DB 연결을 잡지 않게 — AttachmentViewService 참조).
 */
@Component
public class WorkerRenderClient {

  private static final Logger log = LoggerFactory.getLogger(WorkerRenderClient.class);

  private final WorkerProperties props;
  private final HttpClient http;
  private final ObjectMapper mapper = new ObjectMapper();

  @Autowired
  public WorkerRenderClient(WorkerProperties props) {
    // HTTP/1.1 고정 — InternalHttp 참조. 연결 타임아웃은 짧게(워커 다운을 빨리 503 으로).
    this(props, InternalHttp.httpClientBuilder().connectTimeout(Duration.ofSeconds(2)).build());
  }

  /** 테스트용 — HttpClient 주입. */
  WorkerRenderClient(WorkerProperties props, HttpClient http) {
    this.props = props;
    this.http = http;
  }

  /**
   * 첨부 하나를 이미지로 그린다. 결과의 pageCount 는 PDF 일 때 {@link ViewImage#PAGE_COUNT_HEADER} 헤더 값(없으면 null).
   *
   * @param storageKey file.storage_path — 워커 저장소 루트 기준 경로(추출 디스패치와 같은 값)
   * @param mime 파라미터를 뗀 MIME
   * @param page PDF 면 1부터 센 쪽 번호, 이미지면 null
   * @param maxEdge 결과 긴 변 픽셀
   * @throws AttachmentViewException 워커가 거절했거나 응답하지 못했을 때
   */
  public ViewImage render(String storageKey, String mime, Integer page, int maxEdge) {
    if (!props.enabled()) {
      throw AttachmentViewException.workerUnavailable();
    }
    byte[] json;
    try {
      // page 가 null(이미지)이어도 키를 보낸다 — Map.of 는 null 을 못 받으므로 LinkedHashMap.
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("storageKey", storageKey);
      body.put("mime", mime);
      body.put("page", page);
      body.put("maxEdge", maxEdge);
      json = mapper.writeValueAsBytes(body);
    } catch (IOException e) {
      throw new IllegalStateException("render 요청 직렬화 실패", e);
    }
    return send(URI.create(props.baseUrl() + "/render"), "application/json", json, storageKey);
  }

  /**
   * 저장소에 두지 않는 원본 바이트를 본문으로 보내 그린다(WP-388, 워커 {@code POST /render/bytes}) — 메일 첨부처럼 복호화한 원본을 공유 볼륨에
   * 쓰지 않기 위해서다. 응답·오류 매핑은 {@link #render} 와 같다.
   *
   * @param data 원본 바이트(호출자가 25MB 상한을 먼저 확인한다 — 워커도 넘으면 413)
   * @param mime 파라미터를 뗀 MIME
   * @param page PDF 면 1부터 센 쪽 번호, 이미지면 null(쿼리에서 뺀다)
   * @param maxEdge 결과 긴 변 픽셀
   * @throws AttachmentViewException 워커가 거절했거나 응답하지 못했을 때
   */
  public ViewImage renderBytes(byte[] data, String mime, Integer page, int maxEdge) {
    if (!props.enabled()) {
      throw AttachmentViewException.workerUnavailable();
    }
    String query =
        "mime="
            + URLEncoder.encode(mime, StandardCharsets.UTF_8)
            + (page == null ? "" : "&page=" + page)
            + "&maxEdge="
            + maxEdge;
    // 로그 식별자 — 경로가 없으므로 형식·크기로 남긴다(원본 내용은 남기지 않는다).
    String logKey = "bytes(" + mime + ", " + data.length + "B)";
    return send(
        URI.create(props.baseUrl() + "/render/bytes?" + query),
        "application/octet-stream",
        data,
        logKey);
  }

  /**
   * /render·/render/bytes 공통 — 보내고 응답을 {@link ViewImage} 또는 {@link AttachmentViewException} 으로 바꾼다.
   */
  private ViewImage send(URI uri, String contentType, byte[] body, String storageKey) {
    HttpResponse<byte[]> resp;
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(uri)
              .timeout(Duration.ofSeconds(props.render().timeoutSeconds()))
              .header("Authorization", "Internal " + props.internalToken())
              .header("Content-Type", contentType)
              .POST(HttpRequest.BodyPublishers.ofByteArray(body))
              .build();
      resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    } catch (InterruptedException e) {
      // 인터럽트 상태를 되살려 상위(요청 취소·종료)가 알아차리게 한다.
      Thread.currentThread().interrupt();
      throw AttachmentViewException.workerUnavailable();
    } catch (IOException e) {
      // 연결 거부·연결/요청 타임아웃(HttpTimeoutException 도 IOException)
      log.warn("render 호출 실패: storageKey={} error={}", storageKey, e.toString());
      throw AttachmentViewException.workerUnavailable();
    }

    int status = resp.statusCode();
    if (status == 200) {
      String type = imageType(resp.headers().firstValue("Content-Type").orElse(""));
      if (type == null) {
        // 워커 계약은 PNG·JPEG 뿐 — 다른 형식은 캐시 확장자·응답 형식을 정할 수 없어 장애로 다룬다.
        log.warn(
            "render 응답 형식이 PNG·JPEG 가 아님: contentType={} storageKey={}",
            resp.headers().firstValue("Content-Type").orElse(null),
            storageKey);
        throw AttachmentViewException.workerUnavailable();
      }
      return new ViewImage(resp.body(), type, InternalResponses.pageCount(resp));
    }
    if (status >= 400 && status < 500) {
      throw toException(status, resp.body(), storageKey);
    }
    log.warn("render 비정상 응답: status={} storageKey={}", status, storageKey);
    throw AttachmentViewException.workerUnavailable();
  }

  /** 4xx 본문 {"detail":{"code":..,"pageCount":..}} 해석. 전할 수 없는 코드·형식은 503 으로 모은다. */
  private AttachmentViewException toException(int status, byte[] body, String storageKey) {
    // JSON 이 아니거나 detail 이 목록(FastAPI 요청 검증 실패)이면 code 없음 → 아래에서 503
    JsonNode detail = InternalResponses.errorDetail(body);
    String code = detail == null ? null : detail.path("code").asText(null);
    JsonNode pc = detail == null ? null : detail.path("pageCount");
    Integer pageCount = pc != null && pc.isInt() ? pc.asInt() : null;
    if (AttachmentViewException.isPassThrough(code)) {
      return new AttachmentViewException(code, "PAGE_OUT_OF_RANGE".equals(code) ? pageCount : null);
    }
    log.warn(
        "render 거절을 전할 수 없음(API 쪽 결함 의심): status={} code={} storageKey={} body={}",
        status,
        code,
        storageKey,
        InternalResponses.abbreviate(body));
    return AttachmentViewException.workerUnavailable();
  }

  /**
   * 응답 Content-Type 을 정확히 "image/png" 또는 "image/jpeg" 로 맞춘다("image/jpeg; q=85"·"IMAGE/JPG" 등). 새로
   * 그린 응답과 캐시 적중(확장자로 정함)이 같은 값을 돌려주게 하려는 것이다. 둘 다 아니면 null.
   */
  static String imageType(String contentType) {
    ViewImage.Format format = ViewImage.Format.ofMime(MimeNormalizer.baseMime(contentType));
    return format == null ? null : format.contentType();
  }
}
