const fs = require("fs");

const API_URL = "http://localhost:5000/predict";

async function predict(imagePath) {
  const base64Image = fs.readFileSync(imagePath).toString("base64");
  const fetch = (await import("node-fetch")).default;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64Image }),
  });

  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

module.exports = { predict };
