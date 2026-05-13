/**
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/build-technique-index.ts
 *
 * 读 data/enriched-cutplans/*.json → 构建反向索引 → 写 data/technique-index.json
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { buildTechniqueIndex } from "@/lib/technique-index/build-index";

async function main() {
  const dir = join(process.cwd(), "data", "enriched-cutplans");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  console.log(`[build-index] reading ${files.length} cutplans`);

  const plans: CutPlan[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      plans.push(CutPlanSchema.parse(JSON.parse(raw)));
    } catch (e) {
      console.warn(`  skip ${f}: ${(e as Error).message}`);
    }
  }

  console.log(`[build-index] valid cutplans: ${plans.length}`);
  const idx = buildTechniqueIndex(plans);

  const outPath = join(process.cwd(), "data", "technique-index.json");
  await writeFile(outPath, JSON.stringify(idx, null, 2), "utf-8");

  const tagCount = Object.keys(idx.byTechnique).length;
  const top5 = Object.entries(idx.byTechnique)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  console.log(`[build-index] wrote ${outPath}`);
  console.log(`  total tags: ${tagCount}`);
  console.log(`  top tags:`);
  for (const [tag, ids] of top5) {
    console.log(`    ${tag}: ${ids.length} videos`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
