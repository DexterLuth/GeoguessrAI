const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const JSON_FOLDER = "../jsons/jsonTestSet";
const IMG_BASE_FOLDER = "../images/imgTestSet";
const RETRY_COUNT = 3;
const DELAY_MS = 100; // Delay between requests

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${level} - ${message}`;
  console.log(logMessage);

  // write to log file
  fs.appendFileSync("download_log.txt", logMessage + "\n");
}

function createCountryImgFolder(countryName) {
  const countryFolder = path.join(IMG_BASE_FOLDER, countryName);
  if (!fs.existsSync(countryFolder)) {
    fs.mkdirSync(countryFolder, { recursive: true });
    log("INFO", `Created directory: ${countryFolder}`);
  }
  return countryFolder;
}

//Get all JSON files from directory
function getCountryJsonFiles() {
  try {
    if (!fs.existsSync(JSON_FOLDER)) {
      log("ERROR", `JSON folder not found: ${JSON_FOLDER}`);
      return [];
    }

    const files = fs.readdirSync(JSON_FOLDER);
    const jsonFiles = files.filter((file) =>
      file.toLowerCase().endsWith(".json")
    );

    return jsonFiles.map((file) => ({
      filename: file,
      filepath: path.join(JSON_FOLDER, file),
      countryName: path.basename(file, ".json"),
    }));
  } catch (error) {
    log("ERROR", `Error reading JSON folder: ${error.message}`);
    return [];
  }
}

//Load and parse JSON data from file
function loadJsonData(jsonFilePath) {
  try {
    const data = fs.readFileSync(jsonFilePath, "utf8");
    const parsed = JSON.parse(data);
    return parsed.customCoordinates || [];
  } catch (error) {
    if (error.code === "ENOENT") {
      log("ERROR", `JSON file not found: ${jsonFilePath}`);
    } else {
      log("ERROR", `Error parsing JSON: ${error.message}`);
    }
    return [];
  }
}

//Download image from Google Street View API

function downloadImage(panoid, xValue, imgFolder) {
  return new Promise((resolve) => {
    const url = `https://streetviewpixels-pa.googleapis.com/v1/tile?panoid=${panoid}&output=tile&x=${xValue}&y=0&zoom=1`;
    const filename = `${panoid} - ${xValue}.jpg`;
    const filepath = path.join(imgFolder, filename);

    // Skip if file already exists
    if (fs.existsSync(filepath)) {
      log("INFO", `File already exists, skipping: ${filename}`);
      resolve(true);
      return;
    }

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

//for delays between requests
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//run for certain country
async function processCountry(countryInfo) {
  const { filename, filepath, countryName } = countryInfo;

  log("INFO", `Starting processing for country: ${countryName}`);

  // Create country-specific img folder
  const countryImgFolder = createCountryImgFolder(countryName);
  log(
    "INFO",
    `Images for ${countryName} will be saved to: ${path.resolve(
      countryImgFolder
    )}`
  );

  // Load JSON data for this country
  const coordinates = loadJsonData(filepath);
  if (coordinates.length === 0) {
    log("WARNING", `No coordinate data found for ${countryName}. Skipping.`);
    return { country: countryName, totalDownloads: 0, successfulDownloads: 0 };
  }

  log("INFO", `Found ${coordinates.length} locations for ${countryName}`);

  // Download images for each pano ID
  let totalDownloads = 0;
  let successfulDownloads = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    const panoid = coord.panoId;

    if (!panoid) {
      log("WARNING", `No panoId found in coordinate ${i} for ${countryName}`);
      continue;
    }

    // Download both x=0 and x=1 images
    for (const xValue of [0, 1]) {
      totalDownloads++;
      const success = await downloadImage(panoid, xValue, countryImgFolder);
      if (success) {
        successfulDownloads++;
      }
    }

    // Add a small delay to be respectful to the API
    await sleep(DELAY_MS);

    // Progress update every 100 items
    if ((i + 1) % 100 === 0) {
      log(
        "INFO",
        `${countryName} progress: ${i + 1}/${
          coordinates.length
        } locations processed`
      );
    }
  }

  log(
    "INFO",
    `${countryName} complete! ${successfulDownloads}/${totalDownloads} images downloaded`
  );
  return { country: countryName, totalDownloads, successfulDownloads };
}

async function main() {
  log(
    "INFO",
    "Starting Street View image download script for multiple countries"
  );

  // Get all country JSON files
  const countryFiles = getCountryJsonFiles();
  if (countryFiles.length === 0) {
    log("ERROR", "No JSON files found in jsonByCountry folder. Exiting.");
    return;
  }

  log("INFO", `Found ${countryFiles.length} country files to process:`);
  countryFiles.forEach((file) => {
    log("INFO", `  - ${file.countryName} (${file.filename})`);
  });

  // Process each country
  const results = [];
  let overallTotalDownloads = 0;
  let overallSuccessfulDownloads = 0;

  for (let i = 0; i < countryFiles.length; i++) {
    const countryFile = countryFiles[i];
    log(
      "INFO",
      `Processing country ${i + 1}/${countryFiles.length}: ${
        countryFile.countryName
      }`
    );

    const result = await processCountry(countryFile);
    results.push(result);

    overallTotalDownloads += result.totalDownloads;
    overallSuccessfulDownloads += result.successfulDownloads;

    log(
      "INFO",
      `Completed ${countryFile.countryName}. Moving to next country...`
    );

    // Small delay between countries
    await sleep(DELAY_MS * 5);
  }
}

if (require.main === module) {
  main().catch((error) => {
    log("ERROR", `Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
