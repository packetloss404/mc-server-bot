import fs from 'fs';
import path from 'path';

const SKILLS_DIR = './skills';
const INDEX_PATH = path.join(SKILLS_DIR, 'index.json');
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.error('GOOGLE_API_KEY not set');
  process.exit(1);
}

interface SkillEntry {
  name: string;
  description: string;
  keywords: string[];
  file: string;
  quality?: number;
  successCount?: number;
  failureCount?: number;
  embedding?: number[];
}

async function batchEmbed(texts: string[]): Promise<number[][]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${API_KEY}`;

  const requests = texts.map((text) => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 256,
  }));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Embedding API ${resp.status}: ${errBody}`);
  }

  const json: any = await resp.json();
  return json.embeddings.map((e: any) => e.values);
}

async function main() {
  const index: SkillEntry[] = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));

  const needsEmbedding = index.filter((s) => !s.embedding);
  console.log(`${needsEmbedding.length} / ${index.length} skills need embeddings`);

  if (needsEmbedding.length === 0) {
    console.log('All skills already have embeddings');
    return;
  }

  // Batch in groups of 10 (API limit is 100)
  const BATCH_SIZE = 10;
  for (let i = 0; i < needsEmbedding.length; i += BATCH_SIZE) {
    const batch = needsEmbedding.slice(i, i + BATCH_SIZE);
    const texts = batch.map((s) => `${s.name} ${s.description} ${s.keywords.join(' ')}`);

    console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map((s) => s.name).join(', ')}`);

    const embeddings = await batchEmbed(texts);

    for (let j = 0; j < batch.length; j++) {
      const entry = index.find((s) => s.name === batch[j].name)!;
      entry.embedding = embeddings[j];
    }
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  const filled = index.filter((s) => s.embedding).length;
  console.log(`Done. ${filled} / ${index.length} skills now have embeddings`);
}

main().catch(console.error);
