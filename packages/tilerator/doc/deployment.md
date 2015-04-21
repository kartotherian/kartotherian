# Deployment

Getting your service ready to be deployed on WMF production machines involves
several tasks. This document explains the steps needed to get started and how to
keep your deployable copy up-to-date.

## Repositories

Because Node.js services use npm dependencies which can be binary, these need to
be pre-built. Therefore, two repositories are needed; one for the source code of
your service, and the other, so-called *deploy* repository. Both should be
available as WM's Gerrit repositories with the paths
*mediawiki/services/your-service-name* and
*mediawiki/services/your-service-name/deploy*. When [requesting
them](https://www.mediawiki.org/wiki/Git/New_repositories/Requests) ask for the
former to be a clone of [the service
template](https://github.com/wikimedia/service-template-node) and the latter to
be empty.

It is important to note that the deploy repository is only to be updated
directly before (re-)deploying the service, and not on each patch merge entering
the *master* branch of the regular repository. In other words, **the deploy
repository mirrors the code deployed in production at all times**.

The remainder of the document assumes these two repositories have been created
and that you have cloned them using your Gerrit account, i.e. not anonymously,
with the following outline:

```
~/code/
  |- your-service
  -- deploy
```

Furthermore, it is assumed that you have initialised the deploy repository:

```bash
$ cd ~/code/deploy
$ git review -s
$ touch README.md
$ git add README.md
$ git commit -m "Initial commit"
$ git push -u origin master  # or git review -R if this fails
# go to Gerrit and +2 your change, if needed and then:
$ git pull
```

Finally, if you haven't yet done so, do [basic service
configuration](config.md).

The remainder of the document refers to these two repositories as the *source
repository* and the *deploy repository*, respectively.

## Configuration

The service template includes an automation script which updates the deploy
repository, but it needs to be configured properly in order to work.

### package.json

The first part of the configuration involves keeping your source repository's
`package.json` updated. Look for its [deploy stanza](../package.json#L49).
Depending on the exact machine on which your service will be deployed, you may
need to set `target` to either `ubuntu` or `debian`.

The important thing is keeping the `dependencies` field up to date at all times.
There you should list all of the extra packages that are needed in order to
build the npm module dependencies. The `_all` field denotes packages which
should be installed regardless of the target distribution, but you can add
other, distribution-specific package lists, e.g.:

```javascript
"deploy": {
  "target": "ubuntu",
  "dependencies": {
    "ubuntu": ["pkg1", "pkg2"],
    "debian": ["pkgA", "pkgB"],
    "_all": ["pkgOne", "pkgTwo"]
  }
}
```

In this example, with the current configuration, packages *pkg1*, *pkg2*,
*pkgOne* and *pkgTwo* are going to be installed before building the
dependencies. If, instead, the target is changed to `debian`, then *pkgA*,
*pkgB*, *pkgOne* and *pkgTwo* are selected.

As a rule of thumb, **whenever you need to install extra packages into your
development environment for satisfying node module dependencies, add them to
*deploy.dependencies* to ensure the successful build and update of the deploy
repository**.

### Local git

The script needs to know where to find your local copy of the deploy repository.
To that end, when in your source repository, run:

```
git config deploy.dir /absolute/path/to/deploy/repo
```

Using the aforementioned local outline, you would type:

```
git config deploy.dir /home/YOU/code/deploy
```

The source repository is itself a submodule of the deploy repository. If its
name as specified in `package.json`'s `name` field does not match the actual
repository's name in Gerrit, run:

```
git config deploy.name name_in_gerrit
```

That will make the system look for the repository
`mediawiki/services/name_in_gerrit` when checking it out in the deploy
repository.

## Testing

Before updating the deploy repository you need to make sure your configuration
works as expected. To do that, in your source repository run:

```
./server.js docker-test
```

The script will build a new Docker image, install the needed packages and npm
dependencies and run the test suite. Tweak your code and configuration until
everything works as expected (and commit those changes).

## Update

The final step is updating the deploy repository. From the source repository
run:

```
./server.js build --deploy-repo
```

The script will:
- create the proper deploy repository outline
- fetch the updates
- ensure the submodule is present
- update the submodule
- build the npm dependencies
- commit the changes with a pretty-formatted message

There is also a handy shortcut for sending the patch to Gerrit immediately. To
do so, add the `--review` argument to the call:

```
./server.js build --deploy-repo --review
```

Note that if no changes were made to the source repository, the script aborts
its execution. If, nevertheless, you need to rebuild the dependencies, you can
do so using:

```
./server.js build --deploy-repo --force
```

