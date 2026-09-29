import { describe, expect, it } from 'vitest'
import { exeFromCommand, kindFromProgId } from './browser'

describe('kindFromProgId', () => {
  it.each([
    ['ChromeHTML', 'chrome'],
    ['MSEdgeHTM', 'edge'],
    ['FirefoxURL-308046B0AF4A39CB', 'firefox'],
    ['BraveHTML', 'brave'],
    ['OperaStable', 'opera'],
    ['VivaldiHTM', 'vivaldi'],
    ['SomethingElse', 'unknown']
  ])('%s -> %s', (id, kind) => expect(kindFromProgId(id)).toBe(kind))
})

describe('exeFromCommand', () => {
  it('reads a quoted path', () =>
    expect(exeFromCommand('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1')).toBe(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ))
  it('reads an unquoted path', () => expect(exeFromCommand('C:\\x\\app.exe %1')).toBe('C:\\x\\app.exe'))
  it('returns null when there is no exe', () => expect(exeFromCommand('nothing')).toBeNull())
})
