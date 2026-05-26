import os
import time
from pathlib import Path

import boto3

COUNTRY_MODEL_PATH = "tinyvit_country.pth"
SQUARE_MODEL_PATH = "tinyvit_squares.pth"
COUNTRY_BOUNDARIES_PATH = "countryBoundaries.geojson"
LABEL_MAPPING_PATH = "label_mapping.json"


def get_asset_paths():
    bucket = os.getenv("AWS_S3_BUCKET")
    prefix = os.getenv("AWS_S3_PREFIX", "").strip("/")

    if not bucket:
        return {
            "country_boundaries": COUNTRY_BOUNDARIES_PATH,
            "label_mapping": LABEL_MAPPING_PATH,
            "country_model": COUNTRY_MODEL_PATH,
            "square_model": SQUARE_MODEL_PATH,
        }

    cache_dir = Path(os.getenv("MODEL_ASSET_DIR", "model_assets"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    file_map = {
        "country_boundaries": COUNTRY_BOUNDARIES_PATH,
        "label_mapping": LABEL_MAPPING_PATH,
        "country_model": COUNTRY_MODEL_PATH,
        "square_model": SQUARE_MODEL_PATH,
    }

    region_name = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    s3 = boto3.client("s3", region_name=region_name)

    resolved_paths = {}
    for asset_name, file_name in file_map.items():
        local_path = cache_dir / file_name
        s3_key = f"{prefix}/{file_name}" if prefix else file_name

        if not local_path.exists():
            start_time = time.time()
            print(f"Downloading s3://{bucket}/{s3_key} -> {local_path}")
            s3.download_file(bucket, s3_key, str(local_path))
            print(f"Downloaded {file_name} in {time.time() - start_time:.2f} seconds")

        resolved_paths[asset_name] = str(local_path)

    return resolved_paths
