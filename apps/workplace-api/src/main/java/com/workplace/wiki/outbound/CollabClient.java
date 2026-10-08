package com.workplace.wiki.outbound;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.wiki.exception.CollabBodyRejectedException;
import com.workplace.wiki.exception.CollabMergeFailedException;
import com.workplace.wiki.exception.CollabRequestRejectedException;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * API → 노트 동기화 서버(workplace-collab) 호출(WP-285). 인증은 {@code Authorization: Internal <token>} 공유 비밀.
 *
 * <p>테넌트는 헤더가 아니라 본문 {@code tenantId} 로 싣는다 — API 는 이미 테넌트 컨텍스트 안에서 호출하고, 동기화 서버는 그 값을 문서 컨텍스트에
 * 보관했다가 되돌려 호출(PUT /internal/wiki/pages/{id}/doc)할 때 {@code X-Tenant-Id} 로 쓴다(스펙 §4.1). 무재시도 — 호출자가
 * 판단한다. apply-markdown 실패 매핑(WP-289 계약): 404·410(페이지 없어짐) → {@link WikiPageNotFoundException}(404),
 * 400 + 본문 거부 코드({@code empty_body}·{@code unparseable_body}) → {@link
 * CollabBodyRejectedException}(400, 한국어 문구만 — 동기화 서버 원문은 싣지 않는다), 그 밖의 400·4xx(우리 계약 위반 — 서버 버그) →
 * {@link CollabRequestRejectedException}(500), 500(병합 계산 실패) → {@link
 * CollabMergeFailedException}(502), 연결 실패·타임아웃·그 밖의 5xx 는 {@link CollabUnavailableException}(503).
 */
@Slf4j
public class CollabClient {

  private final RestClient restClient;

  public CollabClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.defaultHeader("Authorization", "Internal " + internalToken).build();
  }

  /**
   * 병합 기준본 후보 — body = 그 version 의 실제 본문, submittedBody = 그 version 을 만든 본문 저장의 제출 본문(없으면 null).
   * 동기화 서버가 다음 본문에 가까운 쪽을 기준으로 고른다(쓴 쪽이 응답에서 이어 썼는지 자기 본문에서 이어 썼는지 — WikiBodyHistoryRepository 참조).
   */
  public record MergeBase(String body, String submittedBody) {}

  /** 동기화 서버가 "제출 본문이 문제"라고 답하는 400 코드 → 호출자에게 보일 문구. 그 밖의 코드는 우리 쪽 결함이다. */
  private static final Map<String, String> BODY_REJECTION_MESSAGES =
      Map.of(
          "empty_body", "빈 본문은 내용이 있는 노트에 적용할 수 없습니다. 노트 전체 본문을 보내 주세요.",
          "unparseable_body", "본문을 노트 형식으로 해석할 수 없습니다. 마크다운 본문을 확인해 주세요.");

  /**
   * 마크다운 본문을 실시간 문서에 3-way 병합(mode=merge — 기준본·현재본·본문)하고 즉시 저장된 결과를 받는다(스펙 §5.1).
   *
   * @param base 쓴 쪽이 읽은 판의 기준본 후보(필수)
   * @param ai MCP·채팅 비서 등 AI 경로면 true(✦ 표시·적용 직전 미저장분 저장), 사람(구버전 웹)이면 false
   * @param snapshot 적용 저장 직전 판을 리비전으로 남긴다(AI 적용 또는 사람의 명시 snapshot 요청)
   * @return 동기화 서버가 저장한 version 과 그 version 의 body
   */
  public CollabApplyResult applyMarkdown(
      long tenantId,
      long pageId,
      MergeBase base,
      String body,
      long actorId,
      String actorName,
      boolean ai,
      boolean snapshot) {
    Objects.requireNonNull(base, "base");
    try {
      CollabApplyResult res =
          restClient
              .post()
              .uri("/internal/docs/{pageId}/apply-markdown", pageId)
              .contentType(MediaType.APPLICATION_JSON)
              .body(
                  new ApplyMarkdownRequest(
                      tenantId,
                      "merge",
                      base.body(),
                      base.submittedBody(),
                      body,
                      new Actor(actorId, actorName),
                      ai,
                      snapshot))
              .retrieve()
              .body(CollabApplyResult.class);
      if (res == null) {
        throw new CollabUnavailableException("동기화 서버 응답이 비어 있습니다: page=" + pageId, null);
      }
      return res;
    } catch (HttpClientErrorException e) {
      // 4xx 는 일시 장애가 아니다 — 503 으로 돌리면 호출자(MCP·구버전 웹)가 사라진 페이지에 재시도를 반복한다.
      if (e.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)
          || e.getStatusCode().isSameCodeAs(HttpStatus.GONE)) {
        throw new WikiPageNotFoundException(pageId);
      }
      // 400 + 본문 거부 코드 = 제출 본문 문제(빈 AI 본문·해석 불가) — 호출자가 고칠 문제라 400. 문구는 우리가 정한 한국어만 싣는다.
      // 그 밖의 400(잘못된 tenantId·mode 등 우리 계약 위반)은 호출자 잘못이 아니라 서버 버그 — 아래 500 으로.
      if (e.getStatusCode().isSameCodeAs(HttpStatus.BAD_REQUEST)) {
        String code = errorCodeOf(e);
        String message = code == null ? null : BODY_REJECTION_MESSAGES.get(code);
        if (message != null) {
          throw new CollabBodyRejectedException(message, e);
        }
      }
      log.error(
          "collab apply-markdown 요청 거부(서버 버그): page={} {} {}",
          pageId,
          e.getStatusCode(),
          e.getResponseBodyAsString());
      throw new CollabRequestRejectedException("노트 동기화 서버가 본문 적용 요청을 거부했습니다: page=" + pageId, e);
    } catch (RestClientException e) {
      // 500 = 병합 계산 실패(아무것도 적용 안 됨) → 502.
      if (e instanceof HttpServerErrorException se
          && se.getStatusCode().isSameCodeAs(HttpStatus.INTERNAL_SERVER_ERROR)) {
        log.error("collab apply-markdown 병합 실패: page={} {}", pageId, e.getMessage());
        throw new CollabMergeFailedException("노트 본문 병합에 실패했습니다: page=" + pageId, e);
      }
      // 그 밖의 5xx(503 문서 로드·저장 실패·병합 시간 초과 등)·연결 실패·읽기 타임아웃 — 일시 장애 503. 타임아웃은 적용 여부를 모르지만
      // 호출자가 같은 기준본으로 재시도해도 내용이 중복되지 않는다.
      log.warn("collab apply-markdown 실패: page={} {}", pageId, e.getMessage());
      throw new CollabUnavailableException("노트 동기화 서버에 본문을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.", e);
    }
  }

  /** 동기화 서버 오류 응답의 기계 판독 코드({@code {"error":..., "code":...}}). JSON 이 아니거나 없으면 null. */
  private static String errorCodeOf(HttpClientErrorException e) {
    try {
      ErrorBody body = e.getResponseBodyAs(ErrorBody.class);
      return body == null ? null : body.code();
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  /** 동기화 서버 오류 응답 본문 중 코드만 — 나머지 키(error 문구 등)는 무시한다. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  record ErrorBody(String code) {}

  /** 권한 변화 후 열린 연결 재검증 요청(스펙 §4.1). 실패 시 {@link CollabUnavailableException}. */
  public void revalidate(RevalidateRequest req) {
    try {
      restClient
          .post()
          .uri("/internal/docs/revalidate")
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      throw new CollabUnavailableException("노트 동기화 서버 재검증 요청 실패", e);
    }
  }

  /**
   * apply-markdown 요청 본문. pageId 는 경로에 싣는다. null 인 altBaseBody 키는 생략한다. API 는 늘 merge 를 보낸다 — 동기화
   * 서버의 replace 모드는 E2E 테스트 픽스처와 이후 버전 복원(WP-297)용이다.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record ApplyMarkdownRequest(
      long tenantId,
      String mode,
      String baseBody,
      String altBaseBody,
      String body,
      Actor actor,
      boolean ai,
      boolean snapshot) {}

  /** 적용 주체 — 동기화 서버가 awareness 이름표·updated_by 에 쓴다. */
  record Actor(long userId, String name) {}

  /**
   * apply-markdown 응답 — 즉시 저장 후의 wiki_page.version 과 그 본문. persisted=false 면 실시간 문서에는 적용됐지만 즉시 저장이
   * 시간 안에 끝나지 않았다(동기화 서버가 재시도로 저장한다) — 그때 version 은 마지막으로 저장된 판(적용분 미포함)이다. 키가 없으면(구버전 동기화 서버) 저장된
   * 것으로 본다.
   */
  public record CollabApplyResult(int version, String body, Boolean persisted) {
    public CollabApplyResult(int version, String body) {
      this(version, body, true);
    }

    /** 적용 저장까지 끝났는가 — 키가 없으면 true. */
    public boolean isPersisted() {
      return persisted == null || persisted;
    }
  }

  /**
   * revalidate 요청 본문. spaceId·pageIds·userId 는 선택 — null 이면 키를 생략한다. 의미: pageIds 가 있으면 그 페이지 연결,
   * 없으면 spaceId 의 모든 연결; userId 가 있으면 그 사용자 연결로 한정.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record RevalidateRequest(long tenantId, Long spaceId, List<Long> pageIds, Long userId) {}
}
