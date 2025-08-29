import torch
import torch.nn as nn
import timm
import torchvision.transforms as transforms
from PIL import Image
from flask import Flask, request, jsonify
import io
import base64
import geopandas as gpd
from shapely.geometry import Polygon, Point
import json
import random

app = Flask(__name__)
# fmt: off
country_names = ["Albania", "Andorra", "Antarctica", "Argentina", "Australia", "Austria", "Bangladesh", "Belgium", "United Kingdom", "Bhutan", "Bolivia", "Botswana", "Brazil", "Bulgaria", "Cambodia", "Canada", "Chile", "Australia", "Australia", "Colombia", "Costa Rica", "Croatia", "Netherlands", "Czechia", "Denmark", "Dominican Republic", "Ecuador", "Estonia", "Swaziland", "Denmark", "Finland", "France", "Germany", "Ghana", "United Kingdom", "Greece", "Denmark", "United States", "Guatemala", "China", "Hungary", "Iceland", "India", "Ireland", "United Kingdom", "Israel", "Italy", "Japan", "United Kingdom", "Jordan", "Kazakhstan", "Kenya", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Mexico", "Monaco", "Mongolia", "Montenegro", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Macedonia", "United States", "Norway", "Oman", "Pakistan", "Panama", "Peru", "Philippines", "Poland", "Portugal", "United States", "Qatar", "Romania", "Rwanda", "France", "San Marino", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "Korea, South", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Thailand", "Tunisia", "Turkey", "United States", "Uganda", "Ukraine", "United Arab Emirates", "United States", "Vietnam", "Indonesia", "Malaysia", "Russia", "United Kingdom", "Uruguay",
]
# fmt: on
COUNTRY_MODEL_PATH = "tinyvit_country.pth"
SQUARE_MODEL_PATH = "tinyvit_squares.pth"
NUM_COUNTRY_CLASSES = len(country_names)
NUM_SQUARE_CLASSES = 3855
gdf = gpd.read_file("countryBoundaries.geojson")

with open("label_mapping.json", "r") as f:
    sqaureLabels = json.load(f)

finalCoords = {"lng": 0.0, "lat": 0.0}


# CORS headers for all responses
@app.after_request
def after_request(response):
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
    return response


# model architecture for country
class CountryCustomTinyViT(nn.Module):
    def __init__(self, backbone, num_classes):
        super().__init__()
        self.backbone = backbone
        in_features = backbone.num_features
        self.classifier = nn.Sequential(
            nn.Linear(in_features, 512),
            nn.GELU(),
            nn.Dropout(0.5),
            nn.Linear(512, 256),
            nn.GELU(),
            nn.Dropout(0.5),
            nn.Linear(256, num_classes),
        )

    def forward(self, x):
        x = self.backbone(x)
        x = self.classifier(x)
        return x


# model architecture for square
class SquareCustomTinyViT(nn.Module):
    def __init__(self, backbone, num_classes):
        super().__init__()
        self.backbone = backbone
        in_features = backbone.num_features
        self.classifier = nn.Sequential(
            nn.Linear(in_features, 512),
            nn.GELU(),
            nn.Dropout(0.5),
            nn.Linear(512, 256),
            nn.GELU(),
            nn.Dropout(0.5),
            nn.Linear(256, num_classes),
        )

    def forward(self, x):
        x = self.backbone(x)
        x = self.classifier(x)
        return x


try:
    print(f"Loading model...")

    backbone_country = timm.create_model(
        "tiny_vit_21m_224", pretrained=True, num_classes=0
    )
    backbone_square = timm.create_model(
        "tiny_vit_11m_224", pretrained=True, num_classes=0
    )

    countryModel = CountryCustomTinyViT(backbone_country, NUM_COUNTRY_CLASSES)
    squareModel = SquareCustomTinyViT(backbone_square, NUM_SQUARE_CLASSES)

    # Load the state dictionary
    countryModelState = torch.load(COUNTRY_MODEL_PATH, map_location="cpu")
    squareModelState = torch.load(SQUARE_MODEL_PATH, map_location="cpu")

    # Check if the state dict matches the model architecture
    try:
        countryModel.load_state_dict(countryModelState)
        squareModel.load_state_dict(squareModelState)

    except RuntimeError as e:
        print(f"Error loading state dict: {e}")
        raise

    countryModel.eval()
    squareModel.eval()
    print(f"Models loaded successfully")
except Exception as e:
    print(f"Error loading model: {e}")
    raise

# match training transformations
transform = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)


def is_square_in_country(square_id, country_id):

    try:
        country = country_names[country_id]
        # print(f"  Looking for country: {country}")

        country_row = gdf[gdf["shapeName"] == country]

        # Get the first geometry (assuming one country per name)
        country_geometry = country_row.geometry.iloc[0]
        # print(f"  Country geometry type: {type(country_geometry)}")

        # all coord labels are in style "30.0_40.0_50.0_60.0" for min_lat,max_lat,min_lon,max_lon
        square_coords_str = sqaureLabels.get(str(square_id))
        if not square_coords_str:
            print(f"  Square ID {square_id} not found in mapping")
            return False

        square_coord_array = square_coords_str.split("_")

        min_lat, max_lat, min_lon, max_lon = map(float, square_coord_array)
        # print(f"  Square bounds: ({min_lat}, {max_lat}) to ({min_lon}, {max_lon})")

        square_coords = [
            (min_lon, max_lat),  # top-left
            (max_lon, max_lat),  # top-right
            (max_lon, min_lat),  # bottom-right
            (min_lon, min_lat),  # bottom-left
            (min_lon, max_lat),  # close the polygon
        ]

        square_polygon = Polygon(square_coords)

        # Check if the square intersects with the country
        intersects = country_geometry.intersects(square_polygon)
        if intersects:
            global finalCoords
            # Update final coordinates to the center of the square
            finalCoords["lng"] = (min_lon + max_lon) / 2
            finalCoords["lat"] = (min_lat + max_lat) / 2
            print(
                f" Min lat: {min_lat}, Max lat: {max_lat}, Min lon: {min_lon}, Max lon: {max_lon}"
            )
            finalCoords["lat"], finalCoords["lng"] = is_coords_in_country(
                finalCoords["lat"],
                finalCoords["lng"],
                country_geometry,
                min_lat,
                max_lat,
                min_lon,
                max_lon,
                0,  # attempts
            )

            print(f"  Updated final coordinates: {finalCoords}")

        return intersects

    except Exception as e:
        print(f"  Error in is_square_in_country: {e}")
        import traceback

        traceback.print_exc()
        return False


def is_coords_in_country(
    lat, lng, country_geometry, min_lat, max_lat, min_lon, max_lon, attempts
):
    if attempts >= 490:
        print("Max attempts reached, returning random coordinates")
        return lat, lng
    point = Point(lng, lat)
    if country_geometry.contains(point):
        return lat, lng
    else:
        new_lat = random.uniform(min_lat, max_lat)
        new_lng = random.uniform(min_lon, max_lon)
        return is_coords_in_country(
            new_lat,
            new_lng,
            country_geometry,
            min_lat,
            max_lat,
            min_lon,
            max_lon,
            attempts + 1,
        )


@app.route("/predict", methods=["POST"])
def predict():
    data = request.json.get("image")
    if not data:
        return jsonify({"error": "No image data"}), 400

    # Decode base64 image
    image_bytes = base64.b64decode(data)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    input_tensor = transform(image).unsqueeze(0)  # Add batch dimension

    with torch.no_grad():

        country_output = countryModel(input_tensor)
        square_output = squareModel(input_tensor)

        # single country prediction
        country_prediction = torch.argmax(country_output, dim=1).item()

        # many square predictions sorted by confidence
        square_probs = torch.softmax(square_output, dim=1)
        sorted_square_indices = torch.argsort(
            square_probs, dim=1, descending=True
        ).squeeze(0)

        print(
            f"Country prediction: {country_prediction} ({country_names[country_prediction]})"
        )
        print(f"Top 5 square predictions: {sorted_square_indices[:5].tolist()}")

        # Checks for highest confidence square prediction that is valid
        valid_square_prediction = None
        checked_squares = 0

        for square_idx in sorted_square_indices[:NUM_SQUARE_CLASSES]:
            square_candidate = square_idx.item()
            checked_squares += 1

            if is_square_in_country(square_candidate, country_prediction):
                valid_square_prediction = square_candidate
                print(
                    f"Found valid square: {square_candidate} after checking {checked_squares} squares"
                )
                break

    response_data = {
        "country_prediction": country_prediction,
        "square_prediction": valid_square_prediction,
        "coordinates": {"lng": finalCoords["lng"], "lat": finalCoords["lat"]},
    }

    print(f"Final response: {response_data}")
    return jsonify(response_data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
