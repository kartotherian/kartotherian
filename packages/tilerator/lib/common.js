const _ = require('underscore');
const Err = require('@kartotherian/err');
const jplib = require('@kartotherian/jobprocessor');

const { fileParser } = jplib;
const { processAll } = jplib;
const { Job } = jplib;


/**
 * Add only the referenced sources to the job
 */
function setSources(job, sources) {
  const ids = _.unique(_.filter(_.pluck(job.filters, 'sourceId').concat([job.storageId, job.generatorId])));
  const recursiveIter = (obj) => {
    if (_.isObject(obj)) {
      if (Object.keys(obj).length === 1 && typeof obj.ref === 'string' && !_.contains(ids, obj.ref)) {
        ids.push(obj.ref);
      } else {
        _.each(obj, recursiveIter);
      }
    }
  };
  const allSources = sources.getSourceConfigs();
  let i = 0;

  // eslint-disable-next-line no-param-reassign
  job.sources = {};
  while (i < ids.length) {
    const id = ids[i++];
    const source = allSources[id];
    if (!source) { throw new Err('Source ID %s is not defined', id); }
    if (source.isDisabled) { throw new Err('Source ID %s is disabled', id); }
    // eslint-disable-next-line no-param-reassign
    job.sources[id] = source;
    _.each(source, recursiveIter);
  }
}

function paramsToJob(params, sources) {
  const job = {
    storageId: params.storageId,
    generatorId: params.generatorId,
    zoom: params.zoom,
    priority: params.priority,
    idxFrom: params.idxFrom,
    idxBefore: params.idxBefore,
    tiles: params.tiles ? JSON.parse(params.tiles) : undefined,
    x: params.x,
    y: params.y,
    parts: params.parts,
    deleteEmpty: params.deleteEmpty,
    fromZoom: params.fromZoom,
    beforeZoom: params.beforeZoom,
    fileZoomOverride: params.fileZoomOverride,
    keepJob: params.keepJob,
  };
  let filter1 = {
    sourceId: params.sourceId,
    dateBefore: params.dateBefore,
    dateFrom: params.dateFrom,
    biggerThan: params.biggerThan,
    smallerThan: params.smallerThan,
    missing: params.missing ? true : undefined,
    zoom: params.checkZoom,
  };
  let filter2 = {
    sourceId: params.sourceId2,
    dateBefore: params.dateBefore2,
    dateFrom: params.dateFrom2,
    biggerThan: params.biggerThan2,
    smallerThan: params.smallerThan2,
    missing: params.missing2 ? true : undefined,
    zoom: params.checkZoom2,
  };

  filter1 = _.any(filter1) ? filter1 : false;
  filter2 = _.any(filter2) ? filter2 : false;

  if (filter2 && !filter1) {
    throw new Err('Cannot set second filter unless the first filter is also set');
  }
  if (filter1 && filter2) {
    job.filters = [filter1, filter2];
  } else if (filter1) {
    job.filters = filter1;
  }
  setSources(job, sources);

  return job;
}

function enqueJob(queue, job, params) {
  // TODO: Fix shadowing
  // eslint-disable-next-line no-shadow
  const addJobAsync = job => queue.addJobAsync(new Job(job));
  if (params.expdirpath || params.statefile || params.expmask) {
    if (!params.expdirpath || !params.statefile || !params.expmask) {
      throw new Err('All three params - expdirpath, statefile, expmask must be present');
    }
    return processAll(params.expdirpath, params.statefile, params.expmask, job, addJobAsync);
  } else if (params.filepath) {
    return fileParser(params.filepath, job, addJobAsync);
  }
  return addJobAsync(job);
}

module.exports = {
  paramsToJob,
  setSources,
  enqueJob,
};
