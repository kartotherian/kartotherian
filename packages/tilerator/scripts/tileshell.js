#!/usr/bin/nodejs

const yaml = require('js-yaml');
const pathLib = require('path');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const _ = require('underscore');
const qidx = require('quadtile-index');
const core = require('@kartotherian/core');
const yargs = require('yargs');
const checkType = require('@kartotherian/input-validator');
const jplib = require('@kartotherian/jobprocessor');
const tilerator = require('../routes/tilerator');
const Queue = require('../lib/Queue');
const common = require('../lib/common');

const { JobProcessor } = jplib;

/**
 * Convert relative path to absolute, assuming current file is one
 * level below the project root
 * @param path
 * @returns {*}
 */
function normalizePath(path) {
  return pathLib.resolve(require.resolve('../package.json'), '..', path);
}

function loadYamlFile(arg) {
  const filename = normalizePath(arg);
  return yaml.safeLoad(fs.readFileSync(filename, 'utf8'), { filename });
}

function exit(message) {
  // eslint-disable-next-line no-console
  console.error(message);
  yargs.showHelp();
  process.exit(-1);
}

function dumpTiles(opt) {
  return opt.iterator().then((iterValue) => {
    if (iterValue !== undefined) {
      let val;
      if (opt.rawidx) {
        val = iterValue.idx.toString();
      } else {
        const xy = qidx.indexToXY(iterValue.idx);
        val = `${opt.zoom}/${xy[0]}/${xy[1]}`;
      }
      opt.outputStream.write(val);
      opt.outputStream.write('\n');
      return dumpTiles(opt);
    }
    return undefined;
  });
}

const args = yargs
  .usage('Usage: $0 [options]')
  .options({
    config: {
      describe: 'YAML-formatted configuration file',
      type: 'string',
      nargs: 1,
      coerce(arg) {
        return loadYamlFile(arg).services[0].conf;
      },
    },
    source: {
      // default: 'sources.prod.yaml',
      describe: 'YAML-formatted sources file',
      type: 'string',
      nargs: 1,
      coerce: normalizePath,
    },
    url: {
      describe: 'Source URL',
      type: 'string',
      nargs: 1,
      coerce: checkType.normalizeUrl,
    },
    v: {
      describe: 'Additional variable in YAML form. Use -v.varname value',
      type: 'string',
      nargs: 1,
      coerce: yaml.safeLoad,
    },
    p: {
      describe: 'Additional param in YAML form. Use -p.paramname value',
      type: 'string',
      nargs: 1,
    },
    j: {
      describe: 'Use -j.jobparam value to enque a job into the que, or if dumptiles is set, to output list of tiles',
      type: 'string',
      nargs: 1,
    },
    dumptiles: {
      describe: 'output tile indexes to this file',
      type: 'string',
    },
    dumprawidx: {
      describe: 'forces file output to a single zoom, index only format',
      type: 'boolean',
      implies: 'dumptiles',
      check: qidx.isValidZoom,
    },
    dumpoverride: {
      default: false,
      describe: 'override file output if exists',
      implies: 'dumptiles',
      type: 'boolean',
    },
    verbose: {
      default: false,
      describe: 'be verbose',
      type: 'boolean',
    },
  })
  .help('h')
  .alias('h', 'help')
  .argv;

if (args.p && (!_.isObject(args.p) || _.isEmpty(args.p))) {
  exit('-p must be used with the parameter name, e.g.   -p.paramname value');
}
if (args.v && (!_.isObject(args.v) || _.isEmpty(args.v))) {
  exit('-v must be used with variable name, e.g.   -v.varname value');
}
if (args.j && (!_.isObject(args.j) || _.isEmpty(args.j))) {
  exit('-j must be used with job parameter name, e.g.   -j.paramname value');
}

const app = {
  logger: {
    log(level, msg) {
      // eslint-disable-next-line no-console
      console.log(level, msg);
    },
  },
  metrics: {
    endTiming() {},
  },
  conf: args.config || {},
};

if (args.source) {
  app.conf.sources = args.source;
}
if (!_.isArray(app.conf.sources)) {
  app.conf.sources = [app.conf.sources];
}
if (app.conf.variables) {
  if (!_.isArray(app.conf.variables)) {
    app.conf.variables = [app.conf.variables];
  }
} else {
  app.conf.variables = [];
}
if (args.v) {
  app.conf.variables.push(args.v);
}
if (args.dumptiles) {
  if (!args.j || !_.isObject(args.j) || _.isArray(args.j)) {
    exit('A job must be specified using -j.<param> <value> parameters');
  }
  // We can reuse the same source, as we are
  // guaranteed that it exists, and we won't
  // execute this job
  if (!args.j.storageId) {
    args.j.storageId = args.j.generatorId;
  }
}

tilerator.bootstrap(app).then(() => {
  const sources = new core.Sources();
  return sources.init(app.conf);
}).then((sources) => {
  core.setSources(sources);
  if (args.j) {
    const job = common.paramsToJob(args.j, sources);

    if (args.dumptiles) {
      const jp = new JobProcessor(sources, { data: job }, app.metrics);

      const outputStream = fs.createWriteStream(args.dumptiles, { flags: args.dumpoverride ? 'w' : 'wx' });

      jp.initSources();
      const iterator = jp.createMainIterator();

      const opt = {
        iterator, outputStream, zoom: job.zoom, rawidx: args.dumprawidx,
      };
      return dumpTiles(opt).then(() => outputStream.endAsync());
    }

    // Make sure not to start the kueui
    app.conf.daemonOnly = true;
    const queue = new Queue(app);

    return common.enqueJob(queue, job, args.j);
  }
  return undefined;
}).catch((err) => {
  // eslint-disable-next-line no-console
  console.log(err);
  // eslint-disable-next-line no-console
  console.log(err.stack);
  process.exit(-2);
})
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('done');
    process.exit(0);
  });
