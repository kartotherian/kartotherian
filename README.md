# service-template-node [![Build Status](https://travis-ci.org/wikimedia/service-template-node.svg?branch=master)](https://travis-ci.org/wikimedia/service-template-node)

Template for creating MediaWiki Services in Node.js

## Getting Started

### Installation

First, clone the repository

```
git clone https://github.com/wikimedia/service-template-node.git
```

Install the dependencies

```
cd service-template-node
npm install
```

You are now ready to get to work!

* Inspect/modify/configure `app.js`
* Add routes by placing files in `routes/` (look at the files there for examples)

You can also read [the documentation](https://www.mediawiki.org/wiki/ServiceTemplateNode).

### Running the examples

The template is a fully-working example, so you may try it right away. To
start the server hosting the REST API, simply run (inside the repo's directory)

```
npm start
```

This starts an HTTP server listening on `localhost:6927`. There are several
routes you may query (with a browser, or `curl` and friends):

* `http://localhost:6927/_info/`
* `http://localhost:6927/_info/name`
* `http://localhost:6927/_info/version`
* `http://localhost:6927/_info/home`
* `http://localhost:6927/{domain}/v1/siteinfo{/prop}`
* `http://localhost:6927/{domain}/v1/page/{title}`
* `http://localhost:6927/{domain}/v1/page/{title}/lead`
* `http://localhost:6927/ex/err/array`
* `http://localhost:6927/ex/err/file`
* `http://localhost:6927/ex/err/manual/error`
* `http://localhost:6927/ex/err/manual/deny`
* `http://localhost:6927/ex/err/auth`

### Tests

The template also includes a test suite a small set of executable tests. To fire
them up, simply run:

```
npm test
```

If you haven't changed anything in the code (and you have a working Internet
connection), you should see all the tests passing. As testing most of the code
is an important aspect of service development, there is also a bundled tool
reporting the percentage of code covered. Start it with:

```
npm run-script coverage
```

### Troubleshooting

In a lot of cases when there is an issue with node it helps to recreate the
`node_modules` directory:

```
rm -r node_modules
npm install
```

Enjoy!

