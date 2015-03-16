# Service Template Overview

This service template allows you to quickly dive into coding your own RESTful API
service.

- [Stack](#stack)
- [Repository Outline](#repository-outline)

## Stack

The template makes use the following components:

- [service-runner](https://github.com/wikimedia/service-runner)
- [express.js](http://expressjs.com/)
- [Bluebird Promises](https://github.com/petkaantonov/bluebird)
- [mocha](http://mochajs.org/)
- [istanbul](https://github.com/gotwarlost/istanbul)
- [docker](https://www.docker.com/)

Everything begins and ends with *service-runner*. It is the supervisor in charge
of starting the service and controlling its execution. It spawns worker
processes, each of which accepts and handles connections. If some workers use
too much heap memory, they are restarted. Additionally, it provides your service
with configurable logging and metrics facilities.

When it comes to request handling, *express.js* and *Bluebird* take the centre
stage. *express.js* is in charge of receiving the requests,  routing and
dispatching them to the correct handlers and send responses back to the clients.
*Bluebird* comes into play when there are actions which warrant asynchronous
processing (such as reading files, dispatching requests to external resources,
etc.). You can find example route handlers constructing the response both
synchronously and asynchronously in this template's [routes](../routes/)
directory.

Finally, testing is an important aspect of service programming, not only for
their creators, but also testers (think CI) and consumers. The template uses
*mocha* for carrying out the testing, and *istanbul* for reporting code coverage
with tests. There are quite a few tests [available](../test/) for you to check
out.

The WMF is in the process of switching its production servers to Debian Jessie.
As people developing services might use different platforms, the template
provides also a Dockerfile, with which one can execute their service inside a
container running Debian Jessie.

## Repository Outline

Below is a simplified repository outline listing the important files/directories
for service development.

- [`package.json`](../package.json) - the file containing the service's name and
  dependencies
- [`config.dev.yaml`](../config.dev.yaml) and
  [`config.prod.yaml`](../config.prod.yaml) - contain development and production
  configuration settings for the service
- [`server.js`](../server.js) - the service's starter script
- [`app.js`](../app.js) - contains the application declaration and loading logic
- [`routes`](../routes/) - contains the definitions of the loaded routes; this
  is where most of your coding is to take place
- [`lib/util.js`](../lib/util.js) - contains some utility functions and classes
- [`static`](../static/) - this is where served static files go (HTML, CSS,
  client-side JS, etc.)
- [`test`](../test/) - contains the test files for the example routes in the
  template; you should add your own here
- [`scripts/docker.js`](../scripts/docker.js) - a utility script building the
  service's docker image and starting the container

