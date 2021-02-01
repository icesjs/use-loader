## @ices/use-loader

### Usage

```js
const { addBefore, addAfter, add, find } = require('@ices/use-loader')

// find file-loader
const matched = find(webpackConfig, 'file-loader')

// add new loader config to the slibing position after the file-loader
const added = add(webpackConfig, 'file-loader', newRuleConfig, (index) => index + 1)

// add new loader config to the slibing position before the file-loader
const added = addBefore(webpackConfig, 'file-loader', newRuleConfig)

// add new loader config to the slibing position after the file-loader
const added = addAfter(webpackConfig, 'file-loader', newRuleConfig)

// use customize matcher
find(webpackConfig, (absolutePath) => absolutePath === '/some/path/loader.js')
```
