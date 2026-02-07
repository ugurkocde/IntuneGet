const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const MODE = (process.env.CATEGORIZE_MODE || 'uncategorized').trim().toLowerCase();
const LIMIT = clampInt(process.env.CATEGORIZE_LIMIT, 500, 1, 10000);
const BATCH_SIZE = clampInt(process.env.CATEGORIZE_BATCH_SIZE, 20, 1, 50);
const DRY_RUN = `${process.env.CATEGORIZE_DRY_RUN || 'true'}`.toLowerCase() === 'true';
const MAX_DESCRIPTION_LENGTH = 280;
const RETRIES = 3;
const RETRY_DELAY_MS = 1200;

const ALLOWED_CATEGORIES = [
  'developer-tools',
  'utilities',
  'productivity',
  'communication',
  'browser',
  'security',
  'graphics',
  'media',
  'cloud-storage',
  'system',
  'gaming',
  'runtime',
  'virtualization',
  'collaboration',
  'office',
  'education',
  'business',
  'finance',
  'design',
  'photo',
  'video',
  'audio',
  'backup',
  'networking',
  'database',
  'monitoring',
  'automation',
  'devops',
  'package-management',
  'other',
];

function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(`${raw ?? ''}`, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => `${tag || ''}`.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function prepareRecord(app) {
  return {
    winget_id: app.winget_id,
    name: `${app.name || ''}`.trim(),
    publisher: `${app.publisher || ''}`.trim(),
    description: `${app.description || ''}`.trim().slice(0, MAX_DESCRIPTION_LENGTH),
    tags: normalizeTags(app.tags),
    current_category: app.category || null,
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function buildPrompt(batch) {
  return [
    'Classify each Windows package into one category.',
    'Return one item for every winget_id provided.',
    'Choose the best fitting category. Only use "other" if the software genuinely does not fit any listed category.',
    '',
    'Category definitions:',
    '- developer-tools: IDEs, code editors, linters, debuggers, terminals, SDKs, CLI tools for developers',
    '- utilities: System utilities, file managers, uninstallers, clipboard managers, screen tools',
    '- productivity: Task management, note-taking, time tracking, workflow tools',
    '- communication: Chat, video conferencing, email clients, VoIP',
    '- browser: Web browsers and browser-based tools',
    '- security: Antivirus, firewalls, password managers, encryption, VPNs',
    '- graphics: Image editors, vector tools, 3D modeling, CAD',
    '- media: Media players, streaming, multimedia tools',
    '- cloud-storage: Cloud sync, file sharing, backup-to-cloud services',
    '- system: OS tools, disk management, boot tools, hardware diagnostics, drivers',
    '- gaming: Games, game launchers, game engines, gaming utilities',
    '- runtime: Programming language runtimes, JDKs, .NET runtimes, interpreters',
    '- virtualization: VMs, containers, emulators, sandbox environments',
    '- collaboration: Team workspaces, whiteboards, shared document editing',
    '- office: Office suites, spreadsheets, word processors, PDF tools',
    '- education: Learning platforms, educational software, training tools',
    '- business: CRM, ERP, enterprise management, HR tools',
    '- finance: Accounting, invoicing, financial analysis, trading',
    '- design: UI/UX design, prototyping, wireframing',
    '- photo: Photo editors, RAW processors, photo management',
    '- video: Video editors, screen recorders, video converters',
    '- audio: Audio editors, DAWs, music production, podcast tools',
    '- backup: Local backup, disk imaging, data recovery',
    '- networking: Network monitors, FTP clients, DNS tools, torrent clients',
    '- database: Database clients, DB management tools, SQL editors',
    '- monitoring: System monitors, log viewers, performance dashboards',
    '- automation: Scripting tools, task schedulers, macro recorders, RPA',
    '- devops: CI/CD tools, infrastructure management, deployment tools',
    '- package-management: Package managers, software deployment tools',
    '- other: ONLY for software that truly does not fit any above category',
    '',
    'Packages:',
    JSON.stringify(batch, null, 2),
  ].join('\n');
}

function extractTextResponse(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text;
  }

  if (!Array.isArray(responseJson.output)) {
    return null;
  }

  for (const item of responseJson.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

function buildSchema(expectedSize) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['classifications'],
    properties: {
      classifications: {
        type: 'array',
        minItems: expectedSize,
        maxItems: expectedSize,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['winget_id', 'category', 'confidence'],
          properties: {
            winget_id: { type: 'string' },
            category: { type: 'string', enum: ALLOWED_CATEGORIES },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

async function callOpenAI(batch) {
  const payload = {
    model: MODEL,
    input: [
      {
        role: 'system',
        content:
          'You are an expert software categorizer for enterprise Windows applications. Classify each package into the MOST SPECIFIC category possible. Only use "other" as a last resort when the software truly does not fit any category.',
      },
      {
        role: 'user',
        content: buildPrompt(batch),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'catalog_category_batch',
        strict: true,
        schema: buildSchema(batch.length),
      },
    },
    reasoning: { effort: 'medium' },
  };

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      const retriable = response.status >= 429 || response.status >= 500;
      if (attempt < RETRIES && retriable) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 600)}`);
    }

    const parsed = await response.json();
    const text = extractTextResponse(parsed);
    if (!text) {
      throw new Error('OpenAI response did not include output_text');
    }

    let decoded;
    try {
      decoded = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON in OpenAI output: ${error.message}`);
    }

    const items = Array.isArray(decoded?.classifications) ? decoded.classifications : [];
    return {
      classifications: items,
      usage: parsed.usage || {},
      responseId: parsed.id || null,
    };
  }

  throw new Error('OpenAI retry limit reached');
}

async function fetchApps(supabase) {
  const pageSize = Math.min(LIMIT, 500);
  const results = [];
  let offset = 0;

  while (results.length < LIMIT) {
    const remaining = LIMIT - results.length;
    const batchLimit = Math.min(pageSize, remaining);

    let query = supabase
      .from('curated_apps')
      .select('winget_id, name, publisher, description, tags, category, popularity_rank')
      .eq('is_verified', true)
      .order('popularity_rank', { ascending: true, nullsFirst: false })
      .range(offset, offset + batchLimit - 1);

    if (MODE === 'uncategorized') {
      query = query.is('category', null);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch curated_apps: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    results.push(...data);
    offset += data.length;

    if (data.length < batchLimit) {
      break;
    }
  }

  return results.slice(0, LIMIT);
}

function buildFallbackMap(batch) {
  const map = new Map();
  for (const app of batch) {
    map.set(app.winget_id, { category: 'other', confidence: 0 });
  }
  return map;
}

async function applyUpdates(supabase, updates) {
  let updated = 0;
  for (const item of updates) {
    let query = supabase
      .from('curated_apps')
      .update({
        category: item.category,
        updated_at: new Date().toISOString(),
      })
      .eq('winget_id', item.winget_id);

    if (MODE === 'uncategorized') {
      query = query.is('category', null);
    }

    const { error } = await query;
    if (error) {
      throw new Error(`Failed to update ${item.winget_id}: ${error.message}`);
    }
    updated += 1;
  }
  return updated;
}

function summarizeCategoryCounts(assignments) {
  const counts = {};
  for (const item of assignments) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase credentials');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  if (!['uncategorized', 'all'].includes(MODE)) {
    throw new Error(`Invalid CATEGORIZE_MODE "${MODE}". Use "uncategorized" or "all".`);
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const startedAt = new Date().toISOString();
  const apps = await fetchApps(supabase);
  const prepared = apps.map(prepareRecord);
  const chunks = chunk(prepared, BATCH_SIZE);

  const assignments = [];
  let totalUpdated = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const batch = chunks[i];
    const fallbackMap = buildFallbackMap(batch);

    let response;
    try {
      response = await callOpenAI(batch);
    } catch (error) {
      console.warn(`Batch ${i + 1}/${chunks.length} failed, defaulting to "other": ${error.message}`);
      response = { classifications: [], usage: {} };
    }

    totalInputTokens += Number(response.usage?.input_tokens || 0);
    totalOutputTokens += Number(response.usage?.output_tokens || 0);

    const modelMap = new Map();
    for (const item of response.classifications) {
      if (!item || typeof item.winget_id !== 'string') continue;
      if (!ALLOWED_CATEGORIES.includes(item.category)) continue;
      modelMap.set(item.winget_id, {
        category: item.category,
        confidence:
          typeof item.confidence === 'number' && Number.isFinite(item.confidence)
            ? item.confidence
            : null,
      });
    }

    const batchUpdates = batch.map((app) => ({
      winget_id: app.winget_id,
      category: modelMap.get(app.winget_id)?.category || fallbackMap.get(app.winget_id).category,
      confidence:
        modelMap.get(app.winget_id)?.confidence == null
          ? fallbackMap.get(app.winget_id).confidence
          : modelMap.get(app.winget_id).confidence,
    }));

    console.log(`\n--- Batch ${i + 1}/${chunks.length} (${batchUpdates.length} apps) ---`);
    for (const item of batchUpdates) {
      const flag = item.category === 'other' ? ' [!]' : '';
      console.log(`  ${item.winget_id} -> ${item.category} (confidence: ${item.confidence})${flag}`);
    }

    assignments.push(...batchUpdates);

    if (!DRY_RUN) {
      totalUpdated += await applyUpdates(supabase, batchUpdates);
    }

    if (i < chunks.length - 1) {
      await sleep(200);
    }
  }

  const finishedAt = new Date().toISOString();
  const stats = {
    startedAt,
    finishedAt,
    mode: MODE,
    model: MODEL,
    dryRun: DRY_RUN,
    limit: LIMIT,
    batchSize: BATCH_SIZE,
    processed: prepared.length,
    updated: DRY_RUN ? 0 : totalUpdated,
    categoryCounts: summarizeCategoryCounts(assignments),
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
    sample: assignments.slice(0, 25),
  };

  fs.writeFileSync('./categorize-stats.json', JSON.stringify(stats, null, 2));

  const otherCount = stats.categoryCounts['other'] || 0;
  const otherPct = stats.processed > 0 ? ((otherCount / stats.processed) * 100).toFixed(1) : '0.0';
  console.log(`\n=== Summary ===`);
  console.log(`Category distribution:`);
  for (const [cat, count] of Object.entries(stats.categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`"other" classifications: ${otherCount}/${stats.processed} (${otherPct}%)`);

  console.log(
    JSON.stringify(
      {
        message: DRY_RUN ? 'Dry run completed' : 'Category update completed',
        processed: stats.processed,
        updated: stats.updated,
        mode: stats.mode,
        model: stats.model,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
