package com.workplace.home.dto;

import java.util.List;

/** 읽을 수 있는 공간 목록 — 조직 → 프로젝트 → 노트 스페이스. */
public record SharedMemorySpaceList(List<SharedMemorySpaceItem> items) {}
