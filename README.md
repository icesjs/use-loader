## @ices/use-loader

### Usage

```js
const { addBefore, addAfter, add, find } = require('@ices/use-loader')

// find file-loader
const matched = find(webpackConfig, 'file-loader')

// add new loader config to the slibing position after the file-loader
add(webpackConfig, 'file-loader', newRuleConfig, (index) => index + 1)

// add new loader config to the slibing position before the file-loader
addBefore(webpackConfig, 'file-loader', newRuleConfig)

// add new loader config to the slibing position after the file-loader
addAfter(webpackConfig, 'file-loader', newRuleConfig)

// use customize matcher
find(webpackConfig, ({ name }) => name === 'file-loader')
```

### API

See dist/index.d.ts
