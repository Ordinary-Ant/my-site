# 阶段D分类键盘排序偶发失败调查

日期：2026-10-11。范围仅 `tests/e2e/taxonomy.spec.ts`；没有改分类组件、坐标计算、服务层或键盘传感器的生产行为。

## 复现与根因

全量浏览器验收曾在分类闭环的 `Space → ArrowUp` 失败：拖拽已启动且状态区域显示生活分类自身，方向键后没有命中技术分类。单次重跑通过不能消除此故障。

在原测试上运行桌面分类闭环 `--repeat-each=10`，实际 **9 passed / 1 failed**，失败位置与全量一致。临时记录DOM位置和滚动时再次复现：scrollY=0，三个分类行分别位于283、351、419px，均在视口内，排除滚动及越级候选截断。

继续在同页执行最多30次启动、向上、Escape取消循环，记录真实document keydown注册时间与window冒泡阶段的defaultPrevented。第7次失败的事件顺序：

| 事件 | performance.now (ms) | defaultPrevented |
| --- | ---: | --- |
| Space启动拖拽 | 1980.9 | true |
| ArrowUp | 1993.4 | false |
| 传感器document keydown监听注册 | 1995.8 | — |

前6次方向键均在监听注册后发生，defaultPrevented=true且命中技术分类。失败方向键早于监听安装2.4ms，未进入坐标计算。已安装的分类状态、ARIA pressed及拖拽公告不代表键盘监听已经就绪。

本地依赖 `@dnd-kit/core` 的 `KeyboardSensor.attach()` 先 `handleStart()`，再用 `setTimeout(() => listeners.add(Keydown, handleKeyDown))` 注册后续按键监听。因此Playwright快速合成按键存在可复现的就绪竞态，不能通过修改分类父级过滤或排序策略修复它。

## 最小修正

- 分类桌面用例在自己的页面初始化脚本中记录document keydown监听注册和移除的数量；不替换事件处理函数，也不改变事件传播或定时器。
- Space前记录数量；Space后除原有ARIA与公告断言外，用条件轮询等待实际新增监听，再发送ArrowUp。没有固定sleep、按键重试或失败重跑机制。
- 诊断用循环与日志已移除。原真实API返回200与PostgreSQL顺序断言均保留。
- 多次诊断跑满了测试管理员共享写入限流窗口，产生独立的429夹具失败。登录夹具仅清理该管理员的 `adminwrite:<id>` 桶，沿用已有登录桶清理；没有修改生产限流合同。

## 实际验证

环境：独立 `personal_site_test`，PostgreSQL端口15432，E2E_BASE_URL及NEXT_PUBLIC_SITE_URL均为 `http://localhost:3100`。Playwright启动已有生产构建，每轮结束关闭浏览器并disconnect测试数据库。未读取或覆盖.env，未提交或push。

1. 修正前原单项重复10次：9 passed / 1 failed。
2. 修正前同页循环：第7次出现上表记录的同一方向键丢失故障，RED确证。
3. 加入监听就绪条件后，同页30次启动/向上/取消及最终真实PG排序保存：1 passed (8.7s)，循环全部完成。
4. 移除诊断循环后的最终用例重复10次：**10 passed (35.6s)**。命令：`npx playwright test tests/e2e/taxonomy.spec.ts --project=1440 -g '分类两层CRUD' --repeat-each=10`。
5. 最终文件 `npx eslint tests/e2e/taxonomy.spec.ts` 与 `npx tsc --noEmit` 均退出0；Prettier已格式化。

本项没有运行最终全量96个浏览器用例，也没有对新的生产修改重新构建；整阶段最终全量结果由主验收记录补充。此结论只证明分类测试等待了实际键盘监听就绪，并验证原有同父级排序及真实PG持久化成功。
