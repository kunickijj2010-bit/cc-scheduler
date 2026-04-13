import { SB_URL, SB_KEY } from './src/data/config.js';

async function listTables() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/?apikey=${SB_KEY}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

listTables();
