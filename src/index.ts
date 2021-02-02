import * as path from 'path'
import * as fs from 'fs'
import type webpack from 'webpack'

interface RuleLoaderItem {
  loader: string
  index: number
  isUseItem: boolean
  isOneOf: boolean
  rule: webpack.RuleSetRule
  siblings: webpack.RuleSetRule[] | webpack.RuleSetUseItem[]
}

type FindMatcher = (item: RuleLoaderItem) => boolean

type MatchOptions = {
  use: webpack.RuleSetUse | undefined
  index: number
  match: FindMatcher
  rule: webpack.RuleSetRule
  siblings: webpack.RuleSetRule[] | webpack.RuleSetUseItem[]
}

export interface MatchParameter extends RuleLoaderItem {
  name: string
}

export type Matcher = (item: MatchParameter) => boolean

export type PositionHandler = (
  index: number,
  length: number,
  isUseItem: boolean,
  isOneOf: boolean
) => number

export type NewRule =
  | webpack.RuleSetRule
  | webpack.RuleSetUseItem
  | ((isUseItem: boolean, isOneOf: boolean) => webpack.RuleSetRule | webpack.RuleSetUseItem)

/**
 * Find the rules that has an loader matched.
 * @param config webpack configuration
 * @param match a function to match the loader
 */
export function find(config: webpack.Configuration, match: string | Matcher) {
  const rules = config?.module?.rules
  if (!Array.isArray(rules)) {
    return []
  }

  if (typeof match === 'string') {
    const loaderPath = resolveLoaderPath(match)
    const loaderName = getPackageName(loaderPath)
    match = ({ loader, name }) => isSamePath(loaderPath, loader) || isSamePackage(loaderName, name)
  } else if (typeof match !== 'function') {
    throw new Error('Arguments error: second argument is not a string or function')
  }

  return findLoaderRule(rules, ({ loader, ...rest }) => {
    const absolutePath = resolveLoaderPath(loader)
    const matcher = match as Matcher
    return matcher({ ...rest, loader: absolutePath, name: getPackageName(absolutePath) })
  })
}

/**
 * Match the rules that has an loader matched, then add the new rule to the position inside matched rule list.
 * @param config webpack config
 * @param matcher a function to match the loader
 * @param newRule a rule config to add
 * @param position if position handler return -1, this rule will not be add
 */
export function add(
  config: webpack.Configuration,
  matcher: string | Matcher,
  newRule: NewRule,
  position: PositionHandler
) {
  const matched = find(config, matcher)
  if (matched.length) {
    for (const { siblings, index, isUseItem, isOneOf } of matched) {
      const pos = getPosition(position, index, siblings.length, isUseItem, isOneOf)
      if (pos !== -1) {
        siblings.splice(pos, 0, getNewRule(newRule, isUseItem, isOneOf) as any)
      }
    }
  } else {
    const { module = { rules: [] } } = config
    const { rules } = module
    if (!config.module) {
      config.module = module
    }
    const pos = getPosition(position, -1, rules.length, false, false)
    if (pos !== -1) {
      rules.splice(pos, 0, getNewRule(newRule, false, false) as any)
    }
  }
}

export default add

/**
 * Add rule config before the rule that matched the loader.
 * If there is no matched, the rule is added to the begin of the rules array.
 * @param config webpack configuration
 * @param match a function to match the loader
 * @param newRule a rule config to add
 */
export function addBefore(
  config: webpack.Configuration,
  match: string | Matcher,
  newRule: NewRule
) {
  return add(config, match, newRule, (x) => (x === -1 ? 0 : x))
}

/**
 * Add rule config after the rule that matched the loader.
 * If there is no matched, the rule is added to the end of the rules array.
 * @param config webpack configuration
 * @param match a function to match the loader
 * @param newRule a rule config to add
 */
export function addAfter(config: webpack.Configuration, match: string | Matcher, newRule: NewRule) {
  return add(config, match, newRule, (...args) => (args[0] === -1 ? args[1] : args[0] + 1))
}

function getPosition(handler: PositionHandler, ...args: Parameters<PositionHandler>) {
  const pos = +handler(...args)
  const length = args[1]
  if (Number.isNaN(pos) || /\./.test(`${pos}`) || pos < -1 || pos > length) {
    throw new Error(
      `Position handler must return a integer value of number between -1 and ${length}`
    )
  }
  return pos
}

function getNewRule(newRule: NewRule, isUseItem: boolean, isOneOf: boolean) {
  const rule = typeof newRule === 'function' ? newRule(isUseItem, isOneOf) : newRule
  if (isUseItem) {
    const useItem = rule as webpack.RuleSetUseItem
    const type = typeof useItem
    if (type !== 'string' && type !== 'object' && type !== 'function') {
      throw new Error(`Rule must as a type of webpack.RuleSetUseItem`)
    }
    if (type === 'object' && typeof (useItem as any).loader !== 'string') {
      throw new Error(`RuleSetLoader must has an property of loader that is type of string`)
    }
  } else {
    const ruleItem = rule as webpack.RuleSetRule
    if (!ruleItem || typeof ruleItem !== 'object') {
      throw new Error(`RuleSetRule must be an object`)
    }
  }
  return rule
}

function findLoaderRule(rules: webpack.RuleSetRule[], match: FindMatcher, isOneOf = false) {
  const matched = [] as RuleLoaderItem[]
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    if (!rule) {
      continue
    }
    for (const use of [rule.loader, rule.loaders, rule.use]) {
      matched.push(...matchRuleSet({ use, siblings: rules, match, rule, index }, isOneOf))
    }
    if (Array.isArray(rule.oneOf)) {
      matched.push(...findLoaderRule(rule.oneOf, match, true))
    }
    if (Array.isArray(rule.rules)) {
      matched.push(...findLoaderRule(rule.rules, match, false))
    }
  }

  return matched
}

function matchRuleSet(options: MatchOptions, isOneOf: boolean) {
  const { siblings, rule, use, index, match } = options
  const matched = [] as RuleLoaderItem[]
  if (!use || typeof use === 'function') {
    return matched
  }
  if (Array.isArray(use)) {
    // RuleSetUseItem
    for (let index = 0; index < use.length; index++) {
      const useItem = use[index]
      if (typeof useItem === 'string') {
        // loader
        const item = {
          rule,
          index,
          loader: useItem,
          isUseItem: true,
          isOneOf: false,
          siblings: use,
        }
        if (match({ ...item })) {
          matched.push(item)
        }
      } else if (typeof useItem === 'object') {
        // RuleSetLoader
        const ruleSetLoader = useItem.loader
        if (typeof ruleSetLoader === 'string') {
          const item = {
            rule,
            index,
            loader: ruleSetLoader,
            isUseItem: true,
            isOneOf: false,
            siblings: use,
          }
          if (match({ ...item })) {
            matched.push(item)
          }
        }
      }
    }
  } else if (typeof use === 'string') {
    // loader
    const item = { loader: use, rule, isUseItem: false, isOneOf, siblings, index }
    if (match({ ...item })) {
      matched.push(item)
    }
  } else if (typeof use === 'object') {
    // RuleSetLoader
    const ruleSetLoader = use.loader
    if (typeof ruleSetLoader === 'string') {
      const item = { loader: ruleSetLoader, rule, isUseItem: false, isOneOf, siblings, index }
      if (match({ ...item })) {
        matched.push(item)
      }
    }
  }

  return matched
}

function getPackageName(file: string) {
  if (!file) {
    return ''
  }
  let dir = file
  do {
    if (path.basename(dir) === 'node_modules') {
      return ''
    }
    const desc = path.join(dir, 'package.json')
    if (fs.existsSync(desc)) {
      return require(desc).name
    }
  } while ((dir = path.dirname(dir)))
}

function resolveLoaderPath(loaderPath: string) {
  if (!path.isAbsolute(loaderPath)) {
    try {
      loaderPath = require.resolve(loaderPath, {
        paths: [process.cwd()],
      })
    } catch (e) {
      loaderPath = ''
    }
  }
  return loaderPath
}

function isSamePath(x: string, y: string) {
  return x.replace(/\\/g, '/').toLowerCase() === y.replace(/\\/g, '/').toLowerCase()
}

function isSamePackage(x: string, y: string) {
  if (path.basename(x) === path.basename(y)) {
    const xName = getPackageName(x)
    const yName = getPackageName(y)
    if (!xName || !yName) {
      return false
    }
    return xName === yName
  }
  return false
}
