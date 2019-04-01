# API Design

Before you start coding your service, you need to think hard about your API's
design, especially for a public service exposing its API. Below are a couple of
practices you should follow.

- [Statelessness](#statelessness)
- [Versioning](#versioning)
- [Hierarchical URI Layout](#hierarchical-uri-layout)
- [HTTP Verbs](#http-verbs)
- [Documentation](#documentation)
- [See Also](#see-also)

## Statelessness

RESTful API services should be
[stateless](https://en.wikipedia.org/wiki/Service_statelessness_principle), since
they are conceptually modelled around *resources* (as opposed to *systems*).
Accordingly, your service should take actions depending on assumptions about the
caller or the current state of the service's process (e.g. that the user is
logged in, that they are allowed to modify a resource, etc.)

## Versioning

You should always version all of your API. Always. Period. Applications depend on
its stability and invariance. It is tolerable to add endpoints to an API
version, but removing or modifying existing ones is not an option. Thus,
versioning provides an easy way for you to improve upon the API while avoiding
third-party application breakage. The template enforces this practice by
requiring all of your [route files](../routes/) specify the API version.

## Hierarchical URI Layout

Use a hierarchical URI layout that is intuitive and makes sense. Grouping
endpoints under a common URI prefix allows both you and the future API consumer
to reason about the API. As an example, consider
[RESTBase](https://www.mediawiki.org/wiki/RESTBase)'s API layout:

```
/{domain}
  -- /v1
     |- /page
     |  |- /title
     |  |- /html
     |  |- /data-parsoid
     |  -- /revision
     -- /transform
        |- /html/to/wikitext
        |- /wikitext/to/html
        -- /html/to/html
```

The API is grouped in two *sections* - `page` and `transform`. The former
exposes endpoints dealing with Wiki pages, while the latter comprises endpoints
transforming one format to another.

## HTTP Verbs

There are many [HTTP
verbs](http://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html) you can use and
expose in your API. Use them appropriately. Especially, **do not allow GET
requests to modify** any type of content.

## Documentation

Document your API meticulously, and keep it up to date with the code. Remember
that API's are meant to be consumed by external applications, whose developers
most often do not know the internal workings of your stack. A good starting
point is to look into [Swagger](https://github.com/swagger-api/swagger-spec), a
specification for API declaration and documentation from which nice, demo-able
documentation such as [this](http://rest.wikimedia.org/en.wikipedia.org/v1/?doc)
can be automatically generated.

## See Also

The above is just a short list of things you should think about when designing
your API. Here are some resources you might find useful at this step:

- https://github.com/Wikia/guidelines/tree/master/APIDesign
- https://restful-api-design.readthedocs.org/en/latest/
- http://www.vinaysahni.com/best-practices-for-a-pragmatic-restful-api
- http://www.thoughtworks.com/insights/blog/rest-api-design-resource-modeling

