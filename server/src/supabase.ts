// The real CloudClient: supabase-js with the server-only secret key (D10). Nothing here is ever sent to a browser.
import { createClient } from '@supabase/supabase-js';
import type { CloudClient, CloudRow } from './cloudSync.js';

export function supabaseClient(url: string, secretKey: string): CloudClient {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const table = () => sb.from('reports');
  return {
    async ping() {
      const { error } = await table().select('id', { head: true, count: 'exact' }).limit(1);
      if (error) console.error('[cloud] ping failed:', error.message);
      return !error;
    },
    async upsert(rows: CloudRow[]) {
      const { error } = await table().upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },
  };
}
