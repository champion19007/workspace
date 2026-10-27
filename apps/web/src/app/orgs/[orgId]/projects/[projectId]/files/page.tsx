'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { isReadOnlyRole } from '@workspace/core';
import { useShell } from '@/components/shell/shell-context';
import { FilePanel } from '@/components/files/FilePanel';

export default function ProjectFilesPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const role = useShell().user?.role;
  const readOnly = isReadOnlyRole(role);

  return (
    <section aria-label="Files" className="space-y-3">
      <p className="text-sm text-fg-muted">
        {readOnly
          ? 'Files the team has shared on this project.'
          : 'Everything shared on this project, including files attached to its tasks.'}
      </p>
      <FilePanel
        orgId={orgId}
        nodeId={projectId}
        canUpload={!readOnly}
        emptyText={readOnly ? 'No files have been shared yet.' : 'No files yet. Upload briefs, designs or contracts here.'}
      />
    </section>
  );
}
