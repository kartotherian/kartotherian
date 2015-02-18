# service-template-node
Template for creating MediaWiki Services in Node.js

# Getting Started

First, clone the repository

```
git clone https://github.com/wikimedia/service-template-node.git
```

Install the dependencies

```
cd service-template-node
npm install
```

Finally, activate the development configuration file

```
ln -s config.dev.yaml config.yaml
```

You are now ready to get to work!

* Inspect/modify/configure `app.js`
* Add routes by placing files in `routes/` (look at the files there for examples)

The template is a fully-working example, so you may try it right away. To
start the server hosting the REST API, simply run (inside the repo's directory)

```
npm start
```

This starts an HTTP server listening on `localhost:6927`. There are several routes
you may query (with a browser, or `curl` and friends):

* `http://localhost:6927/_info/`
* `http://localhost:6927/_info/name`
* `http://localhost:6927/_info/version`
* `http://localhost:6927/v1/conf`

