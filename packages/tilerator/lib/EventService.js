const P = require('bluebird');
const preq = require('preq');
const uuid = require('cassandra-uuid').TimeUuid;

function getResourceChangeEvent(resourceUri, domain) {
  return {
    meta: {
      topic: 'resource_change',
      uri: resourceUri,
      id: uuid.now().toString(),
      dt: new Date().toISOString(),
      domain,
    },
    tags: ['tilerator'],
  };
}

class EventService {
  constructor(eventBusUri, domain, sources, logger) {
    this.eventBusUri = eventBusUri;
    this.domain = domain;
    this.sources = sources;
    this.logger = logger;

    this.emitEvents = (events) => {
      P.try(() => preq.post({
        uri: this.eventBusUri,
        headers: { 'content-type': 'application/json' },
        body: events,
      })).catch(e => this.logger.log('error/events/emit', e)).thenReturn({ status: 200 });
    };

    // eslint-disable-next-line max-len
    this.emitResourceChangeEvents = uris => this.emitEvents(uris.map(uri => getResourceChangeEvent(uri, this.domain)));

    this.notifyTileChanged = (z, x, y) => {
      this.emitResourceChangeEvents(this.sources.map(s => `//${this.domain}/${s}/${z}/${x}/${y}.png`));
    };
  }
}

module.exports = EventService;
