import base64
import io
import time

import timm
import torch
import torchvision.transforms as transforms
from flask import Flask, jsonify, request
from PIL import Image

from assets import get_asset_paths
from geo import country_names, final_coords, is_square_in_country, load_geo_data
from models import CountryCustomTinyViT, SquareCustomTinyViT

NUM_COUNTRY_CLASSES = len(country_names)
NUM_SQUARE_CLASSES = 3855

app = Flask(__name__)

asset_paths = get_asset_paths()
load_geo_data(asset_paths["country_boundaries"], asset_paths["label_mapping"])


@app.after_request
def after_request(response):
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
    return response


start_time = time.time()
try:
    print("Loading models...")

    backbone_country = timm.create_model("tiny_vit_21m_224", pretrained=True, num_classes=0)
    backbone_square = timm.create_model("tiny_vit_11m_224", pretrained=True, num_classes=0)

    country_model = CountryCustomTinyViT(backbone_country, NUM_COUNTRY_CLASSES)
    square_model = SquareCustomTinyViT(backbone_square, NUM_SQUARE_CLASSES)

    country_model.load_state_dict(torch.load(asset_paths["country_model"], map_location="cpu"))
    square_model.load_state_dict(torch.load(asset_paths["square_model"], map_location="cpu"))

    country_model.eval()
    square_model.eval()
    print("Models loaded successfully")
except Exception as e:
    print(f"Error loading models: {e}")
    raise

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
print(f"Elapsed time loading models: {time.time() - start_time:.2f} seconds")


@app.route("/predict", methods=["POST"])
def predict():
    data = request.json.get("image")
    if not data:
        return jsonify({"error": "No image data"}), 400

    image = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
    input_tensor = transform(image).unsqueeze(0)

    with torch.no_grad():
        country_output = country_model(input_tensor)
        square_output = square_model(input_tensor)

        country_prediction = torch.argmax(country_output, dim=1).item()

        square_probs = torch.softmax(square_output, dim=1)
        sorted_square_indices = torch.argsort(square_probs, dim=1, descending=True).squeeze(0)

        print(f"Country prediction: {country_prediction} ({country_names[country_prediction]})")
        print(f"Top 5 square predictions: {sorted_square_indices[:5].tolist()}")

        valid_square_prediction = None
        for checked, square_idx in enumerate(sorted_square_indices[:NUM_SQUARE_CLASSES], 1):
            candidate = square_idx.item()
            if is_square_in_country(candidate, country_prediction):
                valid_square_prediction = candidate
                print(f"Found valid square: {candidate} after checking {checked} squares")
                break

    response_data = {
        "country_prediction": country_prediction,
        "square_prediction": valid_square_prediction,
        "coordinates": {"lng": final_coords["lng"], "lat": final_coords["lat"]},
    }
    print(f"Final response: {response_data}")
    return jsonify(response_data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
