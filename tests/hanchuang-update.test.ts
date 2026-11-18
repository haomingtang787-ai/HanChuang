import { describe, expect, it } from 'vitest'
import { compareVersions, isSafeExternalUrl, pickSetupAsset, SETUP_ASSET_PATTERN } from '../src/shared/app'

describe('更新检查：版本比较', () => {
  it('新版大于旧版', () => {
    expect(compareVersions('1.4.3', '1.4.2')).toBe(1)
    expect(compareVersions('1.5.0', '1.4.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })

  it('同版本或旧版返回 0 / -1', () => {
    expect(compareVersions('1.4.2', '1.4.2')).toBe(0)
    expect(compareVersions('v1.4.2', '1.4.2')).toBe(0)
    expect(compareVersions('1.4.1', '1.4.2')).toBe(-1)
  })

  it('缺位补零：1.4 与 1.4.0 等价', () => {
    expect(compareVersions('1.4', '1.4.0')).toBe(0)
    expect(compareVersions('1.4.1', '1.4')).toBe(1)
  })
})

describe('更新检查：挑安装包', () => {
  const assets = [
    { name: 'HanChuang-portable-1.4.3.exe', size: 148_000_000, url: 'https://api.github.com/repos/o/r/releases/assets/1' },
    { name: 'HanChuang-setup-1.4.3.exe.blockmap', size: 190_000, url: 'https://api.github.com/repos/o/r/releases/assets/2' },
    { name: 'HanChuang-setup-1.4.3.exe', size: 177_000_000, url: 'https://api.github.com/repos/o/r/releases/assets/3' },
  ]

  it('只认 HanChuang-setup-*.exe，不把便携版或 blockmap 当安装包', () => {
    const picked = pickSetupAsset(assets)
    expect(picked.assetName).toBe('HanChuang-setup-1.4.3.exe')
    expect(picked.assetSize).toBe(177_000_000)
    expect(picked.assetUrl).toContain('/releases/assets/3')
  })

  it('没有安装包时返回三个 null，不抛错', () => {
    expect(pickSetupAsset([assets[0], assets[1]])).toEqual({ assetUrl: null, assetName: null, assetSize: null })
    expect(pickSetupAsset(undefined)).toEqual({ assetUrl: null, assetName: null, assetSize: null })
  })

  it('只有 browser_download_url 时也能拿到地址', () => {
    const picked = pickSetupAsset([{ name: 'HanChuang-setup-1.4.3.exe', browser_download_url: 'https://github.com/o/r/releases/download/v1.4.3/HanChuang-setup-1.4.3.exe' }])
    expect(picked.assetUrl).toBe('https://github.com/o/r/releases/download/v1.4.3/HanChuang-setup-1.4.3.exe')
  })

  it('旧的灯下命名不再被当成寒窗安装包', () => {
    expect(SETUP_ASSET_PATTERN.test('DengXia-setup-1.4.2.exe')).toBe(false)
    expect(SETUP_ASSET_PATTERN.test('HanChuang-setup-1.4.2.exe')).toBe(true)
  })
})

describe('更新检查：打开链接白名单', () => {
  it('允许自己仓库的 release 页与 API', () => {
    expect(isSafeExternalUrl('https://github.com/haomingtang787-ai/HanChuang/releases/tag/v1.4.2')).toBe(true)
    expect(isSafeExternalUrl('https://api.github.com/repos/haomingtang787-ai/HanChuang/releases/latest')).toBe(true)
  })

  it('拦下 http、带账号密码、非 GitHub 站点和奇怪路径', () => {
    expect(isSafeExternalUrl('http://github.com/o/r/releases/tag/v1')).toBe(false)
    expect(isSafeExternalUrl('https://user:pass@github.com/o/r/releases/tag/v1')).toBe(false)
    expect(isSafeExternalUrl('https://evil.example.com/releases/tag/v1')).toBe(false)
    expect(isSafeExternalUrl('https://github.com/o/r/settings')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})
