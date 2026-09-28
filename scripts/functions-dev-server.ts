// Local stand-in for `supabase functions serve` when the Supabase CLI/Docker is
// unavailable: routes /functions/v1/<name>/... to the real function handlers
// (same code that is deployed). Env comes from the shell / .env.
// Usage: npm run functions:serve   (PORT=54321 by default)
import {handler as publicApi} from '../supabase/functions/public-api/handler.ts';
import {handler as ownerApi} from '../supabase/functions/owner-api/handler.ts';
import {handler as assistant} from '../supabase/functions/assistant/handler.ts';
import {handler as notifyDispatch} from '../supabase/functions/notify-dispatch/handler.ts';

const handlers: Record<string, (req: Request) => Promise<Response>> = {
  'public-api': publicApi,
  'owner-api': ownerApi,
  assistant,
  'notify-dispatch': notifyDispatch,
};

const port = Number(Deno.env.get('PORT') ?? 54321);
Deno.serve({port, hostname: '127.0.0.1', onListen: ({hostname, port}) => console.log(`functions on http://${hostname}:${port}/functions/v1/{${Object.keys(handlers).join(',')}}`)}, (req) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/functions\/v1\/([a-z-]+)(?:\/|$)/);
  const h = m ? handlers[m[1]!] : undefined;
  if (!h) return new Response(JSON.stringify({error: {code: 'not_found'}}), {status: 404, headers: {'Content-Type': 'application/json'}});
  return h(req);
});
