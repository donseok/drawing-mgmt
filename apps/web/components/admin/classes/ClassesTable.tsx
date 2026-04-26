'use client';

import * as React from 'react';
import { Search, Plus, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import type { ClassItem } from './types';

interface ClassesTableProps {
  classes: ClassItem[] | undefined;
  isLoading: boolean;
  selectedClassId: string | null;
  onSelectClass: (id: string) => void;
  onCreateClick: () => void;
}

export function ClassesTable({
  classes,
  isLoading,
  selectedClassId,
  onSelectClass,
  onCreateClick,
}: ClassesTableProps) {
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!classes) return [];
    if (!search.trim()) return classes;
    const q = search.trim().toLowerCase();
    return classes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q),
    );
  }, [classes, search]);

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <div className="app-kicker">Admin Console</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">
            자료유형 / 속성
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            자료 유형(Class)과 필수 속성을 관리합니다.
          </p>
        </div>
        <Button onClick={onCreateClick} size="sm" className="shrink-0">
          <Plus className="h-4 w-4" />
          새 자료유형
        </Button>
      </div>

      {/* Search + Table */}
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        <div className="app-panel flex flex-1 flex-col overflow-hidden">
          {/* Panel header with search */}
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            <span className="text-sm font-medium text-fg">
              자료유형 목록
              {classes && (
                <span className="ml-1.5 text-fg-muted">({filtered.length})</span>
              )}
            </span>
            <Input
              placeholder="코드, 명칭, 설명 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-56 text-xs"
              prefix={<Search className="h-3.5 w-3.5" />}
            />
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <Layers className="h-10 w-10 text-fg-subtle" />
                <div>
                  <p className="text-sm font-medium text-fg">
                    {search
                      ? '검색 결과가 없습니다'
                      : '등록된 자료유형이 없습니다'}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {search
                      ? '다른 검색어를 시도해 보세요.'
                      : '새 자료유형을 등록하여 시작하세요.'}
                  </p>
                </div>
                {!search && (
                  <Button onClick={onCreateClick} size="sm" variant="outline">
                    <Plus className="h-4 w-4" />
                    새 자료유형 등록
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">코드</TableHead>
                    <TableHead>명칭</TableHead>
                    <TableHead className="hidden lg:table-cell">설명</TableHead>
                    <TableHead className="w-20 text-center">속성 수</TableHead>
                    <TableHead className="w-24 text-center">사용 자료</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((cls) => (
                    <TableRow
                      key={cls.id}
                      data-state={selectedClassId === cls.id ? 'selected' : undefined}
                      className="cursor-pointer"
                      onClick={() => onSelectClass(cls.id)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {cls.code}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{cls.name}</TableCell>
                      <TableCell className="hidden text-fg-muted lg:table-cell">
                        <span className="line-clamp-1">
                          {cls.description || '-'}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {cls.attributes.length}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            'tabular-nums',
                            cls.objectCount > 0 ? 'text-fg' : 'text-fg-subtle',
                          )}
                        >
                          {cls.objectCount}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
