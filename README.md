# The Plonker

The plonker is a google maps location guesser AI. It is given the location of a google street view image and predicts its location.

## Performance

The plonker achieved an average score of 637km and a median score of 150km on a holdout dataset of around 10,000 images. For reference the median distance of a Geoguessr player in the Champion division, which is made up of the top 0.01% of players, is 151km away.

![alt text](output.png)

## Design

### Data Collection

This model is trained on 277,700 Google Street View panoramas from all over the world. The distrubution of images represents the density of coverage in each area.

### Country Prediction

A classification model with countries as classes is trained on the image dataset. The country model is trained with a TinyVit backbone along with its own custom head. The model predicts the country of a given panorama with 86% accuracy.

### Region Prediction

In order to predict certain regions I created a recursion algorithm to split the world up into varying sized regions based on their amount of street view coverage. Below is an example of the regions created for the United Kingdom and Ireland.

![alt text](<Screenshot 2025-08-26 151148.png>)

Using these regions as classes I trained a second model also with a TinyVit backbone and a custom head. The prediction from this model is cross referenced with the prediction from the country model. If the region in not in the predicted country the next most likely region inside the predicted country is chosen.

## Demo

INSERT VIDEO HERE

## Notes

This project is not meant for production use or replication.
While code is present, weights, labels, and other data is not present in this repository.
