
import { mkdir, writeFile } from "node:fs/promises";
import { scrapeQuotes } from "./scraper.js";

const url = "https://quotes.toscrape.com/scroll";
const outputDirectory = "out";
const outputFile = `${outputDirectory}/result.json`;

async function main() {
  const quotes = await scrapeQuotes(url);

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(quotes, null, 2)}\n`);

  console.log(`Saved ${quotes.length} quotes to ${outputFile}`);
}

main().catch((error) => {
  console.error("Scraping failed:", error);
  process.exitCode = 1;
});
