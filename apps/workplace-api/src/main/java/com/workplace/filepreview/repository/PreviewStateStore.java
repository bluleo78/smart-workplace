package com.workplace.filepreview.repository;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * 문서 미리보기(서버 변환 PDF) 상태 저장소 — 키에 독립적인 CAS 선점·결과 기록 계약(WP-431·WP-432).
 *
 * <p>드라이브는 {@code file_id}, 메일 첨부는 {@code (tenant_id, content_hash)} 를 키로 쓴다. 상태기계(선점·리스 토큰·기록
 * CAS)는 키 종류와 무관하게 같아야 하므로, 변환 엔진은 이 인터페이스만 보고 동작한다.
 *
 * <p>선점이 돌려주는 {@code leased_until} 이 리스 토큰이며, 모든 기록은 {@code status='CONVERTING' AND
 * leased_until=토큰} CAS 로만 반영된다. 구현은 RLS 대상 테이블이라 호출자는 테넌트 GUC 가 심긴 트랜잭션 안에서 불러야 한다.
 *
 * @param <K> 미리보기 상태 행의 키
 */
public interface PreviewStateStore<K> {

  /**
   * 미리보기 상태 한 행. {@code leasedUntil} 은 CONVERTING 일 때의 리스 토큰(그 밖엔 대개 null), {@code updatedAt} 은 마지막
   * 상태 변경 시각(일시 실패 쿨다운 판정용).
   */
  record Row(
      String status,
      String failureCode,
      boolean failureTransient,
      int attempts,
      String engineVersion,
      Integer pageCount,
      OffsetDateTime leasedUntil,
      OffsetDateTime updatedAt) {}

  /** 키의 미리보기 상태를 조회한다. 행이 없으면(아직 변환 시도 전) empty. */
  Optional<Row> find(K key);

  /**
   * {@link #find} 와 같되 행을 잠근다({@code FOR UPDATE}) — 고아 결과를 지울지 판정하는 동안 다른 작업이 행을 바꾸지(선점·완료 기록) 못하게.
   */
  Optional<Row> findForUpdate(K key);

  /**
   * 변환 작업을 선점한다. 선점 가능한 경우(행 없음·PENDING·리스 만료 CONVERTING·엔진 버전이 바뀐 READY·재시도 허용된 FAILED)에만
   * CONVERTING 으로 바꾸고 새 {@code leased_until}(리스 토큰)을 돌려준다.
   *
   * <p>엔진 버전이 바뀐 READY 는 재시도 허용과 무관하게 선점한다 — 새 엔진의 결과로 바꿔 보이기 위해서다(폴링·백그라운드도).
   *
   * <p>FAILED 재선점은 {@code allowFailedRetry} 일 때만 — 엔진 버전이 바뀌었거나(영구 실패 포함), 일시 실패이면서 {@code attempts
   * < maxAttempts} 이거나, 일시 실패가 상한에 닿았어도 마지막 실패({@code updated_at})가 {@code transientCooldown} 보다
   * 오래됐을 때. 폴링은 false 로 불러 몇 초 장애가 폴링 몇 번에 시도 상한을 소진하지 않게 한다. 엔진 버전이 바뀌거나 쿨다운 뒤 다시 잡으면 attempts 는 1
   * 부터 다시 센다.
   *
   * @return 선점 성공 시 리스 토큰, 이미 다른 작업이 선점했거나 선점 불가 상태면 empty
   */
  Optional<OffsetDateTime> claim(
      K key,
      long tenantId,
      String engineVersion,
      Duration lease,
      int maxAttempts,
      Duration transientCooldown,
      boolean allowFailedRetry);

  /**
   * 실행기 작업이 실제로 시작할 때 리스를 새로 잡는다 — 이 토큰으로 아직 CONVERTING 이면 {@code leased_until = now() + lease} 로
   * 바꾸고 새 토큰을 돌려준다. 큐에서 기다린 시간만큼 리스가 줄어 변환 도중 만료되는 일을 막기 위해서다.
   *
   * <p>만료 여부는 보지 않고 토큰 일치만 본다 — 만료됐어도 아무도 다시 선점하지 않았다면(토큰 그대로) 이 작업이 여전히 행의 주인이고, 다시 선점됐다면 토큰이 바뀌어
   * CAS 가 실패한다.
   *
   * @return 새 리스 토큰, 리스를 잃었으면 empty(작업을 건너뛴다)
   */
  Optional<OffsetDateTime> refreshLease(K key, OffsetDateTime leaseToken, Duration lease);

  /**
   * 이 리스 토큰으로 아직 CONVERTING 이고 리스가 살아 있는지 — 변환 결과(PDF)를 쓰기 직전에 리스를 잃었는지 확인하는 데 쓴다. 만료된 리스는 언제든 다른
   * 요청이 다시 선점할 수 있어 주인으로 보지 않는다.
   */
  boolean isCurrentLease(K key, OffsetDateTime leaseToken);

  /**
   * 변환 완료 기록 — READY 로 바꾸고 실패 필드·리스를 비운다. 리스를 잃었으면 false.
   *
   * @param pageCount 변환 서비스의 X-Page-Count(없으면 null)
   */
  boolean markReady(K key, OffsetDateTime leaseToken, Integer pageCount);

  /** 변환 실패 기록 — FAILED·실패 코드·일시 여부를 남기고 리스를 비운다(attempts 는 선점 때 이미 셌다). 리스를 잃었으면 false. */
  boolean markFailed(K key, OffsetDateTime leaseToken, String code, boolean transientFailure);

  /**
   * 선점 반납 — CONVERTING → PENDING 으로 되돌리고 선점 때 센 시도 1회를 돌려준다. 실행기가 작업을 거절(큐 가득)해 변환을 시작조차 못 했을 때 시도
   * 상한을 소모하지 않게 하기 위해서다. 리스를 잃었으면 false.
   */
  boolean release(K key, OffsetDateTime leaseToken);

  /** READY 인데 결과 PDF 가 사라졌을 때(볼륨 이전·수동 정리) 다시 변환하도록 PENDING·attempts 0 으로 되돌린다. */
  void resetReady(K key);

  /**
   * 크기 상한 초과 — 변환 서비스를 부르지 않고 영구 실패(FAILED/TOO_LARGE)로 업서트한다. 원본 크기는 바뀌지 않으므로 기존 상태와 무관하게 덮어쓰며, 엔진
   * 버전을 함께 남겨 같은 엔진에서는 다시 선점되지 않게 한다.
   */
  void markTooLarge(K key, long tenantId, String engineVersion);
}
