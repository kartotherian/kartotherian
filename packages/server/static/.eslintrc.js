module.exports = {
  "extends": "wikimedia",
  "env": {
    "node": false,
    "es6": false,
    "browser": true,
  },
  "rules": {
    "indent": ["error", 2]
  },
  "parserOptions": {
    sourceType: 'script',
    ecmaVersion: 5,
  },
  "globals": {
    "L": false
  }
};
