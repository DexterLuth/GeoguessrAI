const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const rootInput = "../images/imgTestSet";
const rootOutput = "../stitchedTestSetFinal";

// Ensure root output folder exists
if (!fs.existsSync(rootOutput)) {
  fs.mkdirSync(rootOutput);
}

async function stitchImages(imgPath1, imgPath2, outputPath) {
  try {
    const buffer1 = await sharp(imgPath1).toBuffer();
    const buffer2 = await sharp(imgPath2).toBuffer();

    const width = 512 * 2; // images are 512 x 512
    const height = 512;

    await sharp({
      create: {
        width: width,
        height: height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: buffer1, top: 0, left: 0 },
        { input: buffer2, top: 0, left: 512 },
      ])
      .toFile(outputPath);

    console.log(`Saved stitched image: ${outputPath}`);
  } catch (error) {
    console.error("Error stitching:", error);
  }
}

// Get all pairs given a set of images
function getPairs(files) {
  const map = new Map();

  files.forEach((file) => {
    const ext = path.extname(file);
    const base = path.basename(file, ext);

    // Match suffix -0 or -1
    if (base.endsWith("- 0")) {
      // space before number to match filename format
      const prefix = base.slice(0, -2);
      if (!map.has(prefix)) map.set(prefix, {});
      map.get(prefix)["0"] = file;
    } else if (base.endsWith("- 1")) {
      const prefix = base.slice(0, -2);
      if (!map.has(prefix)) map.set(prefix, {});
      map.get(prefix)["1"] = file;
    }
  });

  const pairs = [];
  for (const [prefix, pair] of map.entries()) {
    if (pair["0"] && pair["1"]) {
      pairs.push({ prefix, file0: pair["0"], file1: pair["1"] });
    }
  }
  return pairs;
}

//process certain folder
async function processFolder(inputFolder, outputFolder) {
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const files = fs
    .readdirSync(inputFolder)
    .filter((f) => !fs.statSync(path.join(inputFolder, f)).isDirectory());
  console.log(`Processing folder "${inputFolder}" (${files.length} files)`);

  const pairs = getPairs(files);

  if (pairs.length === 0) {
    console.log(`No matching pairs found in "${inputFolder}".`);
    return;
  }

  for (const { prefix, file0, file1 } of pairs) {
    const path0 = path.join(inputFolder, file0);
    const path1 = path.join(inputFolder, file1);
    const ext = path.extname(file0);

    const outputPath = path.join(outputFolder, `${prefix}${ext}`);
    await stitchImages(path0, path1, outputPath);
  }
}

// Process all subfolders in rootInput
function processAllSubfolders() {
  const subfolders = fs
    .readdirSync(rootInput)
    .filter((file) => fs.statSync(path.join(rootInput, file)).isDirectory());

  subfolders.forEach((subfolder) => {
    const inputFolder = path.join(rootInput, subfolder);
    const outputFolder = path.join(rootOutput, subfolder);

    processFolder(inputFolder, outputFolder);
  });
}

processAllSubfolders();
