# Coding Guide

Let's get started! 

- [Route Set-up](#route-set-up)
- [Routes](#routes)
- [Promises](#promises)
  - [I/O](#io)
  - [External Requests](#external-requests)
- [Error Handling](#error-handling)
- [Logging and Metrics](#logging-and-metrics)
  - [Logging](#logging)
  - [Metrics Collection](#metrics-collection)
- [Test Cases](#test-cases)

## Route Set-up

All of the routes are read from the [routes directory](../routes) and are
automatically mounted on start-up. The first step is to create a new route file
by copying the [route template](../routes/empty.js.template):

```bash
$ cd routes
$ cp empty.js.template people.js
```

Now, open `people.js` in your favourite editor. The first thing you need to
decide is the mount path for the routes contained in the file and the API
version the route belongs to. Let's say that this file will contain routes
pertaining to famous people, so a path like `/people/` makes sense here.
Obviously, the API version is going to be `1`. Change lines 32 - 36 to reflect
this:

```javascript
return {
    path: '/people',
    api_version: 1,
    router: router
};
```

This causes all of the routes you create in `people.js` to be mounted on
`/{domain}/v1/people/`, where `{domain}` represents the sought domain (such as
`en.wikipedia.org`, `www.mediawiki.org`, etc.).

## Routes

Creating routes is accomplished by calling `router.METHOD(path, handlerFunction)`
where `METHOD` is the HTTP verb you want to create the route for (`get`, `put`,
`post`, etc.), and `handlerFunction` is the callback function called when the
relative path `path` is matched. We are now ready to set up our first route.
Replace line 23 with the following code:

```javascript
router.get('/:name', function(req, res) {

    res.status(200).json({
        name: decodeURIComponent(req.params.name)
    });

});
```

The route's path is `:name`, which signifies a variable path. In this case, it
is the name of the person the request is about. Thus, both
`/people/Albert_Einstein` and `/people/David_Lynch` will match the route. The
callback's body is rather simple: we set the response's status to `200` and send
back a JSON containing the person's name. To learn more about routes and their
various options, read Express.js' [routing
guide](http://expressjs.com/guide/routing.html).

## Promises

The service template includes the [bluebird
module](https://github.com/petkaantonov/bluebird) for handling asynchronous
patterns via promises. Prime examples of when they should be used are performing
external requests or I/O actions. Promises allow the service process not to
block on them and continue serving other requests until the action is completed.

### I/O

Coming back to our example route, let's say that we want to serve a simple HTML
document on the endpoint `/people/:name/about`. To do so, first we need to
require and *promisify* the `fs` module. Put this line in the header of your
routes file (right below line 6):

```javascript
var fs = BBPromise.promisifyAll(require('fs'));
```

This creates additional functions, which are *promisified* versions of the
original ones exported by the `fs` module. Henceforth, we can read a file either
using the built-in `fs.readFile()` or its promise-aware counterpart
`fs.readFileAsync()`.

Armed with this knowledge, we can now easily create a route handler:

```javascript
router.get('/:name/about', function(req, res) {

    // read the file
    return fs.readFileAsync(__dirname + '/../static/index.html')
    // and then send back its contents
    .then(function(src) {
        res.status(200).type('html').send(src);
    });

});
```
As you can see, promises allow us to specify chained actions in a natural way
(using the `.then()` continuation pattern). Note that, when using promises in
services derived from this template it is important that you `return` the
promise to the caller. Doing so allows the template's framework to automatically
handle any possible errors during the promise's execution.

### External Requests

One other area where promises come in handy is making external requests. Suppose
we want to serve the latest news about a person from
[Wikinews](http://www.wikinews.org). The template includes the
[preq](https://github.com/gwicke/preq) -- a module promisifying the popular
[request](https://github.com/request/request) module -- which we can use
right away:

```javascript
router.get('/:name/news/:lang?', function(req, res) {

    // set the language if not set
    var lang = req.params.lang || 'en';

    // get the news
    return preq.get({
        uri: 'https://' + lang + '.wikinews.org/wiki/'
                + encodeURIComponent(req.params.name)
    }).then(function(wnRes) {
        res.status(200).type('html').send(wnRes.body);
    });

});
```

## Error Handling

As mentioned earlier, the template is capable of automatically handling errors
for you. However, you might want to take matters into your own hands in some
occasions. The template provides a convenient `HTTPError` object class which you
can use.

Let's revise the handler for the `/people/:name/about` route. It does not seem
to be very useful, as it returns the same content for any given name. We would
like it to return content relevant to the person whose name was specified in the
request URI by looking up the file `/static/name.html`. If the file does not
exist, a `404` should be returned to the caller.

```javascript
router.get('/:name/about', function(req, res) {

    return fs.readFileAsync(__dirname + '/../static/'
            + encodeURIComponent(req.params.name) + '.html')
    .then(function(src) {
        res.status(200).type('html').send(src)
    }).catch(function(err) {
        throw new HTTPError({
            status: 404,
            type: 'not_found',
            title: 'Not Found',
            detail: 'No information could be found on ' + req.params.name
        });
    });

});
```

Note that you can also attach additional debug information to the `HTTPError`
object to help you track down bugs. This information is going to be logged, but
will not reach the client, thus ensuring no sensitive information is leaked
unintentionally. To do so, simply add any property you deem important when
creating / throwing the error.

## Logging and Metrics

Logging and metrics collection is supported out of the box via
[service-runner](https://github.com/wikimedia/service-runner). They are exposed
in route handler files via the `req.logger` and `app.metrics` objects.

### Logging

To log something, simply use `req.logger.log(level, what)`. The logger itself is
a [bunyan](https://github.com/trentm/node-bunyan) wrapper, and thus supports the
following levels:

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`

Additionally, it is good practice to attach a component name to the log level as
it eases log indexing and filtering later in production. For example, if a log
entry has the `debug` level and pertains to one of our example routes, the log
level could be set to `debug/people`. The `what` portion of the log entry can be
either a string message, or any *stringifiable* object. As an example, let's
log the person's name given to the `/people/:name/about` route and the file name
that is going to be looked up:

```javascript
router.get('/:name/about', function(req, res) {

    var info = {
        name: req.params.name,
        path: __dirname + '/../static/'
            + encodeURIComponent(req.params.name) + '.html'
    };

    req.logger.log('debug/people/about', info);

    return fs.readFileAsync(info.path)
    .then(function(src) {
        res.status(200).type('html').send(src)
    }).catch(function(err) {
        throw new HTTPError({
            status: 404,
            type: 'not_found',
            title: 'Not Found',
            detail: 'No information could be found on ' + info.name
        });
    });

});
```

As you can see, the request object (`req`) has an additional property -
`req.logger`, which allows you to log messages and objects in the context of the
current request. To do so, it attaches a unique *request ID* to each logged
information. If you would like to log context-free information, you can use the
`app.logger` object instead, even though that is not recommended.

### Metrics Collection

Collecting metrics is a great way to have insights into the overall health and
performance of your service. When using the template, this is as easy as calling
one of the following methods:

- `app.metrics.timing`
- `app.metrics.increment`
- `app.metrics.decrement`
- `app.metrics.histogram`
- `app.metrics.gauge`
- `app.metrics.unique`

How can one collect them? Let's show it on `/people/:name/news`. This route uses
an external request to complete its action, which means that you have little
control over your service's response time, as it is dominated by the request to
Wikinews. Two interesting metrics that we can collect here (and that directly
affect the service's response time) are the external request's response time and
the size of its response. We can measure the former with `app.metrics.timing()`
and the latter with `app.metrics.histogram()`. Additionally, it interesting to
see the distribution of languages, which can be achieved with
`app.metrics.unique()`.

```javascript
router.get('/:name/news/:lang?', function(req, res) {

    // set the language if not set
    var lang = req.params.lang || 'en';

    // count the language occurrence
    app.metrics.unique('people.news.lang', lang);
    // start measuring the time
    var startTime = Date.now();

    // get the news
    return preq.get({
        uri: 'https://' + lang + '.wikinews.org/wiki/'
                + encodeURIComponent(req.params.name)
    }).then(function(wnRes) {
        // external request done, report the request time
        app.metrics.timing('people.news.time', Date.now() - startTime);
        // also report the payload's size
        app.metrics.histogram('people.news.size', wnRes.body.length);
        res.status(200).type('html').send(wnRes.body);
    });

});
```
For more information on the available methods, see the [service-runner
documentation](https://github.com/wikimedia/service-runner#metric-reporting).

## Test Cases

The service needs to thoroughly tested since other services and clients are
going to depend on it. The template uses
[mocha](https://github.com/mochajs/mocha) for test execution and provides some
useful utility functions in [test/utils](../test/utils).

To create a test suite for our example routes, create the `people` directory in
`/test/features/` and two files inside of it: `about.js` and `news.js`. These
will test the example routes. Let's start with `about.js`:

```javascript
'use strict';


// mocha defines to avoid JSHint breakage
/* global describe, it, before, beforeEach, after, afterEach */


var preq   = require('preq');
var assert = require('../../utils/assert.js');
var server = require('../../utils/server.js');


describe('people - about', function() {

    this.timeout(20000);

    before(function () { return server.start(); });

    // common URI prefix
    var uri = server.config.uri + 'en.wikipedia.org/v1/people/';

    it('get HTML for index', function() {
        return preq.get({
            uri: uri + 'index/about'
        }).then(function(res) {
            // check the status
            assert.status(res, 200);
            // check the returned Content-Type header
            assert.contentType(res, 'text/html');
            // inspect the body
            assert.notDeepEqual(res.body, undefined, 'No body returned!');
        });
    });

    it('fail for a non-existent person', function() {
        return preq.get({
            uri: uri + 'Walt_Disney/about'
        }).then(function(res) {
            // if we are here, no error was thrown, not good
            throw new Error('Expected an error to be thrown, got status: ', res.status);
        }, function(err) {
            // inspect the status
            assert.deepEqual(err.status, 404);
        });
    });

});
```

