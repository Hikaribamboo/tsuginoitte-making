from __future__ import annotations

from torchvision.models import ResNet18_Weights, resnet18
import torch.nn as nn


def build_resnet18_classifier(num_classes: int, pretrained: bool = True) -> nn.Module:
    weights = ResNet18_Weights.DEFAULT if pretrained else None
    model = resnet18(weights=weights)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    return model
