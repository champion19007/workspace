import { NextResponse, type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { rateLimited } from '@/lib/rate-limit';
import { createFile, listFiles } from '@workspace/db';
import { ListFilesQuerySchema, MAX_FILE_BYTES, UploadFileFieldsSchema, cleanFileName } from '@workspace/core';

/** A project's files (`nodeId`) or one task's attachments (`taskId`). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const parsed = ListFilesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return problemJson(422, 'VALIDATION_ERROR', 'Choose a project or a task', instance);
    const files = await listFiles(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role, ...parsed.data });
    return NextResponse.json({ files });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

/** Uploads one file (multipart field `file`) to a project, or to a task with `taskId`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier } = await params;
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const limited = await rateLimited(
      [{ key: `uploads:${session.userId}`, limit: 60, windowSeconds: 3600 }],
      instance,
      "You've uploaded a lot of files in the last hour. Please try again a little later."
    );
    if (limited) return limited;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const fields = UploadFileFieldsSchema.safeParse({
      nodeId: form?.get('nodeId') ?? undefined,
      taskId: form?.get('taskId') || undefined,
    });
    if (!(file instanceof File) || !fields.success) {
      return problemJson(422, 'VALIDATION_ERROR', 'Choose a file to upload', instance);
    }
    // In production the in-memory store would lose every file at the next cold start.
    if (process.env.NODE_ENV === 'production' && ports.blobStore.provider === 'in_memory') {
      return problemJson(
        503,
        'STORAGE_NOT_CONFIGURED',
        'File uploads are not set up on this server yet. An administrator needs to connect file storage.',
        instance
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return problemJson(413, 'FILE_TOO_LARGE', `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB`, instance);
    }

    const body = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const created = await createFile(
      sql,
      {
        orgId: tenant.orgId,
        actorUserId: session.userId,
        role: tenant.role,
        ...fields.data,
        name: cleanFileName(file.name),
        contentType,
        sizeBytes: body.byteLength,
      },
      (key) => ports.blobStore.putObject({ key, body, contentType })
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
