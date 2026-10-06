/**
 * 提交信息规范
 * 见 docs/07-roadmap.md §11
 *
 * 示例：
 *   feat(article): 支持定时发布
 *   fix(module): 修复关闭模块后 sitemap 未更新
 *   docs(readme): 补充部署说明
 *   design(mockup): 补齐分类与标签管理设计稿
 *   chore(deps): 升级 prisma 到 6.x
 *
 * 说明：额外允许 `design` 类型 —— 本项目的 UI 设计稿（design/ 目录）是一等
 *       交付物，与代码、文档并列，值得独立的提交类别，而不是塞进 docs。
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'design',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
}

export default config
