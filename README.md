# 习惯打卡 🌱

一个清新简洁的习惯打卡网页：每天打开，点一下打勾，顶部显示"今天完成 X / Y"；每个习惯展示连续打卡天数（🔥 N 天）和最近 7 天的圆点记录。数据存储在 Supabase，手机和电脑实时同步。

- 纯静态网页，无构建工具，原生 HTML / CSS / JS
- 支持：添加 / 重命名 / 删除习惯，勾选与取消勾选，今日进度，连续天数，最近 7 天记录，多端实时同步

## 文件结构

```
index.html       页面结构
css/style.css    样式（清新简洁风）
js/config.js     Supabase 连接配置（部署时填写）
js/app.js        页面逻辑
schema.sql       Supabase 建表脚本
```

## 本地预览

```bash
cd 习惯打卡
python -m http.server 8000
```

浏览器打开 http://localhost:8000 即可。没有配置数据库时会显示黄色提示条。

## 部署步骤

### 1. 创建 Supabase 项目（数据同步）
1. 打开 https://supabase.com 注册 / 登录（免费）。
2. 新建一个项目（区域选 Asia 附近即可，如 Singapore）。
3. 进入项目的 **SQL Editor**，粘贴 `schema.sql` 的全部内容并运行。
4. 进入项目的 **Project Settings → API**，复制 **Project URL** 和 **anon public key**。

### 2. 填写配置
把上一步的两个值填入 `js/config.js`：

```js
window.HABIT_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJ..."
};
```

> URL 和 anon key 都是公开安全的信息，可以放心放在前端。

### 3. 部署到 GitHub Pages
1. 把代码推送到 GitHub 仓库（仓库名如 `habit-check`）。
2. 在仓库 **Settings → Pages**，选择部署分支为 `main`，路径 `/ (root)`，保存。
3. 等待 1-2 分钟后访问 `https://<用户名>.github.io/habit-check/`。

## 使用说明

- 点右上角 **+** 添加习惯（填名称，可选 emoji 图标）。
- 点习惯名称可直接重命名；点卡片右侧 **⋯** 菜单可删除。
- 每天完成一项就点一下圆形勾选按钮；再次点击取消。
- 页面跨零点会自动切换到新的一天，多端打开时改动会实时同步。
