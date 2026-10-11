import type { MotionConfig } from '@/config/motion'
export type MotionPreference = 'auto' | 'full' | 'off'
export type MotionCapabilities = {
  reduce: boolean
  preference: MotionPreference
  mobile: boolean
  saveData?: boolean
  hardwareConcurrency?: number
  deviceMemory?: number
}
/** 完整偏好也不能覆盖系统减弱、站点关闭或移动端上限。 */
export function effectiveMotion(config: MotionConfig, info: MotionCapabilities) {
  if (
    info.reduce ||
    info.preference === 'off' ||
    config.preset === 'static' ||
    config.intensity === 'off'
  )
    return 'off'
  let intensity = info.mobile ? config.mobileIntensity : config.intensity
  if (config.intensity === 'subtle' && intensity !== 'off') intensity = 'subtle'
  if (
    config.autoDegrade &&
    (info.saveData ||
      !info.hardwareConcurrency ||
      info.hardwareConcurrency <= 4 ||
      !info.deviceMemory ||
      info.deviceMemory <= 4)
  )
    if (intensity === 'standard') intensity = 'subtle'
  return intensity
}
