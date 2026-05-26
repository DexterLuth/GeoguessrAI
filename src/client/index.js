const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");

const { resetImgDir, getImage, stitchImages, IMG_DIR } = require("./streetview");
const { predict } = require("./apiClient");
const { placeGuess } = require("./mapInteract");

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.goto("https://www.geoguessr.com/party");

  const seenIds = new Set();

  page.on("request", async (request) => {
    const url = request.url();
    if (
      !url.includes("https://streetviewpixels-pa.googleapis.com/v1/tile") ||
      !url.includes("panoid=")
    ) return;

    const match = url.match(/panoid=([a-zA-Z0-9-_]+)/);
    if (!match) return;
    const panoId = match[1];

    const tileResponse = await page.waitForResponse(
      (r) => r.url().includes(panoId) && r.url().includes("streetviewpixels-pa.googleapis.com/v1/tile")
    );

    if (tileResponse.status() !== 200) {
      console.log(`Invalid PanoID, status: ${tileResponse.status()}`);
      return;
    }

    if (seenIds.has(panoId)) {
      console.log("Tile panoID already grabbed, skipping:", panoId);
      return;
    }

    seenIds.add(panoId);
    console.log("Added new tile panoID:", panoId);
    runPrediction(page, panoId);
  });
})();

async function runPrediction(page, panoId) {
  try {
    resetImgDir();

    const [ok1, ok2] = await Promise.all([
      getImage(panoId, 0, "first.jpg"),
      getImage(panoId, 1, "second.jpg"),
    ]);

    if (!ok1 || !ok2) {
      console.error("Failed to download one or both tile images");
      return;
    }

    if (!await stitchImages()) {
      console.error("Failed to stitch images");
      return;
    }

    const result = await predict(path.join(IMG_DIR, "stitched.jpg"));
    console.log("Country:", result.country_prediction);
    console.log("Square:", result.square_prediction);
    console.log("Coordinates:", result.coordinates);

    await new Promise((r) => setTimeout(r, 5000));
    await placeGuess(page, result.coordinates.lat, result.coordinates.lng);
  } catch (err) {
    console.error("Error in prediction pipeline:", err);
  }
}
