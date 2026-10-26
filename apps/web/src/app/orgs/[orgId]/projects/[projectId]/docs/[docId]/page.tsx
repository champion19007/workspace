'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { DocDetail } from '@/components/docs/DocDetail';

export default function ProjectDocDetailPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const docId = params?.docId as string;

  return <DocDetail orgId={orgId} docId={docId} backHref={`/orgs/${orgId}/projects/${projectId}/docs`} />;
}
