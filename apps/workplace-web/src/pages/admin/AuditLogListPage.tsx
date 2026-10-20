import { useState } from 'react';

import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter';
import { SettingsPage } from '@/components/layout/SettingsPage';
import { useSettingsScrollRoot } from '@/components/layout/settingsScrollRoot';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { useAuditLogs } from '@/hooks/queries/useAuditLogs';
import { useDebounceValue } from '@/hooks/useDebounceValue';
import { AUDIT_ACTION_TYPES, AUDIT_RESOURCES, formatAuditAction, formatAuditResource, lastFacetValue } from '@/lib/auditLogLabels';
import { clickableRowProps } from '@/lib/clickableRowProps';
import { formatDateTime, formatIpAddress, formatNumber } from '@/lib/formatters';
import { flattenUniquePages } from '@/lib/offsetPaging';
import type { AuditLogResponse } from '@/types/auditLog';

import { AuditUserFilter, type AuditUserSelection } from './components/AuditUserFilter';

/** 결과 필터 옵션 목록 */
const RESULTS = [
  { value: 'SUCCESS', label: '성공' },
  { value: 'FAILURE', label: '실패' },
];

/**
 * 날짜 문자열(YYYY-MM-DD)을 ISO 8601 UTC datetime 문자열로 변환.
 * - KST(UTC+9) 환경에서 타임존 suffix 없이 생성하면 백엔드가 UTC로 해석할 때 9시간 오프셋 오류가 발생하므로,
 *   Date 객체로 변환 후 toISOString()으로 UTC 기준 문자열(Z suffix)을 생성한다.
 * - endDate의 경우 하루의 끝(23:59:59 KST = 14:59:59 UTC)으로 설정해 inclusive 범위를 구현한다.
 */
function toIsoDateTime(dateStr: string, endOfDay = false): string {
  // YYYY-MM-DD를 로컬 타임존 기준 시작/끝 시각으로 파싱 후 UTC ISO 문자열로 변환
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return date.toISOString();
}

/**
 * 감사 로그 상세 보기 다이얼로그
 * - 테이블 행 클릭 시 표시: description 전문, IP, actionTime 등 전체 필드를 보여준다.
 */
function AuditLogDetailDialog({
  log,
  open,
  onClose,
}: {
  log: AuditLogResponse | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!log) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>감사 로그 상세</DialogTitle>
          <DialogDescription className="sr-only">감사 로그 상세</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {/* 기본 정보 행 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground mb-1 text-xs">시간</p>
              <p className="font-medium">{formatDateTime(log.actionTime)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-xs">사용자</p>
              <p className="font-medium">{log.username}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground mb-1 text-xs">액션</p>
              <p>{formatAuditAction(log.actionType)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-xs">리소스</p>
              <p>{formatAuditResource(log.resource)}{log.resourceId ? ` (${log.resourceId})` : ''}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground mb-1 text-xs">결과</p>
              <Badge variant={log.result === 'SUCCESS' ? 'default' : 'destructive'}>
                {log.result === 'SUCCESS' ? '성공' : '실패'}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-xs">IP 주소</p>
              <p title={log.ipAddress ?? undefined}>{formatIpAddress(log.ipAddress)}</p>
            </div>
          </div>

          {/* 설명 전문: truncate 없이 전체 표시 */}
          <div>
            <p className="text-muted-foreground mb-1 text-xs">설명</p>
            <p className="bg-muted rounded-md p-3 whitespace-pre-wrap break-words">
              {log.description ?? '-'}
            </p>
          </div>

          {/* 에러 메시지 (실패인 경우) */}
          {log.errorMessage && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs">에러 메시지</p>
              <p className="bg-muted text-destructive rounded-md p-3 whitespace-pre-wrap break-words">
                {log.errorMessage}
              </p>
            </div>
          )}

          {/*
            User Agent 표시
            - 브라우저/OS 추적용 — 누가 어떤 디바이스에서 액션했는지 식별
            - 긴 문자열을 break-all 로 줄바꿈 처리, monospace 로 가독성 확보
            - userAgent 가 null/empty 인 경우 섹션 자체를 숨김 (시각 노이즈 방지)
          */}
          {log.userAgent && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs">User Agent</p>
              <p className="bg-muted rounded-md p-3 font-mono text-xs break-all">
                {log.userAgent}
              </p>
            </div>
          )}

          {/*
            Metadata(JSON payload) 표시
            - 변경 전/후 값, 요청 파라미터 등 변경 감사의 핵심 데이터
            - JSON.stringify(..., null, 2) 로 들여쓰기, monospace + 스크롤
            - max-h-64 + overflow-auto 로 긴 payload 도 다이얼로그를 깨뜨리지 않게 함
            - metadata 가 null 이거나 빈 객체이면 섹션 자체를 숨김
          */}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs">Metadata</p>
              <pre className="bg-muted rounded-md p-3 font-mono text-xs max-h-64 overflow-auto whitespace-pre">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 감사 로그 목록 페이지 — 날짜 범위 필터 + 행 클릭 상세 보기 */
export default function AuditLogListPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounceValue(search, 300);
  /** 사용자 필터 (#89): null 이면 전체, 선택 시 해당 user_id 정확 일치 */
  const [user, setUser] = useState<AuditUserSelection | null>(null);
  const [actionType, setActionType] = useState<string>('');
  const [resource, setResource] = useState<string>('');
  const [result, setResult] = useState<string>('');
  /** 날짜 범위 필터: YYYY-MM-DD 형식으로 저장 */
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  /** 상세 보기 다이얼로그 상태 */
  const [selectedLog, setSelectedLog] = useState<AuditLogResponse | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 무한 스크롤(WP-182): 필터가 바뀌면 쿼리 키가 바뀌어 첫 페이지부터 다시 받는다.
  const logsQuery = useAuditLogs({
    search: debouncedSearch || undefined,
    userId: user?.userId,
    actionType: actionType || undefined,
    resource: resource || undefined,
    result: result || undefined,
    // 날짜 범위를 ISO datetime으로 변환하여 API에 전달
    startDate: startDate ? toIsoDateTime(startDate) : undefined,
    endDate: endDate ? toIsoDateTime(endDate, true) : undefined,
  });
  // 오류 행은 첫 페이지 실패만(isLoadingError) — LoadMoreFooter 참조
  const { data, isLoading, isLoadingError } = logsQuery;
  const logs = flattenUniquePages(data?.pages, (log) => log.id);
  const totalElements = data?.pages[0]?.totalElements;
  const scrollRoot = useSettingsScrollRoot();

  const handleFilterChange = (setter: (v: string) => void) => (value: string) => {
    setter(value === 'all' ? '' : value);
  };

  /**
   * actionType·resource 공통 facet 정의 (#233-A)
   * - 기존 단일 Select 를 도메인 비결합 FacetFilter(＋필터→칩) 패턴으로 통일.
   * - 옵션/라벨은 AUDIT_ACTION_TYPES/AUDIT_RESOURCES(한글 라벨, @/lib/auditLogLabels) 그대로 사용.
   */
  const auditFacets: FacetDef[] = [
    {
      key: 'actionType',
      label: '액션 유형',
      options: AUDIT_ACTION_TYPES,
    },
    {
      key: 'resource',
      label: '리소스',
      options: AUDIT_RESOURCES,
    },
  ];

  /**
   * 단일 문자열 state → FacetFilter value(0~1개 배열).
   * - 백엔드(AuditLogController/Repository)가 actionType/resource 를 단일 .eq() 로만 받으므로
   *   각 facet 은 최대 1개 값만 가진다.
   */
  const auditFilterValue: FilterValue = {
    actionType: actionType ? [actionType] : [],
    resource: resource ? [resource] : [],
  };

  /**
   * FacetFilter onChange → 단일값 state 갱신.
   * - FacetFilter 의 toggle 은 멀티셀렉트(append)이지만 백엔드가 단일값만 지원하므로
   *   마지막에 추가된 값만 유지해 "교체" 의미를 만든다(이전 값 자동 해제).
   */
  const handleFacetChange = (next: FilterValue) => {
    setActionType(lastFacetValue(next.actionType));
    setResource(lastFacetValue(next.resource));
  };

  /** 날짜 input 이벤트 → 문자열 state */
  const handleDateChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
  };

  /** 행 클릭 → 상세 보기 다이얼로그 열기 */
  const handleRowClick = (log: AuditLogResponse) => {
    setSelectedLog(log);
    setDetailOpen(true);
  };

  return (
    <SettingsPage title="감사 로그">
      {/* 필터 줄 — 모바일(WP-183)은 검색·날짜를 한 줄씩 꽉 채우고, 나머지 컨트롤은 남는 폭을 나눠 쓴다 */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <SearchInput
          placeholder="설명으로 검색..."
          value={search}
          onChange={setSearch}
          className="basis-full sm:basis-0"
        />

        {/* 사용자 필터 (#89) — user_id 정확 일치. 인원 수와 무관하게 고를 수 있게 검색형(WP-183) */}
        <AuditUserFilter value={user} onChange={setUser} />

        {/*
          액션 유형·리소스 필터 (#233-A)
          - 기존 단일 Select 2개를 공통 FacetFilter(＋필터→칩) 로 통일.
          - 백엔드가 단일값만 지원하므로 handleFacetChange 가 facet 당 1개 값으로 제약한다.
        */}
        <FacetFilter
          facets={auditFacets}
          value={auditFilterValue}
          onChange={handleFacetChange}
        />

        <Select value={result || 'all'} onValueChange={handleFilterChange(setResult)}>
          <SelectTrigger className="w-[120px] shrink-0" aria-label="결과 필터">
            <SelectValue placeholder="결과" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 결과</SelectItem>
            {RESULTS.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 날짜 범위 필터: 시작일 ~ 종료일 */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            aria-label="시작 날짜"
            className="min-w-0 flex-1 sm:w-[150px] sm:flex-none"
            value={startDate}
            max={endDate || undefined}
            onChange={handleDateChange(setStartDate)}
          />
          <span className="text-muted-foreground text-sm">~</span>
          <Input
            type="date"
            aria-label="종료 날짜"
            className="min-w-0 flex-1 sm:w-[150px] sm:flex-none"
            value={endDate}
            min={startDate || undefined}
            onChange={handleDateChange(setEndDate)}
          />
        </div>

        {/* 전체 건수 — 무한 스크롤이라 페이지 표시 대신 총 건수만 보인다(WP-182) */}
        {totalElements != null && (
          <span className="ml-auto text-sm text-muted-foreground" data-testid="audit-log-total">
            총 {formatNumber(totalElements)}건
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table aria-label="감사 로그">
          <TableHeader>
            <TableRow>
              <TableHead>시간</TableHead>
              {/* 좁은 화면(WP-183)은 리소스·설명·IP 를 숨긴다 — 행을 누르면 상세 다이얼로그에서 전부 보인다.
                  사용자 열도 숨기고 액션 아래 줄로 옮긴다 — 네 열이면 「결과」가 화면 밖으로 밀렸다(WP-639) */}
              <TableHead className="hidden md:table-cell">사용자</TableHead>
              <TableHead>액션</TableHead>
              <TableHead className="hidden md:table-cell">리소스</TableHead>
              <TableHead className="hidden md:table-cell">설명</TableHead>
              <TableHead>결과</TableHead>
              <TableHead className="hidden md:table-cell">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={7} rows={5} />
            ) : isLoadingError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-destructive">
                  데이터를 불러오는데 실패했습니다.
                </TableCell>
              </TableRow>
            ) : logs.length > 0 ? (
              logs.map((log) => (
                // 행 클릭 시 상세 보기 다이얼로그를 열어 truncate된 description 전문을 표시한다
                <TableRow
                  key={log.id}
                  className="row-hover cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
                  {...clickableRowProps(
                    () => handleRowClick(log),
                    `${log.username} — ${formatAuditAction(log.actionType)} 상세 보기`,
                  )}
                >
                  {/* 모바일은 날짜·시각을 두 줄로 접어 표 폭을 줄인다(첫 공백 → 줄바꿈).
                      각 줄은 꺾지 않는다 — 칸이 좁으면 「2026- / 10-21」 로 꺾여 세 줄이 됐다(WP-639) */}
                  <TableCell className="whitespace-pre text-sm md:whitespace-nowrap">
                    {formatDateTime(log.actionTime).replace(' ', '\n')}
                  </TableCell>
                  <TableCell className="hidden font-medium md:table-cell">{log.username}</TableCell>
                  <TableCell>
                    {formatAuditAction(log.actionType)}
                    {/* 모바일 전용 — 숨긴 사용자 열의 값. 긴 아이디는 잘라 표가 넘치지 않게 하고 전체 값은 상세 다이얼로그에 */}
                    <div className="max-w-[45vw] truncate text-xs text-muted-foreground md:hidden">{log.username}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatAuditResource(log.resource)}</TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell">{log.description ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant={log.result === 'SUCCESS' ? 'default' : 'destructive'}>
                      {log.result === 'SUCCESS' ? '성공' : '실패'}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="hidden text-sm text-muted-foreground md:table-cell"
                    title={log.ipAddress ?? undefined}
                  >
                    {formatIpAddress(log.ipAddress)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={7}
                message="감사 로그가 없습니다."
                searchKeyword={debouncedSearch || undefined}
                onResetSearch={
                  search || user || actionType || resource || result || startDate || endDate
                    ? () => {
                        setSearch('');
                        setUser(null);
                        setActionType('');
                        setResource('');
                        setResult('');
                        setStartDate('');
                        setEndDate('');
                      }
                    : undefined
                }
              />
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMoreFooter query={logsQuery} root={scrollRoot} data-testid="audit-log-load-more" />

      {/* 감사 로그 상세 보기 다이얼로그 */}
      <AuditLogDetailDialog
        log={selectedLog}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </SettingsPage>
  );
}
