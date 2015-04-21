# Useful Commands

- [npm 101](#npm-101)
- [Service-related Tasks](#service-related-tasks)
- [Docker](#docker)

## npm 101

[npm](https://www.npmjs.com/) is the package manager for Node.js modules. It is
used for managing and publishing modules.

The template (and your future service) needs its dependencies to be present.
Install them with:

```
npm install
```

Sometimes the configuration can get a bit messed up you may experience strange
*npm*-related errors when running your service. The remedy is:

```
rm -rf node_modules
npm install
```

If you need to add a dependency, this will install it and add it your
`package.json`:

```
npm install --save <name_of_module>
```

## Service-related Tasks

The template comes with some handy `npm` tasks. To start your service based on
the configuration in `config.yaml`, use simply:

```
npm start
```

Starting unit tests is as easy as:

```
npm test
```

A code coverage utility is also available:

```
npm run-script coverage
```

Once the script finishes, open up `coverage/lcov-report/index.html` which will
show you detailed reports about which lines of code have been covered by the
unit tests.

## Docker

Included in the template is also a Dockerfile, allowing you to run and test your
service in a production-like environment inside of a Docker container. You need
to have [docker](https://www.docker.com/) installed if you are on a Linux host,
or [boot2docker](http://boot2docker.io/) in case of OSX/Windows hosts.

To start your service in the container, execute:

```
npm run-script docker-start
```

The first time you run it, it takes a while as the script automatically builds
the full image and then starts the service.

If you want to test your service instead, use:

```
npm run-script docker-test
```

Similarly, to run code coverage, run:

```
npm run-script docker-cover
```

*Note:* On Linux hosts, running `docker` requires superuser rights, so you may
need to prefix the commands with `sudo`. If you are on a Ubuntu box, you may
circumvent that by adding yourself to the `docker` group:

```
sudo gpasswd -a <your_username> docker
```

After you log out completely and log back in, you should be able to run the
above scripts without resorting to `sudo`.

## Deployment

See [this document](deployment.md) for how to get ready to deploy your service.

