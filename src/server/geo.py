import json
import random
import time

import geopandas as gpd
from shapely.geometry import Point, Polygon

# fmt: off
country_names = ["Albania", "Andorra", "Antarctica", "Argentina", "Australia", "Austria", "Bangladesh", "Belgium", "United Kingdom", "Bhutan", "Bolivia", "Botswana", "Brazil", "Bulgaria", "Cambodia", "Canada", "Chile", "Australia", "Australia", "Colombia", "Costa Rica", "Croatia", "Netherlands", "Czechia", "Denmark", "Dominican Republic", "Ecuador", "Estonia", "Swaziland", "Denmark", "Finland", "France", "Germany", "Ghana", "United Kingdom", "Greece", "Denmark", "United States", "Guatemala", "China", "Hungary", "Iceland", "India", "Ireland", "United Kingdom", "Israel", "Italy", "Japan", "United Kingdom", "Jordan", "Kazakhstan", "Kenya", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Mexico", "Monaco", "Mongolia", "Montenegro", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Macedonia", "United States", "Norway", "Oman", "Pakistan", "Panama", "Peru", "Philippines", "Poland", "Portugal", "United States", "Qatar", "Romania", "Rwanda", "France", "San Marino", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "Korea, South", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Thailand", "Tunisia", "Turkey", "United States", "Uganda", "Ukraine", "United Arab Emirates", "United States", "Vietnam", "Indonesia", "Malaysia", "Russia", "United Kingdom", "Uruguay",
]
# fmt: on

_gdf = None
_square_labels = None
final_coords = {"lng": 0.0, "lat": 0.0}


def load_geo_data(boundaries_path, label_mapping_path):
    global _gdf, _square_labels

    start = time.time()
    _gdf = gpd.read_file(boundaries_path)
    print(f"Elapsed time loading GeoJSON: {time.time() - start:.2f} seconds")

    start = time.time()
    with open(label_mapping_path, "r") as f:
        _square_labels = json.load(f)
    print(f"Elapsed time loading label mapping: {time.time() - start:.2f} seconds")


def is_square_in_country(square_id, country_id):
    try:
        country = country_names[country_id]
        country_row = _gdf[_gdf["shapeName"] == country]
        country_geometry = country_row.geometry.iloc[0]

        # coord labels are in style "30.0_40.0_50.0_60.0" for min_lat,max_lat,min_lon,max_lon
        square_coords_str = _square_labels.get(str(square_id))
        if not square_coords_str:
            print(f"  Square ID {square_id} not found in mapping")
            return False

        min_lat, max_lat, min_lon, max_lon = map(float, square_coords_str.split("_"))

        square_polygon = Polygon([
            (min_lon, max_lat),
            (max_lon, max_lat),
            (max_lon, min_lat),
            (min_lon, min_lat),
            (min_lon, max_lat),
        ])

        intersects = country_geometry.intersects(square_polygon)
        if intersects:
            global final_coords
            final_coords["lng"] = (min_lon + max_lon) / 2
            final_coords["lat"] = (min_lat + max_lat) / 2
            print(f" Min lat: {min_lat}, Max lat: {max_lat}, Min lon: {min_lon}, Max lon: {max_lon}")
            final_coords["lat"], final_coords["lng"] = _find_point_in_country(
                final_coords["lat"], final_coords["lng"],
                country_geometry, min_lat, max_lat, min_lon, max_lon, 0,
            )
            print(f"  Updated final coordinates: {final_coords}")

        return intersects

    except Exception as e:
        print(f"  Error in is_square_in_country: {e}")
        import traceback
        traceback.print_exc()
        return False


def _find_point_in_country(lat, lng, country_geometry, min_lat, max_lat, min_lon, max_lon, attempts):
    if attempts >= 490:
        print("Max attempts reached, returning random coordinates")
        return lat, lng
    if country_geometry.contains(Point(lng, lat)):
        return lat, lng
    return _find_point_in_country(
        random.uniform(min_lat, max_lat),
        random.uniform(min_lon, max_lon),
        country_geometry, min_lat, max_lat, min_lon, max_lon, attempts + 1,
    )
