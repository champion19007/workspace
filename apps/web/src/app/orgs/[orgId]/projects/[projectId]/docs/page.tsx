'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FolderGit2 } from 'lucide-react';
import { DocList } from '@/components/docs/DocList';

interface ProjectInfo {
  id: string;
  name: string;
  kind?: string;
  visibility?: 'public' | 'private';
}

export default function ProjectDocsPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;

  const [project, setProject] = useState<ProjectInfo | null>(null);

  useEffect(() => {
    if (!orgId || !projectId) return;

    fetch(`/api/orgs/${orgId}/projects/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setProject(data);
        }
      })
      .catch(() => {});
  }, [orgId, projectId]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb Header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          onClick={() => router.push(`/orgs/${orgId}/projects`)}
          className="hover:text-accent flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Projects</span>
        </button>
        <span>/</span>
        <Link
          href={`/orgs/${orgId}/projects/${projectId}/tasks`}
          className="hover:text-accent text-foreground font-semibold flex items-center gap-1.5 transition-colors"
        >
          <FolderGit2 className="w-3.5 h-3.5 text-accent" />
          <span>{project?.name || 'Project'}</span>
        </Link>
        <span>/</span>
        <span className="text-muted-foreground">Documents</span>
      </div>

      <DocList
        orgId={orgId}
        nodeId={projectId}
        nodes={
          project
            ? [
                {
                  id: project.id,
                  name: project.name,
                  kind: 'project',
                  visibility: project.visibility || 'public',
                },
              ]
            : []
        }
      />
    </div>
  );
}
