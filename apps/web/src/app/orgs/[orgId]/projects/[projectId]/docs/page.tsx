'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { DocList } from '@/components/docs/DocList';
import { useShell } from '@/components/shell/shell-context';

export default function ProjectDocsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const { projects } = useShell();
  const project = projects?.find((p) => p.id === projectId);

  return (
    <DocList
      orgId={orgId}
      nodeId={projectId}
      nodes={project ? [{ id: project.id, name: project.name, kind: 'project', visibility: project.visibility }] : []}
    />
  );
}
