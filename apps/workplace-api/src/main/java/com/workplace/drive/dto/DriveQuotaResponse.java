package com.workplace.drive.dto;

import com.workplace.drive.service.DriveQuotaService;

/**
 * 드라이브 쿼터 사용량/한도 — {@code GET /api/v1/drive/quota} 응답.
 *
 * <p>WP-1391 에서 {@code breakdown}·{@code mailCacheBytes} 를 덧붙였다(기존 필드는 그대로 — 롤링 중 구 웹도 동작).
 *
 * <p>내역은 서비스의 {@link DriveQuotaService.Breakdown} 을 그대로 쓴다 — 응답용 사본을 따로 두면 새 종류를 더할 때 고칠 곳이 늘고 필드
 * 순서가 어긋나도 컴파일이 잡지 못한다. JSON 은 레코드 구성요소만 나간다({@code drive, trash, wiki, issue, issueChat,
 * otherAttachments, unlinked} — {@code total()} 은 getter 이름이 아니라 직렬화되지 않는다).
 *
 * @param usedBytes 한도 계산에 쓰는 사용량(내역 합과 같다)
 * @param quotaBytes 테넌트 한도
 * @param breakdown 사용량의 종류별 내역
 * @param mailCacheBytes 메일 첨부 캐시 — 한도 미포함, 보여 주기만
 */
public record DriveQuotaResponse(
    long usedBytes, long quotaBytes, DriveQuotaService.Breakdown breakdown, long mailCacheBytes) {

  /** 서비스 스냅샷을 응답으로 옮긴다. */
  public static DriveQuotaResponse from(DriveQuotaService.QuotaView v) {
    return new DriveQuotaResponse(v.usedBytes(), v.quotaBytes(), v.breakdown(), v.mailCacheBytes());
  }
}
