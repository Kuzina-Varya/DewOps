
import { chromium } from "playwright";

export async function scrapeQuotes(url) {
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

    return quotes;
  } finally {
    await browser.close();
  }
}
