'use client';

import React, { useState } from 'react';
import {
  Users,
  Plus,
  ChevronRight,
  FolderGit2,
  Layers,
  UserCheck,
} from 'lucide-react';

interface TeamNode {
  id: string;
  name: string;
  path: string;
  leadName: string;
  memberCount: number;
  projectCount: number;
  description: string;
  members: { name: string; role: string }[];
  projects: { name: string; key: string }[];
}

const INITIAL_TEAMS: TeamNode[] = [
  {
    id: 'team-eng',
    name: 'Engineering',
    path: 'root.eng',
    leadName: 'Alex Mercer',
    memberCount: 5,
    projectCount: 3,
    description: 'Responsible for core backend services, Fastify REST APIs, and database migrations.',
    members: [
      { name: 'Alex Mercer', role: 'Staff Engineer' },
      { name: 'Priya Sharma', role: 'Senior Backend Engineer' },
      { name: 'Rohan Gupta', role: 'Fullstack Engineer' },
    ],
    projects: [
      { name: 'Platform Core & Multi-Tenancy', key: 'CORE' },
      { name: 'Fastify API & Webhooks', key: 'API' },
      { name: 'Organizational Tree', key: 'TREE' },
    ],
  },
  {
    id: 'team-prod',
    name: 'Product & Design',
    path: 'root.prod',
    leadName: 'Priya Sharma',
    memberCount: 3,
    projectCount: 2,
    description: 'Directs user experience, customer journeys, and design partner feedback loops.',
    members: [
      { name: 'Priya Sharma', role: 'Lead Product Manager' },
      { name: 'Elena Rostova', role: 'Product Designer' },
    ],
    projects: [
      { name: 'Design Partner Launch', key: 'DPL' },
      { name: 'Meeting Notes Experience', key: 'MNE' },
    ],
  },
  {
    id: 'team-gtm',
    name: 'Go-to-Market',
    path: 'root.gtm',
    leadName: 'Rohan Gupta',
    memberCount: 2,
    projectCount: 1,
    description: 'Coordinates design partner onboarding and customer success analytics.',
    members: [
      { name: 'Rohan Gupta', role: 'Customer Success Lead' },
    ],
    projects: [
      { name: 'Partner Onboarding', key: 'GTM' },
    ],
  },
];

export default function TeamsPage() {
  const [teams] = useState<TeamNode[]>(INITIAL_TEAMS);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teams[0]?.id || '');

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || teams[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Matching Screenshot 942 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Teams & Organizational Tree
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hierarchical departments and teams mapped using PostgreSQL ltree materialized paths.
          </p>
        </div>

        <button
          onClick={() => alert('Tree node creation will be enabled in Stage 6: Tree Management.')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Team Node</span>
        </button>
      </div>

      {/* Split Directory Layout Matching Screenshot 942 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[550px]">
        {/* Left Pane: Teams Tree List (4 cols) */}
        <div className="lg:col-span-5 rounded-2xl bg-panel border border-border-subtle p-3 space-y-2">
          <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Departments ({teams.length})</span>
            <Layers className="w-3.5 h-3.5 text-accent" />
          </div>

          <div className="space-y-1.5">
            {teams.map((team) => {
              const isSelected = team.id === selectedTeamId;
              return (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeamId(team.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all ${
                    isSelected
                      ? 'bg-panel-elevated border border-accent/40 shadow-sm'
                      : 'hover:bg-panel-elevated/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        isSelected
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-panel-inset text-muted-foreground'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-bold truncate ${
                          isSelected ? 'text-accent' : 'text-foreground'
                        }`}
                      >
                        {team.name}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        ltree: {team.path}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-panel-inset">
                      {team.memberCount} members
                    </span>
                    <ChevronRight
                      className={`w-4 h-4 transition-colors ${
                        isSelected ? 'text-accent' : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Pane: Selected Team Overview (7 cols) */}
        {selectedTeam && (
          <div className="lg:col-span-7 rounded-2xl bg-panel border border-border-subtle p-6 space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              {/* Team Header */}
              <div className="flex items-start justify-between pb-4 border-b border-border-subtle">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent/20 text-accent">
                      {selectedTeam.path}
                    </span>
                    <span className="text-xs text-muted-foreground">Team Node</span>
                  </div>
                  <h2 className="text-xl font-bold text-foreground">{selectedTeam.name}</h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {selectedTeam.description}
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                    Team Lead
                  </div>
                  <div className="text-xs font-bold text-foreground mt-0.5">
                    {selectedTeam.leadName}
                  </div>
                </div>
              </div>

              {/* Owned Projects */}
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <FolderGit2 className="w-3.5 h-3.5 text-accent" />
                  <span>Assigned Projects ({selectedTeam.projects.length})</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {selectedTeam.projects.map((proj) => (
                    <div
                      key={proj.key}
                      className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between"
                    >
                      <span className="text-xs font-semibold text-foreground truncate">
                        {proj.name}
                      </span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-panel-elevated text-accent border border-border-subtle">
                        {proj.key}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Members */}
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5 text-accent" />
                  <span>Team Collaborators ({selectedTeam.members.length})</span>
                </h3>
                <div className="space-y-2">
                  {selectedTeam.members.map((m, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[10px] font-bold text-accent">
                          {m.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-foreground">{m.name}</span>
                      </div>
                      <span className="text-muted-foreground text-[11px]">{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
              <span>Managed under organization tree hierarchy</span>
              <span className="text-accent font-semibold">Stage 6 Foundation</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
