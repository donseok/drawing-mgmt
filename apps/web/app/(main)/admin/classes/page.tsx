'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdminSidebar } from '../AdminSidebar';
import { ClassesTable } from '@/components/admin/classes/ClassesTable';
import { ClassDetailPanel } from '@/components/admin/classes/ClassDetailPanel';
import { CreateClassDialog } from '@/components/admin/classes/CreateClassDialog';
import type { ClassItem, CreateClassPayload } from '@/components/admin/classes/types';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

export default function ClassesPage() {
  const queryClient = useQueryClient();

  // ── Classes list query ─────────────────────────────────────────────────
  const {
    data: classes,
    isLoading,
  } = useQuery<ClassItem[]>({
    queryKey: queryKeys.admin.classes(),
    queryFn: () => api.get<ClassItem[]>('/api/v1/admin/classes'),
  });

  // ── Selection state ────────────────────────────────────────────────────
  const [selectedClassId, setSelectedClassId] = React.useState<string | null>(
    null,
  );

  const selectedClass = React.useMemo(
    () => classes?.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  // ── Create class dialog ────────────────────────────────────────────────
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  const createClassMutation = useMutation({
    mutationFn: (payload: CreateClassPayload) =>
      api.post<ClassItem>('/api/v1/admin/classes', payload),
    onSuccess: (created) => {
      toast.success('자료유형이 등록되었습니다.');
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
      // Auto-select the newly created class
      if (created && typeof created === 'object' && 'id' in created) {
        setSelectedClassId((created as ClassItem).id);
      }
    },
    onError: (err: Error) => {
      const msg =
        err instanceof ApiError ? err.message : '등록에 실패했습니다.';
      toast.error(msg);
    },
  });

  const handleCreateSubmit = async (values: CreateClassPayload) => {
    await createClassMutation.mutateAsync(values);
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-1">
        <AdminSidebar />

        <ClassesTable
          classes={classes}
          isLoading={isLoading}
          selectedClassId={selectedClassId}
          onSelectClass={setSelectedClassId}
          onCreateClick={() => setCreateDialogOpen(true)}
        />

        {selectedClass && (
          <ClassDetailPanel
            classItem={selectedClass}
            onClose={() => setSelectedClassId(null)}
            onDeleted={() => setSelectedClassId(null)}
          />
        )}

        <CreateClassDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSubmit={handleCreateSubmit}
        />
      </div>
    </TooltipProvider>
  );
}
