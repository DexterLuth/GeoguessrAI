const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const https = require("https");

const sharp = require("sharp");

puppeteer.use(StealthPlugin());

const RETRY_COUNT = 3;

function log(level, message) {
  console.log(`[${level}] ${message}`);
}

// Create img directory if it doesn't exist
const imgDir = path.join(__dirname, "img");
if (!fs.existsSync(imgDir)) {
  fs.mkdirSync(imgDir, { recursive: true });
  console.log("Created img directory");
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto("https://www.geoguessr.com/party");

  let ids = [];

  async function prediction(panoId) {
    try {
      //resets img folder
      if (fs.existsSync("./img")) {
        fs.rmSync("./img", { recursive: true, force: true });
        console.log("Folder 'img' deleted successfully.");
      }
      fs.mkdirSync("./img", { recursive: true });
      console.log("Folder 'img' recreated successfully.");
    } catch (err) {
      console.error(`Error managing img folder: ${err}`);
    }
    //downloads and stitches images
    try {
      const result1 = await getImage(panoId, 0, "first.jpg");
      const result2 = await getImage(panoId, 1, "second.jpg");

      if (!result1 || !result2) {
        console.error("Failed to download one or both images");
        return;
      }

      const stitchResult = await stitchImage();
      if (!stitchResult) {
        console.error("Failed to stitch images");
        return;
      }

      const imagePath = "./img/stitched.jpg";
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      // Send to Flask API directly from Node.js instead of browser context
      try {
        const fetch = (await import("node-fetch")).default;
        const response = await fetch("http://localhost:5000/predict", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image: base64Image,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log("Model prediction:", result.square_prediction);
        console.log("Country:", result.country_prediction);
        console.log("Coordinates:", result.coordinates);
        // wait a few secs
        await new Promise((r) => setTimeout(r, 5000));
        // Use the coordinates to interact with the map and make a guess
        await page.evaluate(
          async (lat, lng) => {
            // --- Browser context ---
            const getMapContainer = () => {
              return document.querySelector(
                '[class^="guess-map_canvasContainer__"]'
              );
            };
            const findReactFiber = (el) => {
              const fiberKey = Object.keys(el).find((k) =>
                k.startsWith("__reactFiber$")
              );
              return fiberKey ? el[fiberKey] : null;
            };
            const findMapInstance = () => {
              const el = getMapContainer();
              const fiber = findReactFiber(el);
              if (!fiber) return null;
              let current = fiber;
              for (let i = 0; i < 20 && current; i++) {
                const mapInstance = current.memoizedProps?.map;
                if (mapInstance?.__e3_?.click) {
                  return mapInstance;
                }
                current = current.return;
              }
              return null;
            };
            const map = findMapInstance();
            if (!map || !window.google) {
              console.log("[DEBUG] No map instance or google object found");
              return;
            }
            const latLng = new google.maps.LatLng(lat, lng);
            const event = { latLng };
            google.maps.event.trigger(map, "click", event);
            console.log("[DEBUG] Marker placed at", lat, lng);

            // Wait 500ms before clicking the guess button
            await new Promise((resolve) => setTimeout(resolve, 500));

            const guessButton = document.querySelector(
              'button[data-qa="perform-guess"]'
            );
            if (guessButton) {
              guessButton.click();
              console.log("✅ Clicked guess button");
            }
            // await new Promise((resolve) => setTimeout(resolve, 25000));

            // const continueBtn = document.querySelector(
            //   '[class^="next-link_anchor__CQUJ3 button_link__LWagc button_variantPrimary__u3WzI button_sizeLarge__nKm9V"]'
            // );
            // if (continueBtn) {
            //   continueBtn.click();
            //   console.log("✅ Clicked continue button");
            // }
          },
          result.coordinates.lat,
          result.coordinates.lng
        );
      } catch (fetchError) {
        console.error("Error calling API:", fetchError);
      }
    } catch (error) {
      console.error("Error in prediction function:", error);
    }
  }
  page.on("request", async (request) => {
    const url = request.url();
    if (
      url.includes("https://streetviewpixels-pa.googleapis.com/v1/tile") &&
      url.includes("panoid=")
    ) {
      const match = url.match(/panoid=([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const panoId = match[1];

        // ensures valid panoID by checking response status
        const tileResponse = await page.waitForResponse(
          (response) =>
            response.url().includes(panoId) &&
            response
              .url()
              .includes("https://streetviewpixels-pa.googleapis.com/v1/tile")
        );
        if (tileResponse.status() !== 200) {
          console.log(
            `Invalid PanoID trying again... Status: ${tileResponse.status()}`
          );
        } else {
          //valid response
          if (!ids.includes(panoId)) {
            ids.push(panoId);
            console.log("📍 Added new tile panoID:", panoId);

            prediction(panoId);
          } else {
            console.log("❌ Tile panoID already grabbed, skipping:", panoId);
          }
        }
      }
    }
  });
})();

async function getImage(panoid, xValue, filename) {
  const url = `https://streetviewpixels-pa.googleapis.com/v1/tile?panoid=${panoid}&output=tile&x=${xValue}&y=0&zoom=1`;
  const filepath = path.join("./img", filename);

  return new Promise((resolve) => {
    let attempts = 0;

    function attemptDownload() {
      attempts++;

      const request = https.get(url, { timeout: 30000 }, (response) => {
        // Check if response is successful
        if (response.statusCode !== 200) {
          log(
            "WARNING",
            `HTTP ${response.statusCode} for ${filename} (attempt ${attempts})`
          );
          if (attempts < RETRY_COUNT) {
            setTimeout(attemptDownload, 2000);
          } else {
            log(
              "ERROR",
              `Failed to download ${filename} after ${RETRY_COUNT} attempts`
            );
            resolve(false);
          }
          return;
        }

        // Check if response contains image data
        const contentType = response.headers["content-type"] || "";
        if (!contentType.startsWith("image/")) {
          log(
            "WARNING",
            `No image data for ${panoid} x=${xValue} (attempt ${attempts})`
          );
          if (attempts < RETRY_COUNT) {
            setTimeout(attemptDownload, 2000);
          } else {
            log(
              "ERROR",
              `Failed to download ${filename} after ${RETRY_COUNT} attempts`
            );
            resolve(false);
          }
          return;
        }

        // Download and save the image
        const fileStream = fs.createWriteStream(filepath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          log("INFO", `Downloaded: ${filename}`);
          resolve(true);
        });

        fileStream.on("error", (error) => {
          log("ERROR", `Error writing file ${filename}: ${error.message}`);
          if (attempts < RETRY_COUNT) {
            setTimeout(attemptDownload, 2000);
          } else {
            resolve(false);
          }
        });
      });

      request.on("error", (error) => {
        log(
          "ERROR",
          `Error downloading ${filename} (attempt ${attempts}): ${error.message}`
        );
        if (attempts < RETRY_COUNT) {
          setTimeout(attemptDownload, 2000);
        } else {
          log(
            "ERROR",
            `Failed to download ${filename} after ${RETRY_COUNT} attempts`
          );
          resolve(false);
        }
      });

      request.on("timeout", () => {
        request.destroy();
        log("ERROR", `Timeout downloading ${filename} (attempt ${attempts})`);
        if (attempts < RETRY_COUNT) {
          setTimeout(attemptDownload, 2000);
        } else {
          log(
            "ERROR",
            `Failed to download ${filename} after ${RETRY_COUNT} attempts`
          );
          resolve(false);
        }
      });
    }

    attemptDownload();
  });
}
async function stitchImage() {
  const firstImagePath = path.join("./img", "first.jpg");
  const secondImagePath = path.join("./img", "second.jpg");
  const outputPath = path.join("./img", "stitched.jpg");

  // Check if both images exist
  if (!fs.existsSync(firstImagePath) || !fs.existsSync(secondImagePath)) {
    console.error("One or both images do not exist, cannot stitch.");
    return false;
  }

  try {
    // Get dimensions of the first image
    const firstImage = sharp(firstImagePath);
    const { width, height } = await firstImage.metadata();

    // Create a new image that's twice the width
    const stitchedImage = sharp({
      create: {
        width: width * 2,
        height: height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    });

    // Composite both images side by side
    await stitchedImage
      .composite([
        { input: firstImagePath, top: 0, left: 0 },
        { input: secondImagePath, top: 0, left: width },
      ])
      .jpeg()
      .toFile(outputPath);

    console.log("Images stitched successfully:", outputPath);
    return true;
  } catch (err) {
    console.error("Error stitching images:", err);
    return false;
  }
}
