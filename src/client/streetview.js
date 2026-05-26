const fs = require("fs");
const path = require("path");
const https = require("https");
const sharp = require("sharp");

const RETRY_COUNT = 3;
const IMG_DIR = path.join(__dirname, "img");

function log(level, message) {
  console.log(`[${level}] ${message}`);
}

function resetImgDir() {
  if (fs.existsSync(IMG_DIR)) {
    fs.rmSync(IMG_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });
}

async function getImage(panoid, xValue, filename) {
  const url = `https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=apiv3&panoid=${panoid}&output=tile&x=${xValue}&y=0&zoom=1`;
  const filepath = path.join(IMG_DIR, filename);

  return new Promise((resolve) => {
    let attempts = 0;

    function attemptDownload() {
      attempts++;

      const req = https.get(url, { timeout: 30000 }, (response) => {
        if (response.statusCode !== 200) {
          log(
            "WARNING",
            `HTTP ${response.statusCode} for ${filename} (attempt ${attempts})`,
          );
          if (attempts < RETRY_COUNT) return setTimeout(attemptDownload, 2000);
          log(
            "ERROR",
            `Failed to download ${filename} after ${RETRY_COUNT} attempts`,
          );
          return resolve(false);
        }

        const contentType = response.headers["content-type"] || "";
        if (!contentType.startsWith("image/")) {
          log(
            "WARNING",
            `No image data for ${panoid} x=${xValue} (attempt ${attempts})`,
          );
          if (attempts < RETRY_COUNT) return setTimeout(attemptDownload, 2000);
          log(
            "ERROR",
            `Failed to download ${filename} after ${RETRY_COUNT} attempts`,
          );
          return resolve(false);
        }

        const fileStream = fs.createWriteStream(filepath);
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          log("INFO", `Downloaded: ${filename}`);
          resolve(true);
        });
        fileStream.on("error", (error) => {
          log("ERROR", `Error writing ${filename}: ${error.message}`);
          if (attempts < RETRY_COUNT) return setTimeout(attemptDownload, 2000);
          resolve(false);
        });
      });

      req.on("error", (error) => {
        log(
          "ERROR",
          `Error downloading ${filename} (attempt ${attempts}): ${error.message}`,
        );
        if (attempts < RETRY_COUNT) return setTimeout(attemptDownload, 2000);
        resolve(false);
      });

      req.on("timeout", () => {
        req.destroy();
        log("ERROR", `Timeout downloading ${filename} (attempt ${attempts})`);
        if (attempts < RETRY_COUNT) return setTimeout(attemptDownload, 2000);
        resolve(false);
      });
    }

    attemptDownload();
  });
}

async function stitchImages() {
  const firstPath = path.join(IMG_DIR, "first.jpg");
  const secondPath = path.join(IMG_DIR, "second.jpg");
  const outputPath = path.join(IMG_DIR, "stitched.jpg");

  if (!fs.existsSync(firstPath) || !fs.existsSync(secondPath)) {
    console.error("One or both tile images missing, cannot stitch.");
    return false;
  }

  try {
    const { width, height } = await sharp(firstPath).metadata();
    await sharp({
      create: {
        width: width * 2,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        { input: firstPath, top: 0, left: 0 },
        { input: secondPath, top: 0, left: width },
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

module.exports = { resetImgDir, getImage, stitchImages, IMG_DIR };
