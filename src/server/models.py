import torch.nn as nn


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
