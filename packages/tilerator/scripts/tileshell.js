#!/usr/bin/nodejs

'use strict';

var yaml = require('js-yaml'),
    pathLib = require('path'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require("fs")),
    _ = require('underscore'),
    core = require('kartotherian-core'),
    yargs = require('yargs'),
    jplib = require('tilerator-jobprocessor'),
    JobProcessor = jplib.JobProcessor,
    tilerator = require('../routes/tilerator'),
    Queue = require('../lib/Queue'),
    common = require('../lib/common');

var args = yargs
    .usage('Usage: $0 [options]')
    .options({
        config: {
            describe: 'YAML-formatted configuration file',
            type: 'string',
            nargs: 1,
            coerce: function(arg) {
                let conf = loadYamlFile(arg).services[0].conf;
                return {variables: conf.variables, sources: conf.sources};
            }
        },
        source: {
            // default: 'sources.prod.yaml',
            describe: 'YAML-formatted sources file',
            type: 'string',
            nargs: 1,
            coerce: normalizePath
        },
        url: {
            describe: 'Source URL',
            type: 'string',
            nargs: 1,
            coerce: core.normalizeUri
        },
        v: {
            describe: 'Additional variable in YAML form. Use -v.varname value',
            type: 'string',
            nargs: 1,
            coerce: yaml.safeLoad
        },
        p: {
            describe: 'Additional param in YAML form. Use -p.paramname value',
            type: 'string',
            nargs: 1
        },
        j: {
            describe: 'Use -j.jobparam value to enque a job into the que, or if dumptiles is set, to output list of tiles',
            type: 'string',
            nargs: 1
        },
        dumptiles: {
            describe: 'output tile indexes to this file',
            type: 'string',
            coerce: normalizePath
        },
        dumprawidx: {
            describe: 'forces file output to a single zoom, index only format',
            type: 'number',
            implies: 'dumptiles',
            check: core.isValidZoom
        },
        dumpoverride: {
            default: false,
            describe: 'override file output if exists',
            implies: 'dumptiles',
            type: 'boolean'
        },
        verbose: {
            default: false,
            describe: 'be verbose',
            type: 'boolean'
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


// console.log(JSON.stringify(args, null, '\t'));


let app = {
    logger: {
        log: function (level, msg) {
            console.log(level, msg);
        }
    },
    metrics: {
        endTiming: function() {}
    },
    conf: args.config || {}
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
    // We can reuse the same source, as we are guaranteed that it exists, and we won't execute this job
    if (!args.j.storageId) {
        args.j.storageId = args.j.generatorId;
    }
}

// console.log(JSON.stringify(args, null, '\t'));
// console.log(JSON.stringify(app.conf, null, '\t'));

return tilerator.bootstrap(app).then(function() {
    core.registerTileliveModule(require('tilelive-file'));
    var sources = new core.Sources();
    return sources.init(app.conf.variables, app.conf.sources);
}).then(function (sources) {
    core.setSources(sources);
    if (args.j) {
        let job = common.paramsToJob(args.j, sources);

        if (args.dumptiles) {
            var jp = new JobProcessor(sources, {data: job}, app.metrics);

            let outputStream = fs.createWriteStream(args.dumptiles, {flags: args.dumpoverride ? 'w' : 'wx'});

            jp.initSources();
            let iterator = jp.createMainIterator();

            let opt = {iterator:iterator, outputStream:outputStream, zoom: job.zoom, rawidx: args.dumprawidx};
            return dumpTiles(opt).then(function() {
                return outputStream.endAsync();
            });
        }

        // Make sure not to start the kueui
        app.conf.daemonOnly = true;
        var queue = new Queue(app);

        return common.enqueJob(queue, job, args.j);
    }
}).then(function() {
    console.log('done');
});


function dumpTiles(opt) {
    return opt.iterator().then(function (iterValue) {
        if (iterValue !== undefined) {
            let val;
            if (opt.rawidx) {
                val = iterValue.idx.toString();
            } else {
                let xy = core.indexToXY(iterValue.idx);
                val = opt.zoom + '/' + xy[0] + '/' + xy[1];
            }
            opt.outputStream.write(val);
            opt.outputStream.write('\n');
            return dumpTiles(opt);
        }
    });
}


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
    let filename = normalizePath(arg);
    return yaml.safeLoad(fs.readFileSync(filename, 'utf8'), {filename: filename});
}

function exit(message) {
    console.error(message);
    yargs.showHelp();
    process.exit(-1);
}
