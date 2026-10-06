/**
 * 提交信息规范
 * 见 docs/07-roadmap.md §11
 *
 * 示例：
 *   feat(article): 支持定时发布
 *   fix(module): 修复关闭模块后 sitemap 未更新
 *   docs(readme): 补充部署说明
 *   chore(deps): 升级 prisma 到 6.x
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
