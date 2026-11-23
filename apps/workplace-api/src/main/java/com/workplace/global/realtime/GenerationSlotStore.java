package com.workplace.global.realtime;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** AI 생성 슬롯 저장소(WP-1974) — 진행 중 생성의 (소유자·태그·만료) 상태를 둔다. 운영은 DB 표로 파드 사이에 공유하고, 단위 테스트용은 메모리다. */
public interface GenerationSlotStore {

  /**
   * 태그 슬롯을 확인하고 등록한다(원자적) — tag 는 null 이 아니다. 같은 태그 진행 중이면 BUSY, 상한이면 LIMIT, 살아 있는 같은 id 면 BUSY 로
   * {@link com.workplace.global.exception.StreamingGenerationRejectedException} 거절.
   */
  void reserve(
      long ownerUserId,
      StreamingGenerationRegistry.GenerationTag tag,
      int perUserLimit,
      String correlationId,
      String podId,
      Instant expiresAt);

  /** 태그 없는 슬롯(wiki·drive)을 상한·태그 판정 없이 등록한다. 살아 있는 같은 id 면 BUSY. */
  void registerUntagged(long ownerUserId, String correlationId, String podId, Instant expiresAt);

  /** 만료 시각을 옮긴다. 행이 없으면 아무것도 하지 않는다. */
  void extend(String correlationId, Instant expiresAt);

  /** 슬롯을 지운다(멱등). */
  void remove(String correlationId);

  /** 만료되지 않은 행의 소유자·파드 — 취소가 로컬 핸들 없이 왔을 때 403/404·중계 여부를 가른다. */
  Optional<GenerationSlot> find(String correlationId);

  /** 소유자의 scope 별 살아 있는 태그 생성(started_at 오름차순). */
  List<StreamingGenerationRegistry.ActiveGeneration> active(long ownerUserId, String scope);

  /**
   * 한 파드가 가진 슬롯 중 keepIds 에 없는 것을 지운다(파드 종료 정리). keepIds 는 그 파드에서 아직 도는 생성 — graceful 종료 동안 끝까지 도는
   * 생성의 행을 먼저 지우면 다른 파드가 같은 대화를 BUSY 없이 다시 시작하고 상한도 덜 센다. 그 행은 자신의 반납이나 임대 만료로 사라진다.
   */
  void removeByPod(String podId, Collection<String> keepIds);
}
