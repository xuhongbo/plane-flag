# Plane Prime Feature Contract Action

这个项目是独立 GitHub Action 仓库，用于 Plane 升级前检查 self-hosted `prime-monitor` 是否覆盖当前 `stable` 商业后端的 feature flags。

## 标准用法

1. 把本项目推到一个单独 GitHub 仓库。
2. 如 `artifacts.plane.so` 需要认证，在仓库 secrets 中配置：
   - `PLANE_ARTIFACTS_USERNAME`
   - `PLANE_ARTIFACTS_PASSWORD`
3. 在 GitHub Actions 中手动运行 `Check Plane Stable Feature Contract`；这个 workflow 不需要填写版本，会固定检查当前 `stable` 镜像。
4. 查看 artifact `plane-stable-feature-contract-report`。

报告文件：

- `plane-feature-flags.json`：从当前 stable backend 镜像提取的官方 `FeatureFlag`。
- `prime-monitor-feature-flags.json`：当前自有激活服务契约。
- `missing-feature-flags.json`：必须先同步进自有激活服务的缺失 key。
- `extra-prime-monitor-feature-flags.json`：自有激活服务里多于当前官方 enum 的 key，仅用于审阅。
- `suggested-feature-values.json`：缺失 key 的建议补充值，默认都按 Enterprise 能力置为 `true`。

## 升级闸门

每次决定升级 Plane stable 前，先运行这个 Action。

- 如果 `missing-feature-flags.json` 为空，可以继续本地 prime-monitor 同步、测试环境升级和生产升级。
- 如果非空，先把缺失 key 同步到 `packages/prime-monitor` 的 `featureValues`，更新测试契约并部署自有激活服务，再重新运行 Action。

这个检查只解决“官方新增 feature flag 但自有激活服务未暴露”的问题。workspace 级功能是否启用，例如 `is_work_item_types_enabled`、`is_release_enabled`，仍然要在升级 SOP 里通过官方 API 或后台数据状态单独验收。

## 本地运行

检查 stable 镜像：

```bash
node scripts/check-feature-contract.mjs \
  --backend-image artifacts.plane.so/makeplane/backend-commercial:stable \
  --prime-monitor-feature-file contract/prime-monitor-feature-values.json \
  --out-dir out
```

检查已经提取出的 `flag.py`：

```bash
node scripts/check-feature-contract.mjs \
  --feature-flag-file /path/to/plane/payment/flags/flag.py \
  --prime-monitor-feature-file contract/prime-monitor-feature-values.json \
  --out-dir out
```

如果要直接对某个自有 `prime-monitor.service.ts` 做比对：

```bash
node scripts/check-feature-contract.mjs \
  --backend-image artifacts.plane.so/makeplane/backend-commercial:stable \
  --prime-monitor-feature-file /path/to/packages/prime-monitor/src/modules/prime-monitor/services/prime-monitor.service.ts \
  --out-dir out
```
