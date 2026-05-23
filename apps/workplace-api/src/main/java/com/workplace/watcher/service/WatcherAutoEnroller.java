package com.workplace.watcher.service;

import com.workplace.watcher.repository.IssueWatcherRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** issue/comment 라이프사이클에서 호출되는 한 줄짜리 멱등 enroll 진입점. */
@Service
@RequiredArgsConstructor
public class WatcherAutoEnroller {

  private final IssueWatcherRepository repository;

  /** userId 가 null 이면 no-op. INSERT ... ON CONFLICT DO NOTHING. */
  public void enroll(Long issueId, Long userId) {
    if (userId == null) return;
    repository.add(issueId, userId);
  }
}
