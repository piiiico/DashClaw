#!/usr/bin/env node

/**
 * Seed the "MoltFire + Claude Code Branch Finish" operating loop.
 *
 * Creates (idempotently) the reusable assets the loop runs on:
 *   - Prompt Library : 6 branch-finish templates, each with an active v1.
 *   - Knowledge      : a "Wes Coding Standards" notes collection with 5 items
 *                      (ZERO SLOP, launcher policy, coding standards, DashClaw
 *                      facts, MoltFire preferences). Item bodies live in metadata
 *                      so the runner can search them without an embedding key.
 *   - Workflows      : a draft workflow template linking those resources, visible
 *                      on /workflows.
 *
 * Idempotent: re-running finds existing assets by name/category/slug and skips
 * them — no duplicates, no transactions (Neon HTTP has none).
 *
 * Requires an ADMIN API key (template/version/workflow creation is admin-gated).
 *
 * Usage:
 *   npm run seed:branch-finish                                  # via _run-with-env (.env.local)
 *   DASHCLAW_URL=... DASHCLAW_API_KEY=oc_... node scripts/seed-branch-finish-loop.mjs
 */

import { DashClaw } from '../sdk/dashclaw.js';
import {
  PROMPT_CATEGORY,
  PROMPT_TEMPLATES,
  BRANCH_FINISH_TEMPLATE,
  KNOWLEDGE_COLLECTION,
  KNOWLEDGE_ITEMS,
  WORKFLOW_TEMPLATE,
} from './lib/branch-finish-defs.mjs';

const BASE_URL = process.env.DASHCLAW_URL || process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.DASHCLAW_API_KEY || '';
const AGENT_ID = process.env.DASHCLAW_AGENT_ID || 'branch-finish-seed';

if (!API_KEY) {
  console.error('DASHCLAW_API_KEY is required. Run via `npm run seed:branch-finish` or export it.');
  process.exit(1);
}

const claw = new DashClaw({ baseUrl: BASE_URL, apiKey: API_KEY, agentId: AGENT_ID });

function isAdminError(err) {
  return err?.status === 403 || /admin/i.test(err?.message || '');
}

async function seedPromptTemplates() {
  const { templates = [] } = await claw.listPromptTemplates({ category: PROMPT_CATEGORY });
  const byName = new Map(templates.map((t) => [t.name, t]));
  let created = 0;
  let reused = 0;
  let templateIdForBranchFinish = null;

  for (const def of PROMPT_TEMPLATES) {
    let tmpl = byName.get(def.name);
    if (tmpl) {
      reused++;
    } else {
      const res = await claw.createPromptTemplate({
        name: def.name,
        description: def.description,
        category: PROMPT_CATEGORY,
      });
      tmpl = { id: res.id, name: def.name };
      created++;
    }
    const templateId = tmpl.id || tmpl.template_id;
    if (def.name === BRANCH_FINISH_TEMPLATE) templateIdForBranchFinish = templateId;

    // Ensure exactly one active v1 exists. Only create a version when there are
    // none — re-running must not stack v2, v3, ...
    const { versions = [] } = await claw.listPromptVersions(templateId);
    if (versions.length === 0) {
      const version = await claw.createPromptVersion(templateId, {
        content: def.content,
        changelog: 'Seeded branch-finish template v1',
      });
      await claw.activatePromptVersion(templateId, version.id);
    } else if (!versions.some((v) => v.is_active)) {
      // Versions exist but none active — activate the newest.
      await claw.activatePromptVersion(templateId, versions[0].id);
    }
  }

  console.log(`  Prompt templates: ${created} created, ${reused} reused (category "${PROMPT_CATEGORY}")`);
  return templateIdForBranchFinish;
}

async function seedKnowledge() {
  const { collections = [] } = await claw.listKnowledgeCollections({ limit: 200 });
  let collection = collections.find((c) => c.name === KNOWLEDGE_COLLECTION.name);
  if (collection) {
    console.log(`  Knowledge collection: reused "${collection.name}"`);
  } else {
    const res = await claw.createKnowledgeCollection(KNOWLEDGE_COLLECTION);
    collection = res.collection;
    console.log(`  Knowledge collection: created "${collection.name}"`);
  }
  const collectionId = collection.collection_id || collection.id;

  const { items = [] } = await claw.listKnowledgeCollectionItems(collectionId);
  const existing = new Set(items.map((i) => i.source_uri));
  let added = 0;
  for (const item of KNOWLEDGE_ITEMS) {
    if (existing.has(item.source_uri)) continue;
    await claw.addKnowledgeCollectionItem(collectionId, {
      source_uri: item.source_uri,
      title: item.title,
      mime_type: 'text/markdown',
      metadata: { body: item.body },
    });
    added++;
  }
  console.log(`  Knowledge items: ${added} added, ${items.length} already present`);
  return collectionId;
}

async function seedWorkflow(branchFinishTemplateId, collectionId) {
  const { templates = [] } = await claw.listWorkflowTemplates({ limit: 200 });
  if (templates.some((t) => t.slug === WORKFLOW_TEMPLATE.slug)) {
    console.log(`  Workflow template: reused "${WORKFLOW_TEMPLATE.name}"`);
    return;
  }

  const steps = [
    {
      id: 'search-standards',
      type: 'knowledge_search',
      name: 'Search coding standards',
      config: { collection_id: collectionId, query: 'branch finish standards', top_k: 5 },
    },
    {
      id: 'render-review',
      type: 'prompt',
      name: 'Render branch-finish review',
      config: { prompt_template: `Use the "${BRANCH_FINISH_TEMPLATE}" prompt template to review branch {{branch}}.` },
    },
  ];

  await claw.createWorkflowTemplate({
    ...WORKFLOW_TEMPLATE,
    steps,
    linked_prompt_template_ids: branchFinishTemplateId ? [branchFinishTemplateId] : [],
    linked_knowledge_collection_ids: collectionId ? [collectionId] : [],
    created_by: AGENT_ID,
  });
  console.log(`  Workflow template: created "${WORKFLOW_TEMPLATE.name}" (draft)`);
}

async function main() {
  console.log(`Seeding branch-finish loop against ${BASE_URL} ...`);
  try {
    const branchFinishTemplateId = await seedPromptTemplates();
    const collectionId = await seedKnowledge();
    await seedWorkflow(branchFinishTemplateId, collectionId);
    console.log('\nDone. Run the loop with:  node scripts/branch-finish.mjs --dry-run');
  } catch (err) {
    if (isAdminError(err)) {
      console.error(
        '\nError: seeding requires an ADMIN API key (template/version/workflow creation is admin-gated).\n' +
        `Got: ${err.message}`
      );
    } else {
      console.error(`\nSeed failed: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
