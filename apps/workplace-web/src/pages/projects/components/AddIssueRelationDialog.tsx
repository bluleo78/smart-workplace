// 「＋ 관계 추가」 창(WP-887) — 「이 이슈는…」 말을 고른 뒤 탭 「이슈」(찾기)나 「외부 링크」(주소·키·제목)로 상대를 정한다.
// 같은 창이 외부 링크 수정도 맡는다(editing) — 그때는 외부 링크 탭만, 주소는 바꾸지 않는다(지우고 다시 붙인다).
// 저장 경로: 이슈 탭 + 차단 → 기존 의존성 API(블로커 계산이 그대로라서), 그 밖의 이슈 탭 → 관계 API, 외부 링크 탭 → 외부 링크 API.
// 실패하면 토스트(훅)만 띄우고 창과 입력은 그대로 둔다 — 고쳐서 다시 누를 수 있게.

import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounceValue } from '@/hooks/useDebounceValue';
import {
  BLOCKS_CODE,
  extractKeyFromUrl,
  relatedIssueKey,
  relationOptionKey,
  relationOptions,
} from '@/lib/issueRelations';
import { cn } from '@/lib/utils';
import { hasVisibleText } from '@/lib/visibleText';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useAddIssueDependency } from '../../../hooks/queries/useIssueDependencies';
import {
  LOOKUP_DEBOUNCE_MS,
  useAddIssueExternalLink,
  useAddIssueRelation,
  useIssueLookup,
  useUpdateIssueExternalLink,
} from '../../../hooks/queries/useIssueRelations';
import { useIssueRelationTypes } from '../../../hooks/queries/useIssueRelationTypes';
import type {
  IssueExternalLinkView,
  IssueLookupItem,
  IssueRelationType,
  IssueStatus,
} from '../../../types/issue';
import { IssueStatusBadge } from './IssueStatusBadge';

/** 서버 상한과 같은 길이 — 넘기면 보내기 전에 막는다. */
const MAX_URL = 2000;
const MAX_KEY = 50;
const MAX_TITLE = 300;
/** 외부 주소는 http·https 만(서버도 같은 규칙으로 거절한다) — 공백이 섞이면 주소가 아니다. */
const HTTP_URL = /^https?:\/\/[^\s/?#]+\S*$/i;

type RelationTab = 'issue' | 'external';

export function AddIssueRelationDialog({
  projectKey,
  issueNumber,
  open,
  onOpenChange,
  editing,
}: {
  projectKey: string;
  issueNumber: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 고칠 외부 링크 — 있으면 수정 창(외부 링크 탭만, 주소 고정). */
  editing?: IssueExternalLinkView | null;
}) {
  // 창이 열려 있을 때만 유형을 받는다(레일에 관계가 없으면 아직 안 받았을 수 있다).
  const types = useIssueRelationTypes(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="issue-relation-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? '외부 링크 수정' : '관계 추가'}</DialogTitle>
          <DialogDescription className="sr-only">
            이 이슈와 다른 이슈, 또는 다른 시스템의 이슈 사이 관계를 정합니다.
          </DialogDescription>
        </DialogHeader>
        {/* 본문은 창이 열릴 때마다 새로 마운트돼 입력이 비워진다(Radix 가 닫힌 창 내용을 내린다). */}
        {types.data ? (
          <RelationDialogBody
            projectKey={projectKey}
            issueNumber={issueNumber}
            types={types.data}
            editing={editing ?? null}
            onDone={() => onOpenChange(false)}
          />
        ) : types.isError ? (
          <p className="text-sm text-destructive">관계 유형을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
        ) : (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 창 본문 — 유형 목록을 받은 뒤에 그려 처음 선택지를 바로 정할 수 있게 한다. */
function RelationDialogBody({
  projectKey,
  issueNumber,
  types,
  editing,
  onDone,
}: {
  projectKey: string;
  issueNumber: number;
  types: IssueRelationType[];
  editing: IssueExternalLinkView | null;
  onDone: () => void;
}) {
  // 고치는 링크의 지금 선택지(서버가 준 유형·쪽)는 숨긴 유형이어도 남긴다.
  const allOptions = relationOptions(types, editing ?? undefined);

  const [tab, setTab] = useState<RelationTab>(editing ? 'external' : 'issue');
  // 처음 선택지 — 고치는 중이면 지금 값, 아니면 가장 흔한 「관련」, 없으면(숨김) 첫 선택지.
  const defaultOption =
    allOptions.find((o) => o.typeCode === 'RELATES' && !o.externalOnly) ?? allOptions.find((o) => !o.externalOnly);
  const [optionKey, setOptionKey] = useState<string>(
    editing ? relationOptionKey(editing) : defaultOption ? relationOptionKey(defaultOption) : '',
  );

  // 이슈 탭은 외부 전용 유형(에픽에 속함)을 뺀다.
  const tabOptions = tab === 'issue' ? allOptions.filter((o) => !o.externalOnly) : allOptions;
  const option = tabOptions.find((o) => relationOptionKey(o) === optionKey) ?? null;
  const isBlocks = option?.typeCode === BLOCKS_CODE;

  // 이슈 탭 상태
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<IssueLookupItem | null>(null);
  // 차단은 같은 프로젝트 이슈만 걸 수 있다 — 고른 다른 프로젝트 이슈는 차단인 동안 고르지 않은 것으로 본다.
  const selected = isBlocks && picked?.projectKey !== projectKey ? null : picked;
  // 외부 링크 탭 상태 — 키는 사람이 고치기 전까지 주소에서 자동으로 채운다.
  const [url, setUrl] = useState(editing?.url ?? '');
  const [extKey, setExtKey] = useState(editing?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(editing != null);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [showErrors, setShowErrors] = useState(false);

  const addDependency = useAddIssueDependency(projectKey, issueNumber);
  const addRelation = useAddIssueRelation(projectKey, issueNumber);
  const addExternal = useAddIssueExternalLink(projectKey, issueNumber);
  const updateExternal = useUpdateIssueExternalLink(projectKey, issueNumber);
  const pending = addDependency.isPending || addRelation.isPending || addExternal.isPending || updateExternal.isPending;

  // 탭을 바꿀 때 — 이슈 탭에 없는 선택지(외부 전용)였으면 기본 선택지로 되돌린다.
  const changeTab = (next: RelationTab) => {
    setTab(next);
    if (next === 'issue' && !allOptions.some((o) => relationOptionKey(o) === optionKey && !o.externalOnly)) {
      setOptionKey(defaultOption ? relationOptionKey(defaultOption) : '');
    }
  };

  // 외부 링크 입력 검사 — 누르기 전엔 숨기고, 한 번 누른 뒤부터 보인다.
  const trimmedUrl = url.trim();
  const trimmedTitle = title.trim();
  const urlError = editing
    ? undefined
    : !trimmedUrl
      ? '주소를 입력해 주세요'
      : trimmedUrl.length > MAX_URL || !HTTP_URL.test(trimmedUrl)
        ? 'http:// 또는 https:// 로 시작하는 주소를 입력해 주세요'
        : undefined;
  const keyError = extKey.trim().length > MAX_KEY ? `키는 ${MAX_KEY}자 이하로 입력해 주세요` : undefined;
  // 제로폭 공백·한글 채움처럼 보이지 않는 글자만 있어도 비어 있는 것으로 본다 — 관계 카드에 ↗ 만 남지 않게(WP-1107).
  const titleError = !hasVisibleText(title)
    ? '제목을 입력해 주세요'
    : trimmedTitle.length > MAX_TITLE
      ? `제목은 ${MAX_TITLE}자 이하로 입력해 주세요`
      : undefined;

  // 고를 것을 다 골랐는가 — 단추 활성과 제출이 같은 규칙을 쓴다. 외부 링크 입력 오류는 넣지 않는다(누른 뒤에 오류를 보여 주려고 단추는 켜 둔다).
  const valid = option != null && (tab === 'external' || selected != null);
  const canSubmit = valid && !pending;

  async function submit() {
    if (!valid || !option) return;
    try {
      if (tab === 'issue') {
        if (!selected) return; // valid 가 보장한다 — 타입 좁히기용.
        if (option.typeCode === BLOCKS_CODE) {
          // 차단 — A 쪽(차단 중)이면 이 이슈가 상대를 막는다(blocks), B 쪽이면 상대가 이 이슈를 막는다(blockedBy).
          await addDependency.mutateAsync({
            otherNumber: selected.number,
            direction: option.side === 'source' ? 'blocks' : 'blockedBy',
          });
        } else {
          await addRelation.mutateAsync({
            typeId: option.typeId,
            side: option.side,
            target: { projectKey: selected.projectKey, number: selected.number },
          });
        }
      } else {
        if (urlError || keyError || titleError) {
          setShowErrors(true);
          return;
        }
        const key = extKey.trim() || null;
        if (editing) {
          // 처음 선택지가 서버가 준 쪽이라 지금 고른 쪽을 그대로 보내도 저장된 방향이 뒤집히지 않는다.
          await updateExternal.mutateAsync({
            linkId: editing.id,
            body: { typeId: option.typeId, side: option.side, key, title: trimmedTitle },
          });
        } else {
          await addExternal.mutateAsync({ typeId: option.typeId, side: option.side, url: trimmedUrl, key, title: trimmedTitle });
        }
      }
      onDone();
    } catch {
      // 토스트는 훅이 띄운다 — 창과 입력은 그대로 둔다.
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="issue-relation-type">이 이슈는…</Label>
        <Select value={optionKey} onValueChange={setOptionKey}>
          <SelectTrigger id="issue-relation-type" className="w-full" data-testid="issue-relation-type-select">
            <SelectValue placeholder="관계를 고르세요" />
          </SelectTrigger>
          <SelectContent>
            {tabOptions.map((o) => (
              <SelectItem
                key={relationOptionKey(o)}
                value={relationOptionKey(o)}
                data-testid={`issue-relation-option-${relationOptionKey(o)}`}
              >
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!editing && (
        <Tabs value={tab} onValueChange={(v) => changeTab(v as RelationTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="issue" className="flex-1 pointer-coarse:min-h-11" data-testid="issue-relation-tab-issue">
              이슈
            </TabsTrigger>
            <TabsTrigger value="external" className="flex-1 pointer-coarse:min-h-11" data-testid="issue-relation-tab-external">
              외부 링크
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {tab === 'issue' ? (
        <IssueSearch
          projectKey={projectKey}
          issueNumber={issueNumber}
          sameProjectOnly={isBlocks}
          query={query}
          onQueryChange={setQuery}
          selected={selected}
          onSelect={setPicked}
        />
      ) : (
        <div className="space-y-3">
          <FormField label="주소" htmlFor="issue-relation-url" error={showErrors ? urlError : undefined}>
            <Input
              id="issue-relation-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              disabled={editing != null}
              onChange={(e) => {
                setUrl(e.target.value);
                if (!keyTouched) setExtKey(extractKeyFromUrl(e.target.value) ?? '');
              }}
              data-testid="issue-relation-url"
            />
          </FormField>
          <FormField label="키 (선택)" htmlFor="issue-relation-key" error={showErrors ? keyError : undefined}>
            <Input
              id="issue-relation-key"
              placeholder="예: CL-1867"
              value={extKey}
              onChange={(e) => {
                setExtKey(e.target.value);
                setKeyTouched(true);
              }}
              data-testid="issue-relation-key"
            />
          </FormField>
          <FormField label="제목" htmlFor="issue-relation-title" error={showErrors ? titleError : undefined}>
            <Input
              id="issue-relation-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="issue-relation-title"
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            {editing
              ? '주소는 바꿀 수 없어요. 주소가 다르면 지우고 다시 붙여 주세요.'
              : '키는 주소에서 자동으로 채워 봐요. 제목은 가져오지 않으니 직접 적어 주세요.'}
          </p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" disabled={!canSubmit} data-testid="issue-relation-submit">
          {editing ? '저장' : '추가'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 이슈 탭 — 번호(#12)·키(WPV-28)·제목으로 찾아 하나를 고른다. 결과에서 현재 이슈는 뺀다.
 * 차단이면 같은 프로젝트 이슈만 보인다(차단은 다른 프로젝트로 걸 수 없다).
 */
function IssueSearch({
  projectKey,
  issueNumber,
  sameProjectOnly,
  query,
  onQueryChange,
  selected,
  onSelect,
}: {
  projectKey: string;
  issueNumber: number;
  sameProjectOnly: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  selected: IssueLookupItem | null;
  onSelect: (item: IssueLookupItem | null) => void;
}) {
  const debounced = useDebounceValue(query, LOOKUP_DEBOUNCE_MS);
  // 번호만 쳐도 그대로 묻는다 — 서버가 from(이 프로젝트)의 그 번호를 맨 앞에 두고, 그 번호가 없으면 제목으로 찾는다(「404 페이지」).
  const lookup = useIssueLookup(debounced, projectKey);
  const results = (lookup.data ?? []).filter(
    (i) =>
      !(i.projectKey === projectKey && i.number === issueNumber) &&
      (!sameProjectOnly || i.projectKey === projectKey),
  );
  const searching = query.trim() !== '' && (debounced !== query || lookup.isFetching);

  return (
    <div className="space-y-2">
      <Label htmlFor="issue-relation-search">이슈 찾기</Label>
      <Input
        id="issue-relation-search"
        placeholder="번호(#12)·키(WPV-28)·제목"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        autoComplete="off"
        data-testid="issue-relation-search"
      />
      {/* 결과 — 고정 높이 안에서 스크롤해 창 크기가 들쭉날쭉하지 않게. */}
      <div className="h-48 overflow-y-auto rounded-md border" data-testid="issue-relation-results">
        {query.trim() === '' ? (
          <p className="p-3 text-sm text-muted-foreground">
            {sameProjectOnly ? '차단은 이 프로젝트 이슈와만 걸 수 있어요.' : '다른 프로젝트 이슈도 찾을 수 있어요.'}
          </p>
        ) : results.length > 0 ? (
          <ul role="listbox" aria-label="찾은 이슈" className="p-1">
            {results.map((i) => {
              const isSelected = selected?.projectKey === i.projectKey && selected.number === i.number;
              return (
                <li key={`${i.projectKey}-${i.number}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(isSelected ? null : i)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent pointer-coarse:min-h-11',
                      isSelected && 'bg-selected',
                    )}
                    data-testid={`issue-relation-result-${i.projectKey}-${i.number}`}
                  >
                    {i.type && <IssueTypeBadge type={i.type} size="sm" iconOnly />}
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {relatedIssueKey(i.projectKey, projectKey, i.number)}
                    </span>
                    <span className="flex-1 truncate">{i.title}</span>
                    <IssueStatusBadge status={i.status as IssueStatus} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : searching ? (
          <p className="p-3 text-sm text-muted-foreground">찾는 중…</p>
        ) : lookup.isError ? (
          <p className="p-3 text-sm text-destructive">찾지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            {sameProjectOnly ? '이 프로젝트에서 맞는 이슈가 없어요.' : '맞는 이슈가 없어요.'}
          </p>
        )}
      </div>
      {/* 고른 이슈 — 검색어를 바꿔 목록에서 사라져도 무엇을 걸지 보이게. */}
      <p className="min-h-5 truncate text-xs text-muted-foreground" data-testid="issue-relation-selected">
        {selected
          ? `고른 이슈: ${relatedIssueKey(selected.projectKey, projectKey, selected.number)} ${selected.title}`
          : '목록에서 이슈를 하나 고르세요.'}
      </p>
    </div>
  );
}
