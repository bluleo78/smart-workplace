package com.workplace.home.service;

import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.home.repository.CursorCodec;
import com.workplace.home.repository.HomeActivityRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 내 활동 피드. */
@Service
@RequiredArgsConstructor
public class HomeActivityService {
  private final HomeActivityRepository repo;

  /** size 는 1..50 클램프(기본 20). 다음 커서는 마지막 항목 (createdAt,id). */
  @Transactional(readOnly = true)
  public Page recent(Long callerId, String actorKind, String cursor, int size) {
    int limit = Math.min(50, Math.max(1, size));
    List<ActivityEntryResponse> items =
        repo.findRecent(callerId, actorKind, CursorCodec.decode(cursor), limit);
    String next =
        items.size() < limit
            ? null
            : CursorCodec.encode(
                items.get(items.size() - 1).createdAt(),
                String.valueOf(items.get(items.size() - 1).id()));
    return new Page(items, next);
  }

  public record Page(List<ActivityEntryResponse> items, String nextCursor) {}
}
