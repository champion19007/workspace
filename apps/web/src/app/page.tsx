import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CheckCircle2, FolderKanban, Video } from 'lucide-react';
import { BrandMark } from '@/components/ui/auth-frame';

const FEATURES = [
  {
    icon: FolderKanban,
    title: 'Plan the work',
    text: 'Projects with list and board views, shared docs, and a clear view of what is overdue or blocked.',
  },
  {
    icon: Video,
    title: 'Notes from your meetings',
    text: 'Connect Zoom to get notes and suggested action items from the cloud recordings of hosts who opt in.',
  },
  {
    icon: CheckCircle2,
    title: 'You decide what becomes a task',
    text: "Suggestions wait in your inbox until someone approves them. Each organization's data is kept apart.",
  },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Supabase falls back to the Site URL when the callback isn't in its redirect allow-list: finish sign-in anyway.
  const { code } = await searchParams;
  if (typeof code === 'string') redirect(`/api/auth/callback?code=${encodeURIComponent(code)}`);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md font-semibold text-fg">
          <BrandMark />
          Workspace
        </Link>
        <Link href="/auth/login" className="btn btn-secondary btn-sm">
          Sign in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <section className="max-w-2xl space-y-5">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            Projects, meetings and the tasks that come out of them, in one place.
          </h1>
          <p className="text-pretty text-base text-fg-muted">
            Workspace turns your team&apos;s Zoom meetings into notes and suggested tasks, next to the projects they belong to.
            Nothing becomes a task until someone approves it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/auth/login" className="btn btn-primary">
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/orgs" className="btn btn-secondary">
              Go to your organizations
            </Link>
          </div>
        </section>

        <ul className="mt-16 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="card space-y-2 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-subtle text-accent-text">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="font-semibold text-fg">{title}</h2>
              <p className="text-sm text-fg-muted">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
