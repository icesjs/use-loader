## @ices/use-loader

### Usage

```js
const { addLoaderBefore, addLoaderAfter, addLoader, findLoader } = require('@ices/use-loader')

// find file-loader
const matched = findLoader(webpackConfig, 'file-loader')

// add new loader config to the slibing position after the file-loader
addLoader(webpackConfig, 'file-loader', newRuleConfig, (index) => index + 1)

// add new loader config to the slibing position before the file-loader
addLoaderBefore(webpackConfig, 'file-loader', newRuleConfig)

// add new loader config to the slibing position after the file-loader
addLoaderAfter(webpackConfig, 'file-loader', newRuleConfig)

// use customize matcher
findLoader(webpackConfig, ({ name }) => name === 'file-loader')
```

### API

See dist/index.d.ts
