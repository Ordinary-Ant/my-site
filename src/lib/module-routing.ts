const matches = (path: string, root: string) =>
  path === root || (root !== '/' && path.startsWith(`${root}/`))
/** 当前地址优先，自家地址回用不会构成重定向循环。 */
export function resolveModuleRedirect(
  path: string,
  modules: { key: string; route: string }[],
  aliases: { moduleKey: string; path: string }[],
) {
  if (modules.some((m) => matches(path, m.route))) return null
  const alias = aliases
    .filter((a) => matches(path, a.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!alias) return null
  const current = modules.find((m) => m.key === alias.moduleKey)
  return current ? `${current.route}${path.slice(alias.path.length)}` : null
}
