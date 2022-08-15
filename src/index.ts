import * as path from 'path'
import * as fs from 'fs'
import {
  Compiler,
  Configuration,
  RuleSetLoader,
  RuleSetRule,
  RuleSetUse,
  RuleSetUseItem,
} from 'webpack'

interface RuleLoaderItem extends RuleSetLoader {
  loader?: string
  index: number
  isUseItem: boolean
  isOneOf: boolean
  rule: RuleSetRule
  parent: RuleSetRule | null
  siblings: RuleSetRule[] | RuleSetUseItem[]
  // webpack5
  type?: string
}

type NewRuleItems = RuleSetRule | RuleSetRule[] | RuleSetUseItem | RuleSetUseItem[]

type FindMatcher = (item: RuleLoaderItem) => boolean

type ParentMatcher = (ruleSet: RuleSetRule, ruleSetParent: RuleSetRule | null) => boolean

type MatchOptions = {
  use: RuleSetUse | undefined
  index: number
  match: FindMatcher
  rule: RuleSetRule
  parent: RuleSetRule | null
  siblings: RuleSetRule[] | RuleSetUseItem[]
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

export type NewRule = NewRuleItems | ((isUseItem: boolean, isOneOf: boolean) => NewRuleItems)

export type RuleTestResource = {
  resource?: string
  realResource?: string
  resourceQuery?: string
  compiler?: Compiler
  issuer?: string
  [p: string]: any
}

export type CssRuleTestOptions = {
  module?: boolean
  onlyModule?: boolean
  syntax?: string
  data?: RuleTestResource
}

/**
 * Find the rules that has a loader matched.
 * @param config webpack configuration
 * @param match a function to match the loader
 * @param parentMatcher a function to match the parent rule, optional
 */
export function findLoader(
  config: Configuration,
  match: string | Matcher,
  parentMatcher?: ParentMatcher | null
) {
  const rules = config?.module?.rules
  if (!Array.isArray(rules)) {
    return []
  }

  if (typeof match === 'string') {
    const loaderPath = resolveLoaderPath(match)
    const loaderName = getPackageName(loaderPath)
    match = ({ loader, name }) =>
      typeof loader === 'string' &&
      (isSamePath(loaderPath, loader) || isSamePackage(loaderName, name))
  } else if (typeof match !== 'function') {
    throw new Error('Arguments error: second argument is not a string or function')
  }

  return findLoaderRule(
    rules,
    ({ loader, ...rest }) => {
      const absolutePath = typeof loader === 'string' ? resolveLoaderPath(loader) : undefined
      const matcher = match as Matcher
      return matcher({
        ...rest,
        loader: absolutePath,
        name: absolutePath ? getPackageName(absolutePath) : '',
      })
    },
    parentMatcher || null,
    null,
    false
  )
}

/**
 * Match the rules that has an loader matched, then add the new rule to the position inside matched rule list.
 * @param config webpack config
 * @param matcher a function to match the loader
 * @param newRule a rule or rule list to add
 * @param position if position handler return -1, this rule will not be add
 */
export function addLoader(
  config: Configuration,
  matcher: string | Matcher,
  newRule: NewRule,
  position: PositionHandler
) {
  const matched = findLoader(config, matcher)
  if (matched.length) {
    for (const { siblings, index, isUseItem, isOneOf } of matched) {
      const pos = getPosition(position, index, siblings.length, isUseItem, isOneOf)
      if (pos !== -1) {
        addNewLoader(newRule, siblings, pos, isUseItem, isOneOf)
      }
    }
  } else {
    const { module = { rules: [] } } = config
    const { rules = [] } = module
    if (!config.module) {
      config.module = module
    }
    const pos = getPosition(position, -1, rules.length, false, false)
    if (pos !== -1) {
      addNewLoader(newRule, rules, pos, false, false)
    }
  }
}

/**
 * Add rule config before the rule that matched the loader.
 * If there is no matched, the rule is added to the begin of the rules array.
 * @param config webpack configuration
 * @param match a function to match the loader
 * @param newRule a rule or rule list to add
 */
export function addLoaderBefore(config: Configuration, match: string | Matcher, newRule: NewRule) {
  return addLoader(config, match, newRule, (x) => (x === -1 ? 0 : x))
}

/**
 * Add rule config after the rule that matched the loader.
 * If there is no matched, the rule is added to the end of the rules array.
 * @param config webpack configuration
 * @param match a function to match the loader
 * @param newRule a rule or rule list to add
 */
export function addLoaderAfter(config: Configuration, match: string | Matcher, newRule: NewRule) {
  return addLoader(config, match, newRule, (...args) => (args[0] === -1 ? args[1] : args[0] + 1))
}

/**
 * Test a rule by some resources.
 * @param rule the rule that need to be test
 * @param resources resources for test the rule
 * @deprecated
 */
export function testByRuleSet(rule: RuleSetRule, resources: RuleTestResource[]) {
  const notFound = 'MODULE_NOT_FOUND'
  try {
    let RuleSet
    const lib = 'webpack/lib/RuleSet'
    try {
      RuleSet = require(lib)
    } catch (err) {
      if (err.code === notFound) {
        RuleSet = require(require.resolve(lib, { paths: [process.cwd()] }))
      }
    }
    const tester = new RuleSet([rule])
    return resources.some((res) => {
      const result = tester.exec(res)
      if (Array.isArray(result)) {
        return !!result.length
      }
      return !!result
    })
  } catch (err) {
    if (err && err.code === notFound) {
      return testByRegExp(rule, resources)
    }
    return false
  }
}

function testByRegExp(rule: RuleSetRule, resources: RuleTestResource[]) {
  const { test } = rule
  const regx = (!Array.isArray(test) ? [test] : (test as Array<any>)).filter(
    (reg: any) => reg && reg instanceof RegExp
  ) as RegExp[]
  if (regx.length) {
    return resources.some(({ resource }) =>
      resource ? regx.some((reg) => reg.test(resource)) : false
    )
  }
  return false
}

/**
 * Determine whether the rule is a CSS rule.
 * @param rule the rule that need to be tested
 * @param options some options for test
 */
export function isCssRule(rule: RuleSetRule, options?: CssRuleTestOptions) {
  const { module = true, onlyModule = false, syntax, data } = Object.assign({}, options)
  const filterBySyntax = (res: string) => (syntax ? res.endsWith(syntax) : !!res)
  const resources = !onlyModule
    ? ['x.scss', 'x.less', 'x.css', 'x.sass', syntax ? `x.${syntax}` : ''].filter(filterBySyntax)
    : []
  if (onlyModule || module) {
    resources.push(
      ...[
        'x.module.scss',
        'x.module.less',
        'x.module.css',
        'x.module.sass',
        syntax ? `x.module.${syntax}` : '',
      ].filter(filterBySyntax)
    )
  }
  return testByRegExp(
    rule,
    [...new Set(resources)].map((resource) => Object.assign({ resource }, data))
  )
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
    const useItem = rule as RuleSetUseItem
    const type = typeof useItem
    if (type !== 'string' && type !== 'object' && type !== 'function') {
      throw new Error(`Rule must as a type of RuleSetUseItem`)
    }
    if (type === 'object' && typeof (useItem as any).loader !== 'string') {
      throw new Error(`RuleSetLoader must has an property of loader that is type of string`)
    }
  } else {
    const ruleItem = rule as RuleSetRule
    if (!ruleItem || typeof ruleItem !== 'object') {
      throw new Error(`RuleSetRule must be an object`)
    }
  }
  return rule as RuleSetRule | RuleSetUseItem
}

function addNewLoader(
  newRule: NewRule,
  rules: RuleSetRule[] | RuleSetUseItem[],
  pos: number,
  isUseItem: boolean,
  isOneOf: boolean
) {
  let items = getNewRule(newRule, isUseItem, isOneOf) as any
  if (!Array.isArray(items)) {
    items = [items]
  }
  rules.splice(pos, 0, ...items)
}

function findLoaderRule(
  rules: RuleSetRule[],
  match: FindMatcher,
  parentMatch: ParentMatcher | null,
  parent: RuleSetRule | null,
  isOneOf: boolean
) {
  const matched = [] as RuleLoaderItem[]
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    if (!rule) {
      continue
    }

    const hasOneOf = Array.isArray(rule.oneOf) && !!rule.oneOf.length
    const hasRules = Array.isArray(rule.rules) && !!rule.rules.length

    if ((hasOneOf || hasRules) && typeof parentMatch === 'function' && hasRuleConditions(rule)) {
      if (!parentMatch(rule, parent)) {
        continue
      }
    }

    for (const use of [rule.loader, rule.use, rule.loaders, rule.type]) {
      matched.push(...matchRuleSet({ use, siblings: rules, match, rule, parent, index }, isOneOf))
    }

    if (hasOneOf) {
      matched.push(...findLoaderRule(rule.oneOf!, match, parentMatch, rule, true))
    }
    if (hasRules) {
      matched.push(...findLoaderRule(rule.rules!, match, parentMatch, rule, false))
    }
  }

  return matched
}

/**
 * Determine the rule has defined some conditions.
 * @param rule the rule that need to be tested.
 */
export function hasRuleConditions(rule: RuleSetRule) {
  const isCondition = (item: any): boolean => {
    if (!item) {
      return false
    }
    if (
      typeof item === 'string' ||
      item instanceof RegExp ||
      typeof item === 'function' ||
      typeof item === 'object'
    ) {
      return true
    }
    if (Array.isArray(item)) {
      return item.some((it) => isCondition(it))
    }
    return false
  }
  return (
    isCondition(rule.test) ||
    isCondition(rule.include) ||
    isCondition(rule.exclude) ||
    isCondition(rule.resourceQuery) ||
    isCondition(rule.resource) ||
    isCondition(rule.issuer) ||
    isCondition(rule.compiler) ||
    isCondition(rule.type)
  )
}

function matchRuleSet(options: MatchOptions, isOneOf: boolean) {
  const { siblings, rule, parent, use, index, match } = options
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
          parent,
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
        const item = {
          ...useItem,
          rule,
          parent,
          index,
          isUseItem: true,
          isOneOf: false,
          siblings: use,
        }
        if (match({ ...item })) {
          matched.push(item)
        }
      }
    }
  } else if (typeof use === 'string') {
    // loader、type
    const loader = rule.type === use ? undefined : use
    const item = { ...rule, loader, rule, parent, isUseItem: false, isOneOf, siblings, index }
    if (match({ ...item })) {
      matched.push(item)
    }
  } else if (typeof use === 'object') {
    // RuleSetLoader
    const item = {
      ...use,
      rule,
      parent,
      isUseItem: false,
      isOneOf,
      siblings,
      index,
    }
    if (match({ ...item })) {
      matched.push(item)
    }
  }

  return matched
}

function getPackageName(file: string) {
  if (!file || !path.isAbsolute(file)) {
    return ''
  }
  const cwd = process.cwd()
  while (!fs.existsSync(path.join((file = path.dirname(file)), 'package.json'))) {
    if (file === cwd || path.basename(file) === 'node_modules') {
      file = ''
      break
    }
  }
  if (!file || path.dirname(file) === file) {
    return ''
  }
  try {
    return require(path.join(file, 'package.json')).name
  } catch (e) {
    return ''
  }
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
  if (x && y && x === y) {
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
