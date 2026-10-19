import { getCurrentUser } from '@/server/auth/current-user';
import { subscribeToDbChanges } from '@/server/events/bus';

/**
 * Canal temps réel Server-Sent Events : réservé aux utilisateurs
 * authentifiés (cookie de session). Chaque écriture en base déclenche
 * un événement `db` côté client, qui rafraîchit automatiquement les
 * données affichées — les postes des départements restent ainsi à
 * jour sans recharger la page.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Non authentifié', { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let keepAlive: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send('event: hello\ndata: {"status":"connecte"}\n\n');
      unsubscribe = subscribeToDbChanges(() => {
        send(`event: db\ndata: {"t":${Date.now()}}\n\n`);
      });
      keepAlive = setInterval(() => send(': ping\n\n'), 15000);
    },
    cancel() {
      unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
