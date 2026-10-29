# Translation / 翻译

## English

Click **Translation** or **Side by side** in an opened message. Lettide translates that message body through Google's anonymous web translation endpoint. You do not need an API key or a model download. Choose the source language if automatic detection is unsuitable and select the target language separately from the interface language.

Only the body of a message you choose to translate is transmitted. The app does not send its subject, sender, recipients, headers, attachments, credentials or mailbox history. The original remains unchanged. Completed results are stored in the encrypted local cache and reused for the same body and language choices.

Short emails use one request. Longer text splits at natural boundaries with at most three requests at a time and one 20-second deadline. Cancel stops that request; another window's translation is independent. If the network or free endpoint is unavailable, retry later. No paid API, assistant call or local model is used as an automatic fallback.

This endpoint is a web transport, not the supported Google Cloud Translation API, and has no availability promise. The Cloud API is a separate product that requires credentials and billing setup. Lettide does not enable billing or attach your Google mailbox token to translation requests.

## 简体中文

打开邮件后点击 **译文** 或 **对照**，叠信通过 Google 的匿名网页翻译入口处理当前正文，无需翻译密钥或模型下载。可选择原文语言与目标语言，和应用的中英文界面设置互不影响。

只发送你选择翻译的这封邮件正文，不发送主题、发件人、收件人、邮件头、附件、凭据或邮箱历史。原文保留，完成的译文在本机加密缓存；正文和语言选择相同时可直接复用。

普通邮件一次请求；较长正文按自然边界分段，最多三个请求同时处理，总等待上限为 20 秒。取消会停止该请求，不影响其他窗口。网络或免费入口不可用时可稍后重试，不自动切换收费 API、AI 助手或本地模型。

网页入口可能限流或变更，没有可用性承诺。Google Cloud Translation 是另一项需要凭据与结算设置的服务；叠信不会启用结算，也不会把 Gmail 的授权令牌用于翻译。
