import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = "https://quotes.toscrape.com/scroll";
const outputDirectory = "out";
const outputFile = `${outputDirectory}/result.json`;

async function scrapeQuotes() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  try {
    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });

    await page.waitForSelector(".quote");

    let previousCount = 0;
    let unchangedRounds = 0;

    while (unchangedRounds < 3) {
      const currentCount = await page.locator(".quote").count();

      if (currentCount === previousCount) {
        unchangedRounds += 1;
      } else {
        unchangedRounds = 0;
        previousCount = currentCount;
      }

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await page.waitForTimeout(1_000);
    }

    const quotes = await page.locator(".quote").evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.querySelector(".text")?.textContent?.trim() ?? "",
        author: element.querySelector(".author")?.textContent?.trim() ?? "",
        tags: Array.from(element.querySelectorAll(".tag"), (tag) =>
          tag.textContent?.trim() ?? ""
        )
      }))
    );

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(quotes, null, 2)}\n`);

    console.log(`Saved ${quotes.length} quotes to ${outputFile}`);
  } finally {
    await browser.close();
  }
}

scrapeQuotes().catch((error) => {
  console.error("Scraping failed:", error);
  process.exitCode = 1;
});