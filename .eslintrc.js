module.exports = {
  extends: 'kartotherian',
  env: {
    node: true,
    es6: true,
    browser: false,
  },
  rules: {
    'comma-dangle': [
      'error',
      {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        // Dangling commas are unsupported in node
        functions: 'never',
      },
    ],
  },
};
