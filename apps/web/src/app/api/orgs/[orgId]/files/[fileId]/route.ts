import { type NextRequest } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { SESSION_COOKIE_NAME, verifyAndRefreshSession } from '@/lib/session';
import { resolveTenantForUser } from '@/lib/resolve-org';
import { problemFromError, problemJson } from '@/lib/problem';
import { deleteFile, getFileForDownload } from '@workspace/db';
import { INLINE_FILE_TYPES, isValidUuid } from '@workspace/core';

/** Sends the file. Only raster images open in the browser; everything else downloads, sandboxed. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string; fileId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, fileId } = await params;
  if (!isValidUuid(fileId)) return problemJson(404, 'NOT_FOUND', 'File not found', instance);
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const file = await getFileForDownload(sql, { orgId: tenant.orgId, userId: session.userId, role: tenant.role, fileId });
    const blob = await ports.blobStore.getObject(file.storageKey).catch(() => null);
    if (!blob) return problemJson(404, 'NOT_FOUND', 'This file is no longer available', instance);

    const inline = INLINE_FILE_TYPES.includes(file.contentType) && request.nextUrl.searchParams.get('download') === null;
    return new Response(Buffer.from(blob.body), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(blob.contentLength),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return problemFromError(err, instance);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ orgId: string; fileId: string }> }) {
  const instance = request.nextUrl.pathname;
  const { session } = verifyAndRefreshSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return problemJson(401, 'UNAUTHORIZED', 'Authentication required', instance);

  const { orgId: orgIdentifier, fileId } = await params;
  if (!isValidUuid(fileId)) return problemJson(404, 'NOT_FOUND', 'File not found', instance);
  const { db, sql, ports } = getServerContext();

  try {
    const tenant = await resolveTenantForUser(db, orgIdentifier, session.userId);
    const { storageKey } = await deleteFile(sql, { orgId: tenant.orgId, actorUserId: session.userId, role: tenant.role, fileId });
    // The row is already gone from every list; a leftover object only costs storage.
    await ports.blobStore.deleteObject(storageKey).catch(() => {});
    return new Response(null, { status: 204 });
  } catch (err) {
    return problemFromError(err, instance);
  }
}
