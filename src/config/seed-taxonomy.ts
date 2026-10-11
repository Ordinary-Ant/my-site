/** 默认slug与管理及导入合同一致；显示名保持中文，不从中文名直接拼接slug。 */
export const SEED_TAGS = [
  { name: 'Next.js', slug: 'nextjs' },
  { name: 'React', slug: 'react' },
  { name: '性能', slug: 'performance' },
  { name: '工程化', slug: 'engineering' },
  { name: '重构', slug: 'refactoring' },
  { name: 'TypeScript', slug: 'typescript' },
] as const
