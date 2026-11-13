# dsh-model-flatmap

> 一个平铺、无二级菜单的 DeepSeek Harness（DSH）模型选择器：所有模型与推理等级
> 都在同一平面上，没有层层弹层。

[English](./README.md)

## 这是什么

`dsh-model-flatmap` 是一个**纯浏览器端**的 DSH 插件。它把会话输入框中的
`conversation.input.model` 控件替换成一个平铺面板，渲染在 Web GUI 内。面板没有
嵌套的二级菜单：模型网格、当前模型的推理等级，以及智能体协作开关，全部同时可见。

插件**只通过公开的 Client API 读写数据**——每个会话的模型目录、协作设置、以及宿主
的语言文案。宿主部分（`index.js`）不提供任何服务、工具或事件；UI 全部在
`client.js` 中，注册时使用负优先级以在启用期间覆盖原生的 `ModelSelect`。关闭插件
即可无残留地恢复原生控件。

## 功能

- **一块平面。** 触发器打开一个高度上限 320 px 的面板。头部、推理等级行与协作行
  固定常驻，只有模型网格可滚动。
- **全局搜索。** 跨所有 provider 与 family 过滤。过滤后为空的组会被丢弃，不会留下
  空标题。命中排序：前缀优先，其次子串，最后有序字符匹配。
- **分词搜索。** 空白把查询拆成多个 token，每个 token 都要在名称中命中；一次命中的
  排序取决于最弱的那一个 token。
- **按 provider 整体搜索。** 命中某个 *provider*（其 id、目录名或分组标签）时，该
  provider 的整个目录都会保留在网格中。
- **两种分组模式。** 分段控件在 *按 provider* 与 *按 family* 之间切换。分组与搜索彼此
  独立。
- **模型家族。** 内置词典识别 DeepSeek、Grok、Opus、Haiku、Sonnet、Claude、Qwen、
  GLM、Kimi、GPT、Gemini、Llama、Mistral 等。未覆盖的模型按 id 推断；无法判断的归入
  *Others*（永远排在最后）。家族保持平铺，不嵌套。
- **generation 要区分开。** 已注册品牌按 generation 分节：`hy3` 归 `HY3`、`hy4free` /
  `hy4std` / `hy4-preview` 归 `HY4`，裸 `hy` 仍是 `HY`；未注册品牌仍折叠版本后缀。
  词典家族（GPT、Qwen…）不拆 generation。
- **row content 以 provider 为主。** *按 family* 下标题已经说明模型是什么，所以行里
  不再重复家族名，主文本改为 provider name；仅当同一 provider 在同一家族下有多个
  模型时，才补一个由 id 推出的短后缀区分。完整模型名/描述保留在 tooltip。
- **推理等级。** 当前模型的推理等级渲染为一个互斥、可键盘操作的分组（"推理等级"，
  基于 radio 语义）。
- **跟随主题。** 仅使用宿主主题令牌着色，在浅色与深色主题下都正确。

完整行为规格见 [`docs/DETAIL.md`](./docs/DETAIL.md)，设计决策见
[`DECISIONS.md`](./DECISIONS.md)。

## 安装

本包是一个 DSH **bundle**。从 DSH 配置文件的插件管理器安装，或将其放入配置文件的
bundle 目录，由 `dsh` 加载器读取 `cordis.patch.yml`。

```bash
# 示例：把 bundle 装到某个运行中的 profile（路径因安装而异）
cp -r . "<profile>/bundles/dsh-model-flatmap"
```

在配置文件的插件列表中启用或停用本插件即可——关闭 bundle 不会触碰任何原生控件。

## 目录结构

| 路径                 | 用途                                             |
| -------------------- | ------------------------------------------------ |
| `index.js`           | 宿主部分——bundle 入口，运行时不提供任何能力。    |
| `client.js`          | 浏览器部分——完整的平铺选择器 UI。                |
| `cordis.patch.yml`   | 由 `dsh` bundle 加载器应用的 Cordis 补丁。       |
| `locale/en.json`     | 英文文案与元数据。                               |
| `locale/zh.json`     | 简体中文文案与元数据。                           |
| `docs/DETAIL.md`     | 详细行为规格。                                   |
| `test/`              | 通过最小化 hook 运行时驱动的渲染路径测试。       |

## 开发

插件是纯 ES 模块，无需构建步骤。

```bash
# 运行渲染路径测试（无需浏览器）
node --test test/
```

测试直接读取 `client.js`，并通过最小化 hook 运行时驱动真实组件，以捕获崩溃、缺失
区块和错误的列数。

## 许可证

基于 [MIT 许可证](./LICENSE) 发布。
