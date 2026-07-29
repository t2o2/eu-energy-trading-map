import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=900' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
