'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { DocList } from '@/components/docs/DocList';

interface NodeOption {
  id: string;
  name: string;
  kind: 'team' | 'project';
  visibility: 'public' | 'private';
}

export default function OrgDocsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const [nodes, setNodes] = useState<NodeOption[]>([]);

  useEffect(() => {
    if (!orgId) return;

    fetch(`/api/orgs/${orgId}/tree?depth=10`)
      .then((res) => (res.ok ? res.json() : { nodes: [] }))
      .then((data) => {
        if (data.nodes) {
          const flatNodes: NodeOption[] = [];
          const traverse = (nodeList: Array<NodeOption & { children?: unknown }>) => {
            for (const n of nodeList) {
              flatNodes.push({
                id: n.id,
                name: n.name,
                kind: n.kind,
                visibility: n.visibility,
              });
              if (n.children && Array.isArray(n.children)) {
                traverse(n.children as Array<NodeOption & { children?: unknown }>);
              }
            }
          };
          traverse(data.nodes);
          setNodes(flatNodes);
        }
      })
      .catch((err) => {
        console.error('Failed to load nodes for doc filter:', err);
      });
  }, [orgId]);

  return (
    <div className="space-y-6">
      <DocList orgId={orgId} nodes={nodes} />
    </div>
  );
}
