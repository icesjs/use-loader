import * as path from 'path'
import * as fs from 'fs'
import type webpack from 'webpack'

type RuleLoaderItem = {
  parent: webpack.RuleSetRule[] | webpack.RuleSetUseItem[]
  loader: string
  rule: webpack.RuleSetRule | webpack.RuleSetUseItem
  index: number
  isOneOf: boolean
}
type Matcher = (
  loaderPath: string,
  rule: webpack.RuleSetRule | webpack.RuleSetUseItem,
  rules: webpack.RuleSetRule[] | webpack.RuleSetUseItem[]
) => boolean
type MatchOptions = {
  rules: webpack.RuleSetRule[] | webpack.RuleSetUseItem[]
  rule: webpack.RuleSetRule | webpack.RuleSetUseItem
  use: webpack.RuleSetUse
  index: number
  match: Matcher
}

type PositionHandler = (index: number, isOneOf: boolean, length: number) => number

/**
 * Find the rules that has an loader matched.
 * @param config
 * @param match
 */
export function find(config: webpack.Configuration, match: string | Matcher) {
  const rules = config?.module?.rules
  if (!Array.isArray(rules)) {
    return []
  }
  if (typeof match === 'string') {
    const loader = resolveLoaderPath(match)
    match = (loaderPath: string) => isSameLoader(loaderPath, loader)
  } else if (typeof match !== 'function') {
    throw new Error('Arguments error: second argument is not a string or function')
  }
  return findLoaderRule(rules, (loaderPath: string, rule, rules) =>
    (match as Matcher)(resolveLoaderPath(loaderPath), rule, rules)
  )
}

/**
 * Match the rules that has an loader matched, then add the new rule to the position inside matched rule list.
 * @param config
 * @param matcher
 * @param newRule
 * @param position
 */
export function add(
  config: webpack.Configuration,
  matcher: string | Matcher,
  newRule: any,
  position: PositionHandler
) {
  const matched = find(config, matcher)
  if (matched.length) {
    for (const { parent, index, isOneOf } of matched) {
      parent.splice(position(index, isOneOf, parent.length), 0, newRule)
    }
    return true
  }
  return false
}

/**
 * Add rule config before the rule that matched the loader.
 * @param config
 * @param match
 * @param newRule
 */
export function addBefore(config: webpack.Configuration, match: string | Matcher, newRule: any) {
  return add(config, match, newRule, (x) => (x === -1 ? 0 : x))
}

/**
 * Add rule config after the rule that matched the loader.
 * @param config
 * @param match
 * @param newRule
 */
export function addAfter(config: webpack.Configuration, match: string | Matcher, newRule: any) {
  return add(config, match, newRule, (...args) => (args[0] === -1 ? args[2] : args[0] + 1))
}

function findLoaderRule(rules: webpack.RuleSetRule[], match: Matcher, isOneOf = false) {
  const matched = [] as RuleLoaderItem[]
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index] as any
    if (!rule) {
      continue
    }
    for (const use of ['loader', 'loaders', 'use']) {
      matched.push(
        ...matchRuleSet(
          { use: rule[use] as webpack.RuleSetUse, rules, match, rule, index },
          isOneOf
        )
      )
    }
    if (Array.isArray(rule.oneOf)) {
      matched.push(...findLoaderRule(rule.oneOf, match, true))
    }
    if (Array.isArray(rule.rules)) {
      matched.push(...findLoaderRule(rule.rules, match))
    }
  }

  return matched
}

function matchRuleSet(options: MatchOptions, isOneOf: boolean) {
  const { rules, rule, use, index, match } = options
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
        const rule = { loader: useItem }
        if (match(useItem, rule, use)) {
          matched.push({
            rule,
            index,
            parent: use,
            loader: useItem,
            isOneOf: false,
          })
        }
      } else if (typeof useItem === 'object') {
        // RuleSetLoader
        const ruleSetLoader = useItem.loader
        if (typeof ruleSetLoader === 'string' && match(ruleSetLoader, useItem, use)) {
          matched.push({ parent: use, rule: useItem, loader: ruleSetLoader, index, isOneOf: false })
        }
      }
    }
  } else if (typeof use === 'string') {
    // loader
    if (match(use, rule, rules)) {
      matched.push({ parent: rules, rule, loader: use, index, isOneOf })
    }
  } else if (typeof use === 'object') {
    // RuleSetLoader
    const ruleSetLoader = use.loader
    if (typeof ruleSetLoader === 'string' && match(ruleSetLoader, rule, rules)) {
      matched.push({ parent: rules, rule, loader: ruleSetLoader, index, isOneOf })
    }
  }

  return matched
}

function isSameLoader(x: any, y: any) {
  if (typeof x !== 'string' || typeof y !== 'string') {
    return false
  }
  if (x.replace(/\\/g, '/').toLowerCase() === y.replace(/\\/g, '/').toLowerCase()) {
    return true
  }
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

function getPackageName(file: string) {
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
