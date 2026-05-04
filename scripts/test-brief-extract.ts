import { readFile } from "fs/promises";
import { extractBriefFromPDF } from "@/lib/template-review/brief-extract";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: tsx scripts/test-brief-extract.ts <pdf-path>");
    process.exit(1);
  }
  const buffer = await readFile(path);
  console.log(`Loaded ${buffer.length} bytes from ${path}`);
  const result = await extractBriefFromPDF(buffer);
  console.log("\n=== Extracted ===");
  console.log(JSON.stringify({ ...result, briefSummary: undefined }, null, 2));
  console.log("\n=== Brief Summary (first 500 chars) ===");
  console.log(result.briefSummary.slice(0, 500));
  console.log(
    `\n[briefSummary total length: ${result.briefSummary.length} chars]`,
  );
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
