# NPM Pixiv 登录助手

这是 Nai Prompt Manager 的本地 Edge 回调桥。Pixiv 桌面 OAuth 登录完成后会停在官方 HTTPS 白页；本扩展只监听：

`https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback`

捕获到短时授权码后，它会立即提交给 `http://localhost:3000` 的本机 NPM，并把该标签页带回 NPM。扩展不会读取密码、Cookie、网页正文或浏览历史。

## 安装（仅一次）

1. 在 NPM 的 Pixiv 图库点击“打开安装位置”。
2. 在 Edge 扩展页开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本文件夹。
4. 回到 NPM；检测到助手后，登录按钮会自动使用当前 Edge 会话。
