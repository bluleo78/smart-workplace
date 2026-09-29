package com.workplace.drive.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 드라이브 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-63). 파일·폴더·휴지통은 resource "drive", 스페이스 자체·멤버는
 * "drive-space". 일괄 작업은 이벤트 1건에 ids 여러 개를 싣는다 — 단건 메서드를 반복 호출하는 bulk 경로가 N건을 보내지 않도록 단건 메서드는 {@code
 * notify=false} 오버로드로 발행을 끈다. 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class DriveChangeNotifier {

  private final ApplicationEventPublisher publisher;

  /** 파일·폴더·휴지통 항목 변경 — ids 는 대상 drive_file/drive_folder id 들. */
  public void itemsChanged(String op, long spaceId, Collection<Long> ids, Long actorId) {
    publish("drive", op, spaceId, ids, actorId, Set.of());
  }

  /** 스페이스 자체·멤버 변경. extra — 제거된 멤버나 하드삭제 전 멤버(커밋 후 명단에 없음). */
  public void spaceChanged(String op, long spaceId, Long actorId, Collection<Long> extra) {
    publish("drive-space", op, spaceId, List.of(spaceId), actorId, extra);
  }

  private void publish(
      String resource,
      String op,
      long spaceId,
      Collection<Long> ids,
      Long actorId,
      Collection<Long> extra) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            resource,
            op,
            DriveSpaceAudienceResolver.SCOPE,
            spaceId,
            List.copyOf(ids),
            Map.of("spaceId", spaceId),
            actorId,
            Set.copyOf(extra)));
  }
}
