# Offline translation / 离线翻译

## English

Lettide runs an ONNX model locally through [Transformers.js](https://huggingface.co/docs/transformers.js/en/index). Download it once in Settings → Translation. Clicking Translated or Compare processes the selected email body on this device. Completed translations are cached in the encrypted mail store. There is no automatic online translation fallback.

- Model: Meta's NLLB-200 distilled 600M, converted to ONNX by Xenova: [model card](https://huggingface.co/Xenova/nllb-200-distilled-600M).
- Pinned revision: `261c31d1a5732c67cdd16d80e8d6088507c7ccea`.
- Download: 916,817,944 bytes of model, tokenizer and configuration files, about 920 MB. These public-file downloads do not contain email text.
- Model license: [Creative Commons Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Model weights retain their own license, independently of Lettide's source license. Model credit: Meta / NLLB team; ONNX conversion: Xenova.
- Reading languages: Simplified Chinese, Traditional Chinese, English, Japanese, Korean and French. Source language is inferred from the text; short or mixed-language text can be misidentified.
- Inference uses the CPU, with remote model loading disabled. Initial loading and generation take time and use memory. Results are machine translations and can contain errors.

The model is stored under the local Lettide data directory in `models`. Model files contain no private messages. Email text and completed translations remain in Lettide's encrypted state file. Normal app updates keep the model directory.

## 中文

叠信通过 Transformers.js 在本机运行 ONNX 翻译模型。在「设置 → 翻译」下载一次后，点击「译文」或「对照」即可处理当前邮件正文。已完成译文保存在本机加密数据中，不自动回退到在线翻译。

使用 Meta NLLB-200 distilled 600M 模型及 Xenova 转换的 ONNX 文件，固定版本与下载量见上方。首次约需下载 920 MB，下载请求不包含邮件正文。模型按其独立的 CC BY-NC 4.0 许可使用，保留 Meta／NLLB 团队及 Xenova 的来源署名，不改变叠信源码许可。

阅读支持简体中文、繁体中文、英文、日文、韩文和法文。源语言自动判断，短句或混合语言可能识别不准。本机 CPU 加载及生成需要时间和内存，机器翻译可能有误。模型位于叠信本机数据目录下的 `models`，正常更新保留；邮件正文和译文继续加密保存。
