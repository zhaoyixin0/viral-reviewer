import { getApifyClient } from "@/lib/apify/client";

async function main() {
  const client = getApifyClient();
  // clockworks/tiktok-trends-scraper — region + time window filter, fetch videos category
  const run = await client.actor("clockworks/tiktok-trends-scraper").call({
    countryCode: "US",
    // Input key names are per actor README; adjust if rejected:
    maxItems: 5,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log("run id:", run.id);
  console.log("item count:", items.length);
  console.log("first item shape:");
  console.log(JSON.stringify(items[0], null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
