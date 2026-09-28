<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wordmark-light.svg">
    <img src="docs/assets/wordmark-light.svg" alt="Rig" width="760">
  </picture>
</p>

<h1 align="center">Rig</h1>
<p align="center">终端 AI 编程智能体 —— 支持 BYOK 自定义模型、托管账号、云端工具、插件生态与 ACP。</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href="docs/examples.md">使用示例</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>
<p align="center">
  <img src="docs/assets/node.svg" alt="Node.js 兼容要求：22.19+, 24.2+, 25, 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="开源协议: MIT"></a>
</p>

在终端里读懂项目、修改代码并运行测试。使用自定义模型（OpenAI、Anthropic、本地端点与中转接口），把搜索、插件和工具集成到同一个统一工作流。

## 快速开始

### 1. 安装 Rig

**npm**（需 **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, 或 26**）：

```bash
npm install -g @shivcdhry/rig
```

重新打开终端并验证安装：

```bash
rig --version
rig --help
```

### 2. 配置模型（BYOK）

支持接入任何兼容 OpenAI 或 Anthropic 规范的模型。设置 API 密钥并添加提供方：

```bash
export RIG_PROVIDER_API_KEY="your-api-key"

rig provider add --name my-provider --base-url https://api.openai.com/v1 \
  --api-format openai-completions --model gpt-4o \
  --api-key-env RIG_PROVIDER_API_KEY --use
```

`--use` 参数会在保存并激活前自动测试连接可用性。

支持协议格式：`openai-completions`, `openai-responses`, 和 `anthropic-messages`。更多示例请查阅[使用示例](docs/examples.md)。

### 3. 开始任务

进入待处理的项目目录：

```bash
cd /path/to/your/project
rig
```

在交互式 TUI 中输入任务描述，或直接从命令行运行：

```bash
rig "查找失败的测试，修复代码实现并验证测试结果。"
```

| 运行模式 | 命令 | 适用场景 |
| --- | --- | --- |
| 交互式 TUI | `rig [prompt]` | 浏览与编辑代码、交互对话、审查变更与权限控制。 |
| Headless | `rig exec [prompt]` | 脚本自动化、CI/CD 流水线、批处理任务与评测。 |
| ACP | `rig acp` | 支持 Agent Client Protocol 的编辑器与客户端集成。 |

### 会话管理

```bash
# 恢复当前工作区的最新会话
rig --continue

# 打开会话选择器
rig --session
```

在 TUI 界面中，输入 `/sessions` 可查看历史记录，`/help` 查看所有快捷键与操作命令。

## 核心功能

| 功能 | 说明 |
| --- | --- |
| **代码编辑与验证** | 读写文件、查看 diff、执行 Shell 命令与测试，具备细粒度权限控制与沙箱隔离。 |
| **多模型支持** | 支持 OpenAI、Anthropic 及任何兼容格式的 API Key 与中转端点。 |
| **扩展与工具** | 内置搜索、MCP (Model Context Protocol)、自定义 Skill 与插件。 |
| **多样化入口** | 终端交互 UI、Headless 自动化执行与 IDE ACP 协议支持。 |

## 源码构建

本地参与 Rig 开发：

```bash
git clone https://github.com/shivcdhry/rig.git
cd rig
pnpm install
pnpm build
pnpm rig
```

从源码直接运行测试：

```bash
node /path/to/rig/dist/cli.js
```

## 许可协议

MIT © Rig 贡献者。详情参阅 [LICENSE](LICENSE)。
