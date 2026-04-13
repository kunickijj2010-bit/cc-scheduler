import fs from 'fs';
import { SB_URL, SB_KEY } from './src/data/config.js';

async function fetchFromSupabase() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/employees?select=*`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok) {
        console.error('Fetch failed', res.status);
        return null;
    }
    const data = await res.json();
    console.log(`Fetched ${data.length} employees`);
    const ann = data.find(d => d.name.includes('Сафронова'));
    console.log('Anna Safronova in Supabase?', ann);
  } catch (err) {
    console.error(err);
  }
}

fetchFromSupabase();
