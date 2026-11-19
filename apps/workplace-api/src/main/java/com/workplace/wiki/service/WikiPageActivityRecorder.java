package com.workplace.wiki.service;

import com.workplace.global.util.AfterCommit;
import com.workplace.wiki.repository.WikiPageActivityRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 노트 「최근」 기록(WP-1764)의 쓰기 입구 — 열기·고치기 지점이 부른다.
 *
 * <p>기록은 부가 기능이라 본 요청(열기·저장)을 절대 막지 않는다. 그래서 (1) 호출 트랜잭션이 커밋된 <b>뒤</b>에 쓰고, (2) 모든 예외를 여기서 잡아 로그만
 * 남긴다. 실제 쓰기는 {@link WikiPageActivityRepository#upsert}(REQUIRES_NEW). 가능하면 트랜잭션 밖(컨트롤러)에서 부른다 — 커밋
 * 콜백 안에서 REQUIRES_NEW 를 열면 요청 커넥션을 둘 쓰기 때문이다. 트랜잭션 안에서 불리면 afterCommit 으로 미룬다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WikiPageActivityRecorder {
  private final WikiPageActivityRepository repository;

  private final WikiPageReadAccess readAccess;

  /** 행동을 기록한다. 트랜잭션 동기화가 켜져 있으면 커밋 뒤로 미루고({@link AfterCommit}), 아니면 바로 쓴다. 어떤 예외도 호출자에게 던지지 않는다. */
  public void record(long userId, long pageId, WikiPageAction action) {
    // AfterCommit.run 은 write 를 등록·실행만 하고 write 가 자기 예외를 삼키므로 여기서 또 잡지 않는다.
    AfterCommit.run(() -> write(userId, pageId, action));
  }

  /**
   * 열기를 기록한다 — 볼 수 없는 노트면 기록 전에 404 를 던진다(권한 확인은 기록 실패와 달리 삼키지 않는다). 컨트롤러가 읽기 권한 의존 없이 부르도록 여기 둔다.
   */
  public void recordOpen(long userId, long pageId) {
    readAccess.requireReadable(userId, pageId);
    record(userId, pageId, WikiPageAction.OPEN);
  }

  /**
   * 사용자가 멤버 권한으로 그 노트를 읽을 수 있을 때만 EDIT 를 기록한다. 공유 링크로만 고친 비멤버는 남기지 않는다 — 나중에 공간에 들어오면 그 기록이 드러나기
   * 때문이다. REST 저장·동기화 서버 저장이 같은 규칙을 쓰도록 여기 둔다. 멤버 조회 실패도 삼켜 이미 끝난 저장에 영향을 주지 않는다.
   */
  public void recordEditIfMember(long userId, long pageId) {
    boolean member;
    try {
      member = readAccess.readableCards(userId, List.of(pageId)).containsKey(pageId);
    } catch (RuntimeException e) {
      warn(userId, pageId, WikiPageAction.EDIT, e);
      return;
    }
    if (member) {
      record(userId, pageId, WikiPageAction.EDIT);
    }
  }

  /** 실제 쓰기 — 실패(FK 위반·DB 오류 등)는 삼키고 로그만 남긴다. */
  private void write(long userId, long pageId, WikiPageAction action) {
    try {
      repository.upsert(userId, pageId, action);
    } catch (RuntimeException e) {
      warn(userId, pageId, action, e);
    }
  }

  private static void warn(long userId, long pageId, WikiPageAction action, Exception e) {
    log.warn(
        "노트 최근 기록 실패(무시) userId={} pageId={} action={}: {}", userId, pageId, action, e.toString());
  }
}
