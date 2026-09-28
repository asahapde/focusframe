# Model and license findings

Checked 2026-09-28. This is an engineering reading of public repository metadata, not legal advice.

## What FocusFrame runs

| Item | Value |
| --- | --- |
| Model | DeepGaze IIE (spatial fixation density, free viewing) |
| Code | [`matthias-k/DeepGaze`](https://github.com/matthias-k/DeepGaze), package `deepgaze_pytorch`, pinned to commit `c7db17e2d1d7ea6468ffdee2cfaddf141095dcff` |
| Weights | `deepgaze2e.pth` from the upstream `v1.0.0` release, SHA-256 `49b65724184f43a2b60426c29c12fd2b743b47ad9eb3435d3dd28e50ea4e2585` |
| Center bias | `centerbias_mit1003.npy` from the same release, SHA-256 `051645b7da47884c138e81f28a4afbadd99b6c3262eaf086434a9626e3578be9` |
| Version string returned by the API | `deepgaze_pytorch@c7db17e2+deepgaze2e.pth:sha256-49b65724184f` |

Citation (returned in every analysis response and shown in the UI):

> Linardos, A., Kümmerer, M., Press, O., & Bethge, M. (2021). Calibrated prediction in and out-of-domain for state-of-the-art saliency modeling. [arXiv:2105.12441](https://arxiv.org/abs/2105.12441)

## Following the upstream instructions

The upstream README's DeepGaze IIE example is followed as written:

- The model is built with `deepgaze_pytorch.DeepGazeIIE(pretrained=True)`, and the output is a log density.
- The MIT1003 center bias is resized to the model input with `scipy.ndimage.zoom(..., order=0, mode="nearest")`. It is then renormalized with log-sum-exp and passed as the second input.
- The README notes that the model was trained on MIT1003-like images, which are about 1024 px on the long side. The adapter therefore always rescales input so the long side is 1024 px (Lanczos), whether that means shrinking or enlarging. The response records the exact model input size.

FocusFrame adds these steps on top of the upstream example (`api/focusframe_api/model_adapter.py`):

- It checks the SHA-256 of the weights and center bias before loading.
- Inference runs in `torch.inference_mode()`, with deterministic cuDNN settings.
- The log density is converted to a probability density with log-sum-exp.

## Runtime dependencies pulled by upstream code

When the model is constructed, `deepgaze_pytorch` downloads four ImageNet-pretrained backbones. All of their weights are then overwritten by `deepgaze2e.pth`, but they are still downloaded:

| Backbone | Source |
| --- | --- |
| DenseNet-201, ResNeXt-50 32x4d | `torch.hub.load('pytorch/vision:v0.6.0', ...)` (torchvision, BSD-3-Clause code) |
| EfficientNet-B5 | GitHub release of `lukemelas/EfficientNet-PyTorch` (Apache-2.0 code), vendored upstream |
| ResNet-50 trained on Stylized-ImageNet | Bitbucket, `robert_geirhos/texture-vs-shape-pretrained-models` |

These are pretrained ImageNet weights, and ImageNet's terms restrict use to non-commercial research. The upstream package also imports OpenAI CLIP (MIT license) at import time for a model that FocusFrame does not use. CLIP is pinned to commit `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6`.

## License finding

- The upstream repository has **no LICENSE file**. The GitHub API reports `license: null`.
- In `setup.py`, `license='MIT'` and the MIT trove classifier are both **commented out**.
- Because no license is declared, default copyright applies. There is no explicit grant to use, modify, or redistribute the code or the released weights.
- According to the paper, the weights were trained on eye-tracking datasets (SALICON pretraining, then MIT1003), on top of ImageNet backbones. Each dataset has its own research-oriented terms.

## What FocusFrame does as a result

- It uses the model for **local, non-commercial evaluation and portfolio demonstration only**.
- It does **not** redistribute the weights or code. `python -m focusframe_api.fetch_weights` downloads them from the upstream release into `api/.model-cache/`, which git ignores, and verifies the checksums.
- It attributes the model in the API response (`model.citation`, `model.source_url`, `model.license_note`) and in the UI.
- It is **not cleared for commercial use.** Before any commercial launch, get written permission from the DeepGaze authors or replace the model with one that has an explicit commercial license. The model adapter isolates the swap to one module.
